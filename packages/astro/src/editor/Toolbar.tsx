import React, {
  FormEvent,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type {
  ArrayField,
  ComponentSchema,
  Config,
  ObjectField,
} from "@drystack/core";
import {
  entryRefExists,
  getSlugGlobForCollection,
  resolveEntryRef,
  type EntryRef,
} from "@drystack/core/path-utils";
import { getAuth } from "@drystack/core/auth";
import {
  openMediaLibrary,
  waitForMediaLibraryOpener,
  type MediaLibraryPick,
} from "@drystack/core/media-library-bridge";
import l10nMessages from "@drystack/core/l10n";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
// @ts-expect-error - provided by the drystack Astro integration's Vite plugin
import apiPath from "virtual:drystack-path";
import { Badge } from "@keystar/ui/badge";
import { ActionButton, Button, ButtonGroup } from "@keystar/ui/button";
import { AlertDialog, Dialog, DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { editIcon } from "@keystar/ui/icon/icons/editIcon";
import { xIcon } from "@keystar/ui/icon/icons/xIcon";
import { saveIcon } from "@keystar/ui/icon/icons/saveIcon";
import { eyeIcon } from "@keystar/ui/icon/icons/eyeIcon";
import { externalLinkIcon } from "@keystar/ui/icon/icons/externalLinkIcon";
import { listIcon } from "@keystar/ui/icon/icons/listIcon";
import { bracesIcon } from "@keystar/ui/icon/icons/bracesIcon";
import { linkIcon } from "@keystar/ui/icon/icons/linkIcon";
import { VStack } from "@keystar/ui/layout";
import { Content } from "@keystar/ui/slots";
import { toastQueue } from "@keystar/ui/toast";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Heading, Text } from "@keystar/ui/typography";
import {
  ChangePreviewDialog,
  ImageThumbFrame,
  prettifyContentHtml,
  summarizeContentChange,
  type FieldChange,
} from "@drystack/core/change-preview";
import {
  createGetPreviewProps,
  FormValueContentFromPreviewProps,
  clientSideValidateProp,
  EntryDirectoryProvider,
  PathContextProvider,
  SlugFieldProvider,
  type SlugFieldInfo,
} from "@drystack/core/field-editor";
import {
  enableEditing,
  disableEditing,
  getContainerValueFromDom,
  getOriginalValue,
  refreshFromLatestSource,
  resetPendingEdits,
  applyEdit,
  revertFieldToOriginal,
  setImageSpotClickHandler,
  setFileSpotClickHandler,
} from "./bind";
import {
  getAllEdits,
  publishDelete,
  publishEdit,
  subscribeEdits,
  putPendingBlob,
  getPendingBlob,
} from "./store";
import {
  saveEdits,
  getCurrentBranchName,
  getGithubToken,
  listCollectionSlugs,
  type RenameRequest,
} from "./save";
import {
  clearSourceCache,
  editKey,
  entryRefKey,
  isAssetKind,
  parseEditKey,
  resolveSchemaAtFieldPath,
} from "@drystack/core/edit-sync";
import { CloudflareStatusInline } from "@drystack/core/deploy-cloudflare-status";
import { watchBuildStatus } from "@drystack/core/build-status";
import { useVeiDeploy } from "./deploy";

// Loaded lazily (only once the visual editor actually enters edit mode) -
// this chunk pulls in urql + graphcache + the admin's field-editor/file-
// manager components, which would otherwise bloat every live-site page's JS
// payload.
const VeiAdminProviders = lazy(() =>
  import("@drystack/core/media-host").then((m) => ({
    default: m.VeiAdminProviders,
  })),
);
const FileManagerHost = lazy(() =>
  import("@drystack/core/file-manager-host").then((m) => ({
    default: m.FileManagerHost,
  })),
);
// Lazy for the same reason, and doubly worth it here: this one pulls in
// ProseMirror and the whole rich-text editor.
const InlineContentEditors = lazy(() =>
  import("./InlineContentEditors").then((m) => ({
    default: m.InlineContentEditors,
  })),
);

type Spot = { key: string; ref: EntryRef; field: string };

// The single source of truth for "what's actually pending" - reads
// IndexedDB via getAllEdits() and drops any entry whose value happens to
// equal its captured original (e.g. typed then reverted by hand). Shared by
// the toolbar's badge/Save-Reset-enabled state and the review dialog's list
// so the two can never disagree about whether there's anything to review.
//
// `kind` is read straight off the matching DOM element's data-dry-kind
// (rather than threaded through from config) since that's the same
// attribute bind.ts already dispatches on to paint the value - one fewer
// thing that could disagree. Defaults to 'text' if no matching element is on
// this page (e.g. a pending edit for an entry not rendered here).
//
// `label` is resolved from the entry's own schema (same `field.label ?? key`
// fallback as the admin's computeFieldChanges) via resolveSchemaAtFieldPath
// (not a flat `schema[field]` lookup) so a nested field like "brand.name"
// resolves a real label too, rather than always falling back to the raw
// dotted key - matches the admin here so the review dialog reads
// identically in both places, see CLAUDE.md's UI-consistency expectations
// for this shared component.
async function getPendingChanges(
  config: Config<any, any>,
): Promise<FieldChange[]> {
  const edits = await getAllEdits();
  return (
    edits
      .map((e) => {
        const parsed = parseEditKey(e.key);
        const el = document.querySelector<HTMLElement>(
          `[data-dry="${CSS.escape(e.key)}"]`,
        );
        const dryKind = el?.getAttribute("data-dry-kind");
        const kind: "text" | "image" | "file" = isAssetKind(dryKind)
          ? dryKind
          : "text";
        let label = parsed?.field ?? e.key;
        if (parsed) {
          const ref: EntryRef =
            parsed.type === "singleton"
              ? { type: "singleton", name: parsed.name }
              : { type: "collection", name: parsed.name, slug: parsed.slug };
          if (entryRefExists(config, ref)) {
            const fieldSchema = resolveSchemaAtFieldPath(
              resolveEntryRef(config, ref).schema,
              parsed.field,
            ) as { label?: string } | undefined;
            label = fieldSchema?.label ?? parsed.field;
          }
        }
        return {
          key: e.key,
          label,
          kind,
          isContent: dryKind === "content",
          before: getOriginalValue(e.key) ?? "",
          after: e.value,
        };
      })
      // On the raw bodies, before any summarizing below - two different bodies
      // can share a word/character count (an <h6> turned into a <p> touches no
      // words), and filtering on the summary would drop that edit from the list
      // while it's still pending.
      .filter((c) => c.before !== c.after)
      .map(({ isContent, ...c }) =>
        isContent
          ? {
              ...c,
              diffBefore: prettifyContentHtml(c.before),
              diffAfter: prettifyContentHtml(c.after),
              before: summarizeContentChange(c.before),
              after: summarizeContentChange(c.after),
            }
          : c,
      )
  );
}

const adminBase = `/${String(apiPath).replace(/^\/+|\/+$/g, "")}`;

// Whether the edit-mode toolbar was expanded, persisted across reloads -
// without this, refreshing the page while editing silently drops back to
// view mode (pending edits themselves already survive via IndexedDB, see
// bind.ts's applyPendingEdits, but the toolbar/contentEditable state didn't).
const EDITING_STORAGE_KEY = "drystack-vei-editing";

function readStoredEditing(): boolean {
  try {
    return localStorage.getItem(EDITING_STORAGE_KEY) === "1";
  } catch {
    // localStorage can throw (e.g. blocked cookies) - just won't persist.
    return false;
  }
}

function writeStoredEditing(value: boolean): void {
  try {
    if (value) localStorage.setItem(EDITING_STORAGE_KEY, "1");
    else localStorage.removeItem(EDITING_STORAGE_KEY);
  } catch {
    // Same as above - best-effort persistence only.
  }
}

// Every editable spot rendered on the current page, read from the DOM.
// Deduped by key - the same field can appear on multiple elements (e.g. a
// site title in both the header and footer), and consumers below need one
// entry per key, not one per DOM node, since they re-query all matching
// elements by key when they need to touch the DOM.
function readSpots(config: Config<any, any>): Spot[] {
  const seen = new Set<string>();
  const spots: Spot[] = [];
  document.querySelectorAll<HTMLElement>("[data-dry]").forEach((el) => {
    const key = el.getAttribute("data-dry");
    if (!key || seen.has(key)) return;
    const parsed = parseEditKey(key);
    if (!parsed) return;
    const ref: EntryRef =
      parsed.type === "singleton"
        ? { type: "singleton", name: parsed.name }
        : { type: "collection", name: parsed.name, slug: parsed.slug };
    if (!entryRefExists(config, ref)) return;
    seen.add(key);
    spots.push({ key, ref, field: parsed.field });
  });
  return spots;
}

// A dry spot the top-left indicator (see the hover/focus effect below) can
// point at - captured together at the moment of the focus/hover event since
// data-dry-kind isn't encoded in the data-dry key itself.
type ActiveSpot = { key: string; kind: string };

// Splits an ActiveSpot into the indicator's two display parts: the
// colour-coded kind badge ("Text"/"Image"/…, styled by
// .dry-active-spot-kind--<kind> in editor.css) and the path label
// ("Singleton: demo.array.0.name", or "Bài viết: bai-viet.excerpt" for a
// collection entry - its own config label, then slug.field).
function formatActiveSpot(
  spot: ActiveSpot | null,
  config: Config<any, any>,
): { kind: string; kindLabel: string; pathLabel: string } | null {
  if (!spot) return null;
  const parsed = parseEditKey(spot.key);
  if (!parsed) return null;
  const capitalize = (s: string) => `${s.charAt(0).toUpperCase()}${s.slice(1)}`;
  if (parsed.type === "singleton") {
    return {
      kind: spot.kind,
      kindLabel: capitalize(spot.kind),
      pathLabel: `Singleton: ${parsed.name}.${parsed.field}`,
    };
  }
  const collectionLabel =
    (config.collections?.[parsed.name] as { label?: string } | undefined)
      ?.label ?? parsed.name;
  return {
    kind: spot.kind,
    kindLabel: capitalize(spot.kind),
    pathLabel: `${collectionLabel}: ${parsed.slug}.${parsed.field}`,
  };
}

export function Toolbar({ config }: { config: Config<any, any> }) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [editing, setEditing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [spots, setSpots] = useState<Spot[]>([]);

  // Active-spot indicator - a permanent top-left HUD, on for the whole time
  // edit mode is on, showing which dry field is "in hand". A focused
  // (contentEditable, currently being typed into) spot wins outright over a
  // merely hovered one - once something has focus, hover is ignored
  // entirely until that focus clears, rather than just deprioritized, so
  // moving the mouse around while typing never disturbs the reading. Hover
  // uses the same delayed-clear pattern as the array gear button below
  // (moving from one spot straight onto its own portaled UI shouldn't
  // flicker the label off).
  const [hoverSpot, setHoverSpot] = useState<ActiveSpot | null>(null);
  const [focusSpot, setFocusSpot] = useState<ActiveSpot | null>(null);
  const activeSpotCloseTimer = useRef<
    ReturnType<typeof setTimeout> | undefined
  >(undefined);

  // Container gear button - a floating icon portaled to <body>, shown while
  // hovering any fields.array OR fields.object container spot in edit mode
  // (identified by data-dry-kind="array"/"object", set server-side by
  // .bind()/.view(), at any nesting depth), positioned over that element via
  // getBoundingClientRect. Clicking it opens ContainerFieldDialog, which
  // renders the exact admin editor for that array/object (see
  // field-editor.tsx re-exports).
  const [arrayGearSpot, setArrayGearSpot] = useState<{
    key: string;
    kind: "array" | "object";
    rect: DOMRect;
  } | null>(null);
  const [arrayDialogKey, setArrayDialogKey] = useState<string | null>(null);
  const arrayGearCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  // The element currently backing arrayGearSpot, kept around purely so
  // scroll/resize can recompute its rect - getBoundingClientRect() is
  // viewport-relative and goes stale the instant the page scrolls.
  const arrayGearElRef = useRef<HTMLElement | null>(null);

  // Slug-rename gear button (Phase 9) - the same floating-icon-on-hover
  // pattern as arrayGearSpot above, but only ever shown over a collection
  // entry's own slugField spot (the field whose schema exposes `.slugify`,
  // matching dry.ts's own guard for which text spot is bindable as a slug at
  // all - see makeSpot there). A .view() readonly mirror never shows it,
  // same reasoning as the array gear: there's nothing to open a dialog *for*
  // on a mirror instance. Clicking it opens SlugFieldDialog - the inline
  // contentEditable spot itself stays independently editable the whole time
  // (hovering/clicking the gear never takes focus away from it).
  const [slugGearSpot, setSlugGearSpot] = useState<{
    key: string;
    ref: Extract<EntryRef, { type: "collection" }>;
    slugField: string;
    rect: DOMRect;
  } | null>(null);
  const [slugDialogSpot, setSlugDialogSpot] = useState<{
    ref: Extract<EntryRef, { type: "collection" }>;
    slugField: string;
  } | null>(null);
  const slugGearCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const slugGearElRef = useRef<HTMLElement | null>(null);

  // The one rename a VEI session can have in flight at a time - set by
  // SlugFieldDialog's "Xong", consumed by the 3-way redirect dialog at Save
  // time (see onSave/runSave below). Deliberately plain React state, not
  // durable like a field edit on the bus - a rename is a structural move,
  // not a value, and MVP1 accepts that reloading mid-decision loses it (same
  // as the admin's own in-progress typed slug before Save).
  const [pendingRename, setPendingRename] = useState<{
    ref: Extract<EntryRef, { type: "collection" }>;
    newSlug: string;
  } | null>(null);
  const [renameDialogOpen, setRenameDialogOpen] = useState(false);
  const [renameAddRedirect, setRenameAddRedirect] = useState(false);

  // Set once Save actually committed a rename in github mode - the brand
  // branch/main has moved, but nothing is publicly live until Cloudflare
  // finishes a build against it, so edit mode is locked (see the render
  // below) and this drives a banner instead. `targetUrl` is undefined when
  // the collection has no `previewUrl` - there's nothing to probe or offer
  // navigation to, so the banner shows a bare "waiting" state with no dialog.
  const [renameWaiting, setRenameWaiting] = useState<{
    newSlug: string;
    targetUrl: string | undefined;
    status: "watching" | "checking" | "ready" | "failed";
  } | null>(null);

  // isGithub gates the brand/merge/deploy flow Save triggers automatically
  // (see onSave/runSave below) - local mode has no branch concept and keeps
  // its old instant, confirm-free save.
  const isGithub = config.storage.kind === "github";
  const [confirmSaveOpen, setConfirmSaveOpen] = useState(false);
  const {
    deploy,
    isBusy: deployBusy,
    label: deployLabel,
    isOnDefaultBranch,
  } = useVeiDeploy(config);

  // Hover dropdown state - the menu itself is portaled to <body>.
  const refWrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const [refOpen, setRefOpen] = useState(false);
  const [refPos, setRefPos] = useState({ left: 0, bottom: 0 });

  const refreshCount = async () => {
    setPendingCount((await getPendingChanges(config)).length);
  };

  useEffect(() => {
    refreshCount();
    setSpots(readSpots(config));
    // Restore edit mode if it was on before the last reload (see
    // EDITING_STORAGE_KEY above).
    if (readStoredEditing()) startEditing();
    // Keep the badge/review-dialog count accurate when edits arrive from
    // another tab (admin or another visual-editor tab), not just this one.
    return subscribeEdits(() => refreshCount());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hover detection for the container gear button - only active in edit
  // mode. Delegated at the document level (capture phase) rather than one
  // listener per spot, since spots can appear/disappear as the array grows
  // or shrinks via template-clone (see bind.ts's renderArray). Matches the
  // *closest* array-or-object container spot, so hovering a nested container
  // (e.g. an array inside an object inside an array) targets that inner
  // container's own dialog, not some ancestor's.
  useEffect(() => {
    if (!editing) {
      arrayGearElRef.current = null;
      setArrayGearSpot(null);
      return;
    }
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest<HTMLElement>(
        '[data-dry-kind="array"], [data-dry-kind="object"]',
      );
      // A .view() readonly container has no dialog to open (it's a mirror,
      // not the editable instance) - never show the gear button for it.
      if (!el || el.hasAttribute("data-dry-readonly")) return;
      const key = el.getAttribute("data-dry");
      const kind = el.getAttribute("data-dry-kind");
      if (!key || (kind !== "array" && kind !== "object")) return;
      clearTimeout(arrayGearCloseTimer.current);
      arrayGearElRef.current = el;
      setArrayGearSpot({ key, kind, rect: el.getBoundingClientRect() });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (
        related?.closest('[data-dry-kind="array"], [data-dry-kind="object"]') ||
        related?.closest(".dry-array-gear")
      ) {
        return;
      }
      arrayGearCloseTimer.current = setTimeout(() => {
        arrayGearElRef.current = null;
        setArrayGearSpot(null);
      }, 140);
    };
    // Capture phase + scroll's non-bubbling nature: this also catches scrolls
    // inside nested scroll containers, not just the window.
    const onReposition = () => {
      const el = arrayGearElRef.current;
      if (!el) return;
      setArrayGearSpot((prev) =>
        prev ? { ...prev, rect: el.getBoundingClientRect() } : prev,
      );
    };
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
      clearTimeout(arrayGearCloseTimer.current);
    };
  }, [editing]);

  // Hover detection for the slug-rename gear button - same delegated
  // document-level pattern as the container gear above, but matched by
  // *identity* (this spot's dotted field equals its collection's own
  // configured slugField) rather than a data-dry-kind value, since a
  // slugField spot is otherwise indistinguishable from any other text spot
  // in the DOM (see dry.ts's makeSpot: it deliberately emits kind="text" for
  // it, only the `name` half is ever bound).
  useEffect(() => {
    if (!editing) {
      slugGearElRef.current = null;
      setSlugGearSpot(null);
      return;
    }
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest<HTMLElement>("[data-dry]");
      if (!el || el.hasAttribute("data-dry-readonly")) return;
      const key = el.getAttribute("data-dry");
      if (!key) return;
      const parsed = parseEditKey(key);
      if (!parsed || parsed.type !== "collection") return;
      const collectionConfig = config.collections?.[parsed.name] as
        | { slugField?: string }
        | undefined;
      if (
        !collectionConfig?.slugField ||
        parsed.field !== collectionConfig.slugField
      ) {
        return;
      }
      clearTimeout(slugGearCloseTimer.current);
      slugGearElRef.current = el;
      setSlugGearSpot({
        key,
        ref: { type: "collection", name: parsed.name, slug: parsed.slug },
        slugField: collectionConfig.slugField,
        rect: el.getBoundingClientRect(),
      });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest("[data-dry]") || related?.closest(".dry-slug-gear")) {
        return;
      }
      slugGearCloseTimer.current = setTimeout(() => {
        slugGearElRef.current = null;
        setSlugGearSpot(null);
      }, 140);
    };
    const onReposition = () => {
      const el = slugGearElRef.current;
      if (!el) return;
      setSlugGearSpot((prev) =>
        prev ? { ...prev, rect: el.getBoundingClientRect() } : prev,
      );
    };
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    document.addEventListener("scroll", onReposition, true);
    window.addEventListener("resize", onReposition);
    return () => {
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      document.removeEventListener("scroll", onReposition, true);
      window.removeEventListener("resize", onReposition);
      clearTimeout(slugGearCloseTimer.current);
    };
  }, [editing, config]);

  // The rename reload gate (Phase 9) - once a rename has actually committed
  // in github mode (renameWaiting set by runSave below), watches Cloudflare's
  // build status and, once a build succeeds, HEAD-probes the new URL with
  // backoff until this visitor's own CDN edge actually has it (a bare
  // `succeeded` event only means Cloudflare finished building, not that
  // every edge caught up - see the plan). `failed`/`canceled` surfaces an
  // error with a retry affordance rather than hanging silently; the
  // underlying watch is never torn down on failure, so a later successful
  // build (e.g. an automatic Cloudflare retry) still resolves the wait
  // without the user having to do anything.
  //
  // Cleanup (stopping the WS watch and aborting any in-flight HEAD probe) is
  // the effect's own return - unmounting (navigating away mid-wait) or
  // renameWaiting changing runs it automatically, which is what makes a
  // stale "build ready, switch to the new URL?" dialog impossible to show
  // for a page the user already left (see the plan's "Huỷ callback khi rời
  // trang" requirement).
  useEffect(() => {
    if (!renameWaiting || renameWaiting.status === "ready") return;
    if (!renameWaiting.targetUrl) return;
    const targetUrl = renameWaiting.targetUrl;
    const controller = new AbortController();
    let probeTimer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const probe = async () => {
      try {
        const res = await fetch(targetUrl, {
          method: "HEAD",
          signal: controller.signal,
        });
        if (res.ok) {
          setRenameWaiting((w) => (w ? { ...w, status: "ready" } : w));
          return;
        }
      } catch {
        // Aborted (cleanup) or a network hiccup - either way, fall through
        // to the retry schedule below rather than treating it as terminal.
      }
      attempt++;
      probeTimer = setTimeout(probe, Math.min(1000 * 2 ** attempt, 8000));
    };

    const stopWatch = watchBuildStatus((update) => {
      if (update.kind !== "event") return;
      if (update.event.phase === "succeeded") {
        setRenameWaiting((w) =>
          w && w.status !== "ready" ? { ...w, status: "checking" } : w,
        );
        probe();
      } else if (
        update.event.phase === "failed" ||
        update.event.phase === "canceled"
      ) {
        setRenameWaiting((w) =>
          w && w.status !== "ready" ? { ...w, status: "failed" } : w,
        );
      }
    });

    return () => {
      stopWatch();
      controller.abort();
      if (probeTimer) clearTimeout(probeTimer);
    };
  }, [renameWaiting?.newSlug, renameWaiting?.targetUrl]);

  // Active-spot focus/hover tracking (see the state above) - delegated at
  // the document level (capture phase) the same way as the array gear hover
  // detection, since spots come and go with the array template-clone. Focus
  // uses focusin/focusout (fires for the contentEditable text spots enabled
  // by bind.ts's enableEditing); hover uses mouseover/mouseout so non-
  // focusable spots (image/file/array containers, which open a picker or a
  // dialog instead of taking focus) still get a label.
  useEffect(() => {
    if (!editing) {
      setHoverSpot(null);
      setFocusSpot(null);
      return;
    }
    const onFocusIn = (e: FocusEvent) => {
      const el = (e.target as HTMLElement)?.closest<HTMLElement>("[data-dry]");
      const key = el?.getAttribute("data-dry");
      setFocusSpot(
        key ? { key, kind: el!.getAttribute("data-dry-kind") ?? "text" } : null,
      );
    };
    const onFocusOut = (e: FocusEvent) => {
      const el = (e.target as HTMLElement)?.closest<HTMLElement>("[data-dry]");
      const key = el?.getAttribute("data-dry");
      if (!key) return;
      // Only clear if this blur is for the spot we're currently reporting -
      // a stale async blur from a spot that's no longer focused shouldn't
      // clobber whatever focused since.
      setFocusSpot((prev) => (prev?.key === key ? null : prev));
    };
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest<HTMLElement>("[data-dry]");
      if (!el) return;
      clearTimeout(activeSpotCloseTimer.current);
      const key = el.getAttribute("data-dry");
      if (key)
        setHoverSpot({ key, kind: el.getAttribute("data-dry-kind") ?? "text" });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (related?.closest("[data-dry]")) return;
      activeSpotCloseTimer.current = setTimeout(() => setHoverSpot(null), 140);
    };
    document.addEventListener("focusin", onFocusIn, true);
    document.addEventListener("focusout", onFocusOut, true);
    document.addEventListener("mouseover", onOver, true);
    document.addEventListener("mouseout", onOut, true);
    return () => {
      document.removeEventListener("focusin", onFocusIn, true);
      document.removeEventListener("focusout", onFocusOut, true);
      document.removeEventListener("mouseover", onOver, true);
      document.removeEventListener("mouseout", onOut, true);
      clearTimeout(activeSpotCloseTimer.current);
    };
  }, [editing]);

  // Focus always wins outright over hover - see the state comment above.
  const activeSpot = formatActiveSpot(focusSpot ?? hoverSpot, config);

  // The admin provider boundary (VeiAdminProviders + FileManagerHost, lazy -
  // see the lazy() imports above) - mounted whenever edit mode is on, not
  // lazily per-click, so both the field-editor dialogs below and the image/
  // file spot click handlers can assume it's either ready or not yet
  // attempted, with no per-click mount race to arbitrate. `currentBranch`
  // only matters in github mode.
  type ProviderState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "ready"; currentBranch: string }
    | { status: "blocked"; message: string };
  const [providerState, setProviderState] = useState<ProviderState>({
    status: "idle",
  });
  // Lets long-lived effects (the image/file spot click handlers below) read
  // the current provider status without re-subscribing their click handler
  // every time it changes.
  const providerStateRef = useRef(providerState);
  providerStateRef.current = providerState;
  // Caches a successful github resolution for the lifetime of this page load
  // (the visual editor mounts once and is never torn down) so toggling edit
  // mode off/on doesn't re-hit the network and remount VeiAdminProviders
  // every time - only the first resolution per page load pays that cost.
  const resolvedProviderRef = useRef<{ currentBranch: string } | null>(null);
  // Re-runs the resolution below on demand - requireProviderReady calls this
  // when blocked, so a click while blocked also kicks off a retry instead of
  // only toasting forever (the previous auth failure isn't retried
  // otherwise; only toggling edit mode off/on used to force one).
  const resolveProviderRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!editing) {
      setProviderState({ status: "idle" });
      return;
    }
    if (!isGithub) {
      setProviderState({ status: "ready", currentBranch: "" });
      return;
    }
    let cancelled = false;
    const resolve = () => {
      if (resolvedProviderRef.current) {
        setProviderState({
          status: "ready",
          currentBranch: resolvedProviderRef.current.currentBranch,
        });
        return;
      }
      // github mode needs an admin session - mounting the boundary without
      // one would hit the shell's own "not authenticated" redirect, which
      // would navigate this live-site tab to the admin login page. The
      // access-token cookie is short-lived (GitHub's OAuth expiry, a few
      // hours) and nothing else refreshes it while the user only ever
      // visits this live-site toolbar (never the admin SPA, which is where
      // the urql authExchange that normally handles this lives) - so try a
      // silent refresh off the still-valid, much longer-lived refresh-token
      // cookie before bouncing the user to re-auth.
      setProviderState({ status: "loading" });
      const ensureToken = getGithubToken()
        ? Promise.resolve(true)
        : getAuth(config, adminBase).then((auth) => !!auth);
      ensureToken.then((hasToken) => {
        if (cancelled) return;
        if (!hasToken) {
          setProviderState({
            status: "blocked",
            message: "Cần đăng nhập admin để đổi ảnh/tệp.",
          });
          return;
        }
        getCurrentBranchName(config)
          .then((branch) => {
            if (cancelled) return;
            resolvedProviderRef.current = { currentBranch: branch ?? "" };
            setProviderState({ status: "ready", currentBranch: branch ?? "" });
          })
          .catch((err) => {
            if (!cancelled) {
              setProviderState({
                status: "blocked",
                message: err instanceof Error ? err.message : String(err),
              });
            }
          });
      });
    };
    resolveProviderRef.current = resolve;
    resolve();
    return () => {
      cancelled = true;
    };
  }, [editing, isGithub, config]);

  // Guards an image/file spot click or the array gear button: surfaces a
  // toast and returns false unless the provider boundary is actually mounted
  // and ready to serve openMediaLibrary()/the field-editor dialogs. Kicks off
  // a fresh resolution attempt when blocked, so the *next* click has a chance
  // of succeeding instead of replaying the same stale failure forever.
  const requireProviderReady = (): boolean => {
    const s = providerStateRef.current;
    if (s.status === "ready") return true;
    if (s.status === "blocked") resolveProviderRef.current();
    toastQueue.critical(
      s.status === "blocked"
        ? s.message
        : "Đang chuẩn bị, thử lại sau giây lát.",
    );
    return false;
  };

  // Wired to every fields.image/fields.file spot's click (see bind.ts's
  // handleAssetSpotClick) - opens the exact same file-manager dialog the
  // admin's ImageFieldInput/FileFieldInput uses, scoped to this singleton's
  // own assets folder (matching EntryDirectoryProvider's convention in
  // SingletonPage.tsx). Waits for FileManagerHost's opener to actually be
  // registered (it mounts lazily alongside the provider boundary - see the
  // lazy() imports above - so a click landing right as providerState flips
  // to 'ready' can otherwise race its own mount) before opening the picker.
  useEffect(() => {
    const registerHandler = (
      accept: "image" | "any",
      setHandler: (cb: ((key: string) => void) | undefined) => void,
    ) => {
      const handler = async (key: string) => {
        if (!requireProviderReady()) return;
        if (!(await waitForMediaLibraryOpener())) return;
        const parsed = parseEditKey(key);
        if (!parsed) return;
        const ref: EntryRef =
          parsed.type === "singleton"
            ? { type: "singleton", name: parsed.name }
            : { type: "collection", name: parsed.name, slug: parsed.slug };
        const pick = await pickAsset(
          config,
          ref,
          accept,
          stringFormatter.format("veiThisPage"),
        );
        if (!pick) return;
        await publishEdit(key, pick.path);
        await applyEdit(key, pick.path);
        refreshCount();
      };
      setHandler(handler);
      return () => setHandler(undefined);
    };
    const cleanupImage = registerHandler("image", setImageSpotClickHandler);
    const cleanupFile = registerHandler("any", setFileSpotClickHandler);
    return () => {
      cleanupImage();
      cleanupFile();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config]);

  const startEditing = () => {
    enableEditing(refreshCount);
    setSpots(readSpots(config));
    // Don't block entering edit mode on the network - repaint with the
    // real current source once it resolves, fields with a pending edit
    // stay untouched.
    refreshFromLatestSource(config).then(refreshCount);
    setEditing(true);
    writeStoredEditing(true);
  };

  const stopEditing = () => {
    disableEditing();
    setEditing(false);
    writeStoredEditing(false);
  };

  const toggleEdit = () => {
    if (editing) stopEditing();
    else startEditing();
  };

  // The actual save - commits (brand, in github mode) then, when something
  // landed there AND that brand isn't already the default branch, merges it
  // in (deploy.ts's runDeploy via the deploy() hook, which owns its own
  // conflict/nothing/committed/error toasts) before re-syncing the DOM. That
  // ordering matters: refreshFromLatestSource reads off the *default*
  // branch, which only has the new content once the merge lands - running it
  // right after the brand commit would flash stale pre-merge content. When
  // already on the default branch, saveEdits() already committed straight to
  // it (see save.ts's ensureBrand), so there's nothing left to merge.
  const runSave = async () => {
    // Snapshotted once up front - this function clears pendingRename
    // partway through, and re-reading the state var after that point
    // (rather than this const) would silently see `null`.
    const rename = pendingRename;
    setSaving(true);
    try {
      let renameRequest: RenameRequest | undefined;
      let renamePreviewUrl: string | undefined;
      if (rename) {
        const collectionConfig = config.collections?.[rename.ref.name] as
          | { previewUrl?: string }
          | undefined;
        renamePreviewUrl = collectionConfig?.previewUrl;
        const redirect =
          renameAddRedirect && renamePreviewUrl
            ? {
                from: renamePreviewUrl.replace("{slug}", rename.ref.slug),
                to: renamePreviewUrl.replace("{slug}", rename.newSlug),
              }
            : undefined;
        renameRequest = { ref: rename.ref, newSlug: rename.newSlug, redirect };
      }

      const commitOid = await saveEdits(config, { rename: renameRequest });

      if (rename) {
        setPendingRename(null);
        setRenameAddRedirect(false);
        const targetUrl = renamePreviewUrl?.replace("{slug}", rename.newSlug);
        // The DOM under this page's [data-dry] attributes still reflects the
        // OLD slug - refreshFromLatestSource would read those stale keys and
        // cache the new values under a source-cache key that no longer
        // matches anything (see the plan). Drop the whole cache instead;
        // it's only ever a best-effort freshness bridge, safe to lose.
        await clearSourceCache();
        if (!isGithub) {
          // Local writes are immediately real - no build to wait for.
          toastQueue.positive("Đã đổi URL, đang chuyển trang…", {
            timeout: 3000,
          });
          if (targetUrl) {
            location.href = targetUrl;
            return;
          }
        } else {
          if (commitOid && !isOnDefaultBranch) await deploy();
          // Nothing is publicly live yet even though the commit landed - see
          // the renameWaiting effect above for the build-watch/HEAD-probe
          // gate this hands off to.
          setRenameWaiting({ newSlug: rename.newSlug, targetUrl, status: "watching" });
        }
        await refreshCount();
        return;
      }

      let deployed = false;
      if (isGithub && commitOid && !isOnDefaultBranch) {
        await deploy();
        deployed = true;
      }
      await refreshFromLatestSource(config);
      await refreshCount();
      // github's own deploy() toast is the final word on success/failure -
      // only show a toast here when there was nothing to merge (local mode,
      // a github save with nothing pending, or a direct save to main).
      if (!deployed) {
        toastQueue.positive(
          isGithub && commitOid && isOnDefaultBranch
            ? "Đã lưu trực tiếp vào main"
            : "Changes saved",
          { timeout: 4000 },
        );
      }
    } catch (err) {
      toastQueue.critical(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  // A pending rename is resolved into a redirect choice *before* anything
  // else - mirrors the admin's ItemPage (getSlugFromState !== itemSlug gates
  // its own AlertDialog the same way, before any save happens). Only after
  // that's answered does github mode's existing merge/deploy confirmation
  // (unrelated to renaming) get its turn.
  const onSave = () => {
    if (pendingRename) {
      setRenameDialogOpen(true);
      return;
    }
    if (isGithub) {
      setConfirmSaveOpen(true);
      return;
    }
    void runSave();
  };

  const proceedAfterRenameChoice = () => {
    if (isGithub) {
      setConfirmSaveOpen(true);
      return;
    }
    void runSave();
  };

  const onReset = async () => {
    await resetPendingEdits();
    await refreshCount();
  };

  // Open the admin home in a new tab. Synchronous (fired straight from the
  // click) so the browser doesn't treat it as a blocked popup.
  const openAdminHome = () => {
    window.open(adminBase, "_blank", "noopener,noreferrer");
  };

  // Deep-link to a singleton's or collection entry's admin editor in a new
  // tab. github mode needs an async branch lookup, so open the tab up front -
  // preserving the click's user activation - and point it at the URL once
  // resolved; a window.open() issued after the await would be killed by the
  // popup blocker.
  const goToAdmin = async (ref: EntryRef) => {
    const tab = window.open("", "_blank");
    if (tab) tab.opener = null;
    try {
      const branch = await getCurrentBranchName(config);
      const branchSegment = branch
        ? `branch/${encodeURIComponent(branch)}/`
        : "";
      const url =
        ref.type === "singleton"
          ? `${adminBase}/${branchSegment}singleton/${encodeURIComponent(ref.name)}`
          : `${adminBase}/${branchSegment}collection/${encodeURIComponent(
              ref.name,
            )}/item/${encodeURIComponent(ref.slug)}`;
      if (tab) tab.location.href = url;
      else window.open(url, "_blank", "noopener,noreferrer");
    } catch (err) {
      tab?.close();
      toastQueue.critical(err instanceof Error ? err.message : String(err));
    }
  };

  // Highlight (and scroll to) every editable spot belonging to one entry
  // (singleton or collection item), keyed by entryRefKey.
  const flashEntry = (refKey: string, on: boolean) => {
    const els = spots
      .filter((s) => entryRefKey(s.ref) === refKey)
      .flatMap((s) =>
        Array.from(
          document.querySelectorAll<HTMLElement>(
            `[data-dry="${CSS.escape(s.key)}"]`,
          ),
        ),
      );
    els.forEach((el) => el.classList.toggle("dry-spot-flash", on));
    if (on && els[0]) {
      els[0].scrollIntoView({ behavior: "smooth", block: "center" });
    }
  };

  // One entry per singleton/collection-item (deduped by entryRefKey),
  // labelled from config - a collection item combines the collection's own
  // label with its slug ("Bài viết · bai-viet") since several items can
  // share a collection.
  const entryList = Array.from(
    new Map(
      spots.map((s) => {
        const key = entryRefKey(s.ref);
        const label =
          s.ref.type === "singleton"
            ? ((config.singletons?.[s.ref.name] as { label?: string } | undefined)
                ?.label ?? s.ref.name)
            : `${
                (config.collections?.[s.ref.name] as { label?: string } | undefined)
                  ?.label ?? s.ref.name
              } · ${s.ref.slug}`;
        return [key, { key, ref: s.ref, label }] as const;
      }),
    ).values(),
  );

  const openRefMenu = () => {
    clearTimeout(closeTimer.current);
    const el = refWrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRefPos({ left: r.left, bottom: window.innerHeight - r.top + 6 });
    setRefOpen(true);
  };
  const scheduleCloseRefMenu = () => {
    clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setRefOpen(false), 140);
  };

  const nothingToSave = pendingCount === 0;

  return (
    <div className="dry-bar">
      {/* Unified edit menu - a single pill that's always on screen. Collapsed
          it's just the edit FAB; enabling edit expands the action buttons out
          to the right (width collapse) and morphs the pencil into an ✕ that
          collapses the menu again. */}
      <div className={`dry-menu${editing ? " is-open" : ""}`}>
        <div className="dry-menu-pill">
          {/* Toggle button - always visible, leads the pill. */}
          <Button
            prominence="high"
            aria-label={
              editing
                ? stringFormatter.format("veiExitEditMode")
                : stringFormatter.format("veiEditPage")
            }
            onPress={toggleEdit}
            UNSAFE_className="dry-fab"
          >
            <span
              className={`dry-fab-icon dry-fab-icon--edit${editing ? " is-hidden" : ""}`}
            >
              <Icon src={editIcon} />
            </span>
            <span
              className={`dry-fab-icon dry-fab-icon--x${editing ? "" : " is-hidden"}`}
            >
              <Icon src={xIcon} />
            </span>
          </Button>

          {/* Collapsible action group - revealed only in edit mode. */}
          <div className="dry-menu-actions">
            <div className="dry-menu-actions-inner">
              <div
                className="dry-ref"
                ref={refWrapRef}
                onMouseEnter={openRefMenu}
                onMouseLeave={scheduleCloseRefMenu}
              >
                <ActionButton
                  aria-label={stringFormatter.format("veiOpenAdmin")}
                  onPress={openAdminHome}
                  UNSAFE_className="dry-iconbtn"
                >
                  <Icon src={externalLinkIcon} />
                </ActionButton>
              </div>

              <TooltipTrigger>
                <div className="dry-review">
                  <ActionButton
                    aria-label={stringFormatter.format("reviewChanges")}
                    onPress={() => setReviewOpen(true)}
                    isDisabled={nothingToSave}
                    UNSAFE_className="dry-iconbtn"
                  >
                    <Icon src={eyeIcon} />
                  </ActionButton>
                  {!nothingToSave && (
                    <span className="dry-badge">
                      <Badge tone="accent">{pendingCount}</Badge>
                    </span>
                  )}
                </div>
                <Tooltip>{stringFormatter.format("reviewChanges")}</Tooltip>
              </TooltipTrigger>

              <TooltipTrigger>
                <Button
                  aria-label={stringFormatter.format("veiSaveChanges")}
                  prominence="high"
                  onPress={onSave}
                  isDisabled={(nothingToSave && !pendingRename) || saving || !!renameWaiting}
                  UNSAFE_className="dry-iconbtn"
                >
                  <Icon src={saveIcon} />
                </Button>
                <Tooltip>
                  {saving
                    ? stringFormatter.format("veiSaving")
                    : stringFormatter.format("veiSaveChanges")}
                </Tooltip>
              </TooltipTrigger>
            </div>
          </div>
        </div>
      </div>

      {/* Active-spot indicator - a permanent top-left HUD label, on for the
          whole time edit mode is on (not just while something's focused/
          hovered - see the state above), so it's always there to glance at.
          Positioned/styled entirely in editor.css, independent of .dry-bar's
          own bottom-left placement. In github mode it's prefixed with the
          build/deploy status (CloudflareStatusInline - busy label while
          Save's merge/deploy is running, then whatever Cloudflare's build WS
          reports), folded into the same flat readout rather than a separate
          pill below it. */}
      {editing && (
        <div className="dry-active-spot">
          {isGithub && (
            <CloudflareStatusInline busy={deployBusy} busyLabel={deployLabel} />
          )}
          {activeSpot ? (
            <>
              <span
                className={`dry-active-spot-kind dry-active-spot-kind--${activeSpot.kind}`}
              >
                {activeSpot.kindLabel}
              </span>
              {activeSpot.pathLabel}
            </>
          ) : (
            <em className="dry-active-spot-empty">No item</em>
          )}
        </div>
      )}

      {/* Rename reload-gate banner (Phase 9, github mode only) - shown for as
          long as renameWaiting is set, independent of `editing` (edit mode
          itself is now moot for the renamed entry - its old DOM is stale).
          Three states: watching the build, checking the new URL is actually
          live (HEAD probe), or the build itself failed. */}
      {renameWaiting && (
        <div className="dry-rename-banner">
          {renameWaiting.status === "failed" ? (
            <>
              <span>{stringFormatter.format("veiBuildFailedNewUrl")}</span>
              <button
                type="button"
                className="dry-rename-banner-action"
                onClick={() =>
                  setRenameWaiting((w) =>
                    w ? { ...w, status: "watching" } : w,
                  )
                }
              >
                {stringFormatter.format("retry")}
              </button>
            </>
          ) : renameWaiting.status === "checking" ? (
            <span>{stringFormatter.format("veiBuildDoneChecking")}</span>
          ) : (
            <span>{stringFormatter.format("veiSavedWaitingBuild")}</span>
          )}
        </div>
      )}

      {/* Once the new URL is confirmed live (HEAD probe succeeded), ask
          before navigating away - the user may be mid-something else on this
          page. Closing without navigating just leaves the banner/lock in
          place; there's nothing stale left to protect against since the
          bus/source-cache were already cleared right after the rename
          commit (see runSave). */}
      <DialogContainer
        onDismiss={() => setRenameWaiting(null)}
      >
        {renameWaiting?.status === "ready" && renameWaiting.targetUrl && (
          <AlertDialog
            title={stringFormatter.format("veiBuildDoneTitle")}
            tone="neutral"
            cancelLabel={stringFormatter.format("veiLater")}
            primaryActionLabel={stringFormatter.format("veiSwitchToNewUrl")}
            autoFocusButton="primary"
            onCancel={() => setRenameWaiting(null)}
            onPrimaryAction={() => {
              location.href = renameWaiting.targetUrl!;
            }}
          >
            <Text>{stringFormatter.format("veiNewUrlReadyBody")}</Text>
          </AlertDialog>
        )}
      </DialogContainer>

      {/* The 3-way rename choice (Phase 9) - mirrors the admin's ItemPage
          AlertDialog. Only offered when the collection declares a
          previewUrl (see Toolbar's collectionConfig lookups) - without one
          there's no public URL to redirect *from*, so choosing either
          primary/secondary action here just proceeds with no redirect. */}
      <DialogContainer onDismiss={() => setRenameDialogOpen(false)}>
        {renameDialogOpen && pendingRename && (() => {
          const collectionConfig = config.collections?.[
            pendingRename.ref.name
          ] as { label?: string; previewUrl?: string } | undefined;
          const previewUrl = collectionConfig?.previewUrl;
          const fromUrl = previewUrl?.replace("{slug}", pendingRename.ref.slug);
          const toUrl = previewUrl?.replace("{slug}", pendingRename.newSlug);
          return (
            <AlertDialog
              title={stringFormatter.format("veiRenameUrlTitle")}
              tone="neutral"
              cancelLabel={stringFormatter.format("cancel")}
              secondaryActionLabel={stringFormatter.format("veiRenameNoRedirect")}
              primaryActionLabel={stringFormatter.format("veiCreateRedirect301")}
              autoFocusButton="primary"
              onCancel={() => setRenameDialogOpen(false)}
              onSecondaryAction={() => {
                setRenameAddRedirect(false);
                setRenameDialogOpen(false);
                proceedAfterRenameChoice();
              }}
              onPrimaryAction={() => {
                setRenameAddRedirect(true);
                setRenameDialogOpen(false);
                proceedAfterRenameChoice();
              }}
            >
              <Text>
                {fromUrl && toUrl
                  ? stringFormatter.format("veiRenameUrlBody", { fromUrl, toUrl })
                  : stringFormatter.format("veiRenameUrlBodyFallback")}
              </Text>
            </AlertDialog>
          );
        })()}
      </DialogContainer>

      {/* Confirms before Save's now-heavier effect: it doesn't just write a
          file, it either merges a brand branch into main (kicking off a
          production deploy) or, when already on main, commits and deploys
          straight to production with no merge step. Local mode has no
          merge/deploy step (see onSave above) so never opens this. */}
      <DialogContainer onDismiss={() => setConfirmSaveOpen(false)}>
        {confirmSaveOpen && (
          <AlertDialog
            title={
              isOnDefaultBranch
                ? stringFormatter.format("veiSaveToMainTitle")
                : stringFormatter.format("veiSaveDeployTitle")
            }
            tone="neutral"
            cancelLabel={stringFormatter.format("cancel")}
            primaryActionLabel={
              isOnDefaultBranch
                ? stringFormatter.format("veiSaveToMain")
                : stringFormatter.format("veiSaveAndDeploy")
            }
            autoFocusButton="cancel"
            onCancel={() => setConfirmSaveOpen(false)}
            onPrimaryAction={() => {
              setConfirmSaveOpen(false);
              void runSave();
            }}
          >
            <Text>
              {isOnDefaultBranch
                ? stringFormatter.format("veiConfirmSaveMainBody")
                : stringFormatter.format("veiConfirmSaveDeployBody")}
            </Text>
          </AlertDialog>
        )}
      </DialogContainer>

      {refOpen &&
        entryList.length > 0 &&
        createPortal(
          <div
            className="dry-ref-menu"
            role="menu"
            style={{ left: refPos.left, bottom: refPos.bottom }}
            onMouseEnter={openRefMenu}
            onMouseLeave={scheduleCloseRefMenu}
          >
            {entryList.map((e) => (
              <button
                type="button"
                role="menuitem"
                key={e.key}
                className="dry-ref-item"
                onMouseEnter={() => flashEntry(e.key, true)}
                onMouseLeave={() => flashEntry(e.key, false)}
                onClick={() => goToAdmin(e.ref)}
              >
                <span className="dry-ref-name">{e.label}</span>
              </button>
            ))}
          </div>,
          document.body,
        )}

      {arrayGearSpot &&
        (() => {
          // An array with zero items has no template to seed the dialog's
          // shape from (see bind.ts's captureArrayTemplate) - disable rather
          // than open an editor with nothing to show. An object has no such
          // "empty" state (every field always exists per schema), so it's
          // never disabled.
          const value =
            arrayGearSpot.kind === "array"
              ? getContainerValueFromDom(arrayGearSpot.key)
              : null;
          const gearLabel =
            arrayGearSpot.kind === "array"
              ? stringFormatter.format("veiEditList")
              : stringFormatter.format("veiEditFields");
          return createPortal(
            <button
              type="button"
              className="dry-array-gear"
              aria-label={gearLabel}
              data-dry-tooltip={gearLabel}
              disabled={
                arrayGearSpot.kind === "array" &&
                (!Array.isArray(value) || value.length === 0)
              }
              style={{
                top: arrayGearSpot.rect.top + 6,
                right: window.innerWidth - arrayGearSpot.rect.right + 6,
              }}
              onMouseEnter={() => clearTimeout(arrayGearCloseTimer.current)}
              onMouseLeave={() => {
                arrayGearCloseTimer.current = setTimeout(() => {
                  arrayGearElRef.current = null;
                  setArrayGearSpot(null);
                }, 140);
              }}
              onClick={() => {
                if (!requireProviderReady()) return;
                setArrayDialogKey(arrayGearSpot.key);
                arrayGearElRef.current = null;
                setArrayGearSpot(null);
              }}
            >
              <Icon
                src={arrayGearSpot.kind === "array" ? listIcon : bracesIcon}
              />
            </button>,
            document.body,
          );
        })()}

      {slugGearSpot &&
        createPortal(
          <button
            type="button"
            className="dry-array-gear dry-slug-gear"
            aria-label={stringFormatter.format("veiChangeUrl")}
            data-dry-tooltip={stringFormatter.format("veiChangeUrl")}
            style={{
              top: slugGearSpot.rect.top + 6,
              right: window.innerWidth - slugGearSpot.rect.right + 6,
            }}
            onMouseEnter={() => clearTimeout(slugGearCloseTimer.current)}
            onMouseLeave={() => {
              slugGearCloseTimer.current = setTimeout(() => {
                slugGearElRef.current = null;
                setSlugGearSpot(null);
              }, 140);
            }}
            onClick={() => {
              setSlugDialogSpot({
                ref: slugGearSpot.ref,
                slugField: slugGearSpot.slugField,
              });
              slugGearElRef.current = null;
              setSlugGearSpot(null);
            }}
          >
            <Icon src={linkIcon} />
          </button>,
          document.body,
        )}

      {/* Real admin UI (Phase 9) - renders the collection's actual
          fields.slug schema.Input (SlugFieldInput), wrapped in the same
          PathContext/SlugFieldContext it expects, so Name+Slug editing here
          is byte-for-byte the admin's own component (auto-follow, Regenerate
          with real collision-bump against sibling slugs, validation
          messages) - see SlugFieldDialog below. The inline contentEditable
          title spot stays independently editable throughout; this dialog is
          an additional surface, not a replacement for it. */}
      <DialogContainer onDismiss={() => setSlugDialogSpot(null)}>
        {slugDialogSpot && (
          <SlugFieldDialog
            config={config}
            entryRef={slugDialogSpot.ref}
            slugField={slugDialogSpot.slugField}
            currentSlug={
              pendingRename &&
              entryRefKey(pendingRename.ref) === entryRefKey(slugDialogSpot.ref)
                ? pendingRename.newSlug
                : slugDialogSpot.ref.slug
            }
            onClose={() => setSlugDialogSpot(null)}
            onConfirm={(newSlug) => {
              setPendingRename(
                newSlug === null ? null : { ref: slugDialogSpot.ref, newSlug },
              );
              refreshCount();
            }}
          />
        )}
      </DialogContainer>

      <DialogContainer onDismiss={() => setReviewOpen(false)}>
        {reviewOpen && (
          <VeiReviewDialog
            config={config}
            onChange={refreshCount}
            onResetAll={onReset}
          />
        )}
      </DialogContainer>

      {/* The admin provider boundary - mounted whenever edit mode is on (see
          the providerState effect above). FileManagerHost makes
          openMediaLibrary() available for both the inline image/file spot
          click handlers and the field-editor dialog below; the container
          dialog renders inside the boundary since its element/fields schema
          may mount the admin's real ImageFieldInput/FileFieldInput, which
          need this context (useConfig/useMediaLibraryPreviewURL/tree data). */}
      {providerState.status === "ready" && (
        <Suspense fallback={null}>
          <VeiAdminProviders
            config={config}
            basePath={adminBase}
            currentBranch={providerState.currentBranch}
          >
            <FileManagerHost />
            {/* fields.content spots edit in place rather than through a
                dialog, so these mount for as long as edit mode is on. They
                live inside the boundary because the content editor can open
                the media library for embedded images. */}
            <InlineContentEditors
              config={config}
              onChange={refreshCount}
              currentBranch={providerState.currentBranch}
            />
            <DialogContainer onDismiss={() => setArrayDialogKey(null)}>
              {arrayDialogKey && (
                <ContainerFieldDialog
                  config={config}
                  fieldKey={arrayDialogKey}
                  onClose={() => setArrayDialogKey(null)}
                  onSaved={() => {
                    refreshCount();
                    setSpots(readSpots(config));
                  }}
                />
              )}
            </DialogContainer>
          </VeiAdminProviders>
        </Suspense>
      )}
    </div>
  );
}

// The one asset-picking primitive shared by the single-image and single-file
// spot click handlers above - opens the same file-manager dialog the admin's
// ImageFieldInput/FileFieldInput use (scoped to this entry's assets folder),
// caches the picked bytes locally so previews and saves can resolve before
// the file is servable, and returns the pick. Callers differ only in
// `accept`; the container dialog's own image/file sub-fields go through
// the real ImageFieldInput/FileFieldInput instead (see ContainerFieldDialog).
async function pickAsset(
  config: Config<any, any>,
  ref: EntryRef,
  accept: "image" | "any",
  label: string,
): Promise<MediaLibraryPick | undefined> {
  let picked: MediaLibraryPick | undefined;
  try {
    picked = await openMediaLibrary({
      accept,
      local: {
        directory: `${resolveEntryRef(config, ref).dir}/assets`,
        label,
      },
    });
  } catch (err) {
    toastQueue.critical(err instanceof Error ? err.message : String(err));
    return undefined;
  }
  if (!picked) return undefined;
  await putPendingBlob(picked.path, picked.content);
  return picked;
}

// Resolves a dotted field path (e.g. "sections.0.items") against an entry's
// schema, walking one segment at a time the same way dry.ts's resolveDrySpot
// does server-side - a numeric segment steps into an array's `.element`, a
// name segment steps into an object's `.fields[name]`. A flat `schema[field]`
// lookup (the old code here) only resolves a top-level field name; any
// nested container path - an array item's own object wrapper ("sections.0"),
// a sub-field array nested inside it ("sections.0.items"), or even a
// one-level-deep nested array under a standalone object ("info.links") -
// would resolve to `undefined` and silently render nothing (see
// plan/de-quy-object.md, and Toolbar's onOver hover-detection, which shows
// the gear button for any such spot regardless of whether this resolves -
// the dialog looked like it "wouldn't open").
function resolveFieldSchema(
  config: Config<any, any>,
  ref: EntryRef,
  field: string,
): ArrayField<ComponentSchema> | ObjectField | undefined {
  const [baseField, ...rest] = field.split(".");
  let schema: ComponentSchema | undefined =
    resolveEntryRef(config, ref).schema[baseField];
  for (const seg of rest) {
    if (!schema) return undefined;
    if (schema.kind === "array" && /^\d+$/.test(seg)) {
      schema = schema.element;
    } else if (schema.kind === "object") {
      schema = schema.fields[seg];
    } else {
      return undefined;
    }
  }
  return schema?.kind === "array" || schema?.kind === "object"
    ? schema
    : undefined;
}

// The slice of a fields.slug schema this dialog drives - see the field's own
// definition (packages/drystack/src/form/fields/slug/index.tsx). `Input` is
// the field's own SlugFieldInput (Name+Slug together, auto-follow, Regenerate
// with collision-bump, inline validation - all its own logic, none of it
// reimplemented here), and `validate` is the same function save.ts's
// validateField calls at save time - reusing both directly is what makes
// this dialog byte-for-byte the admin's own UI instead of a copy that could
// drift from it.
type SlugFieldSchema = {
  Input: (props: {
    value: { name: string; slug: string };
    onChange: (value: { name: string; slug: string }) => void;
    autoFocus?: boolean;
    forceValidation?: boolean;
  }) => React.ReactElement;
  validate(
    value: { name: string; slug: string },
    args?: { slugField?: SlugFieldInfo },
  ): unknown;
};

// Renders the collection's real fields.slug Input for one entry, opened from
// the slug-rename gear button over its slugField spot (Phase 9). Reuses the
// exact admin component via PathContextProvider/SlugFieldProvider (from
// @drystack/core/field-editor) - SlugFieldInput only turns on its real
// uniqueness/collision-bump logic when it can see PathContext === [the
// collection's configured slugField] and a SlugFieldContext carrying real
// sibling slugs (form/fields/slug/ui.tsx's own gate), which is why this
// wraps those directly rather than going through
// FormValueContentFromPreviewProps (that always resets PathContext to `[]`,
// correct for a whole-form root but wrong for one standalone field).
//
// Editing Name here writes back to the *same* bus key the inline
// contentEditable title spot uses (editKey(entryRef, slugField)) - so
// confirming here repaints that live spot too - but only on "Xong", not on
// every keystroke, so the underlying page's own inline editing (still
// available the whole time, independent of this dialog) never gets fought
// over by two live writers at once.
function SlugFieldDialog({
  config,
  entryRef,
  slugField,
  currentSlug,
  onClose,
  onConfirm,
}: {
  config: Config<any, any>;
  entryRef: Extract<EntryRef, { type: "collection" }>;
  slugField: string;
  currentSlug: string;
  onClose: () => void;
  onConfirm: (newSlug: string | null) => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const schema = resolveEntryRef(config, entryRef).schema[
    slugField
  ] as unknown as SlugFieldSchema | undefined;
  const glob = getSlugGlobForCollection(config, entryRef.name);
  const [siblingSlugs, setSiblingSlugs] = useState<Set<string> | null>(null);
  const checking = siblingSlugs === null;

  useEffect(() => {
    let cancelled = false;
    getCurrentBranchName(config)
      .then((branch) => listCollectionSlugs(config, entryRef.name, branch))
      .then((slugs) => {
        if (cancelled) return;
        const set = new Set(slugs);
        set.delete(entryRef.slug);
        setSiblingSlugs(set);
      })
      .catch((err) => {
        if (cancelled) return;
        toastQueue.critical(err instanceof Error ? err.message : String(err));
        setSiblingSlugs(new Set());
      });
    return () => {
      cancelled = true;
    };
  }, [config, entryRef.name, entryRef.slug]);

  const originalNameRef = useRef<string | null>(null);
  if (originalNameRef.current === null) {
    // The title spot is contentEditable and already reflects any pending
    // edit (or a not-yet-published keystroke) - seed from the live DOM text
    // rather than the on-disk value, so this dialog agrees with whatever the
    // user's actually looking at.
    originalNameRef.current =
      document
        .querySelector<HTMLElement>(
          `[data-dry="${CSS.escape(editKey(entryRef, slugField))}"]`,
        )
        ?.textContent?.trim() ?? "";
  }
  const [value, setValue] = useState({
    name: originalNameRef.current,
    slug: currentSlug,
  });
  const [forceValidation, setForceValidation] = useState(false);
  const formId = useId();

  const slugFieldInfo: SlugFieldInfo = {
    field: slugField,
    slugs: siblingSlugs ?? new Set(),
    glob,
  };

  const handleDone = async () => {
    if (!schema) return;
    try {
      schema.validate(value, { slugField: slugFieldInfo });
    } catch {
      setForceValidation(true);
      return;
    }
    const key = editKey(entryRef, slugField);
    if (value.name !== originalNameRef.current) {
      await publishEdit(key, value.name);
      applyEdit(key, value.name);
    }
    onConfirm(value.slug === entryRef.slug ? null : value.slug);
    onClose();
  };

  const Input = schema?.Input;

  return (
    <Dialog size="small">
      <Heading>{stringFormatter.format("veiSlugDialogTitle")}</Heading>
      <Content>
        <VStack
          id={formId}
          elementType="form"
          onSubmit={(event: FormEvent) => {
            if (event.target !== event.currentTarget) return;
            event.preventDefault();
            void handleDone();
          }}
          gap="xxlarge"
        >
          {Input && (
            <PathContextProvider value={[slugField]}>
              <SlugFieldProvider value={slugFieldInfo}>
                <Input
                  value={value}
                  onChange={setValue}
                  autoFocus
                  forceValidation={forceValidation}
                />
              </SlugFieldProvider>
            </PathContextProvider>
          )}
        </VStack>
      </Content>
      <ButtonGroup>
        <Button onPress={onClose}>{stringFormatter.format("cancel")}</Button>
        <Button
          form={formId}
          prominence="high"
          type="submit"
          isDisabled={checking}
        >
          {stringFormatter.format("done")}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

// Renders the container editor for one fields.array or fields.object field
// (at any nesting depth), seeded from its current live value (already up to
// date with any pending item/sub-field edits - see bind.ts's
// getContainerValueFromDom). Renders the admin's own ArrayFieldInput/
// ObjectFieldInput unmodified (via FormValueContentFromPreviewProps, since no
// Input override is set) - its Add/Edit modals mount the real per-element
// Input (ImageFieldInput/FileFieldInput/ObjectFieldInput/ArrayFieldInput/…),
// the same as inside the admin app, now that this dialog is mounted inside
// the admin provider boundary (see Toolbar's VeiAdminProviders). Config
// schema is never touched.
function ContainerFieldDialog({
  config,
  fieldKey,
  onClose,
  onSaved,
}: {
  config: Config<any, any>;
  fieldKey: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const parsedKey = parseEditKey(fieldKey);
  const ref: EntryRef | undefined = parsedKey
    ? parsedKey.type === "singleton"
      ? { type: "singleton", name: parsedKey.name }
      : { type: "collection", name: parsedKey.name, slug: parsedKey.slug }
    : undefined;
  const field = parsedKey?.field ?? "";
  const fieldSchema = ref
    ? resolveFieldSchema(config, ref, field)
    : undefined;
  // unknown[] for array-of-*, Record<string, unknown> for a standalone
  // object - whichever shape `fieldSchema.kind` calls for.
  // getContainerValueFromDom mirrors that dispatch off the same live spot,
  // so its result already matches; the fallback only matters before the
  // schema itself has resolved (first render).
  const [value, setValue] = useState<unknown>(() => {
    const v = getContainerValueFromDom(fieldKey);
    if (v !== undefined) return v;
    return fieldSchema?.kind === "object" ? {} : [];
  });
  const [forceValidation, setForceValidation] = useState(false);
  const formId = useId();

  const getPreviewProps = useMemo(
    () =>
      fieldSchema
        ? // ArrayField<ComponentSchema>'s element / ObjectField's fields are
          // the broad ComponentSchema union, so ParsedValueForComponentSchema
          // resolves to a wide type that setValue's updater doesn't
          // structurally match - this dialog's scope (any array/object
          // nesting of text/image/file, see plan/de-quy-object.md)
          // guarantees the runtime shape lines up.
          createGetPreviewProps(fieldSchema, setValue as any, () => undefined)
        : undefined,
    [fieldSchema],
  );

  if (!ref || !fieldSchema || !getPreviewProps) return null;
  // Same wide-type situation as setValue above - getPreviewProps expects the
  // schema-shaped value (array or object), which `value` always is at
  // runtime once seeded from getContainerValueFromDom/the schema-kind
  // default, just not provable from `unknown` alone.
  const previewProps = getPreviewProps(value as any);

  const onDone = async () => {
    if (!clientSideValidateProp(fieldSchema, value, undefined)) {
      setForceValidation(true);
      return;
    }
    // A whole-container replace supersedes any inline item/sub-field edits
    // already queued for it (typed into a leaf spot before this dialog was
    // opened) - otherwise a stale per-path edit would win back over this
    // path when the file is written (see save.ts's mergeFieldEdits, which
    // layers per-path edits on top of the container edit).
    const edits = await getAllEdits();
    const itemPrefix = `${fieldKey}.`;
    await Promise.all(
      edits
        .filter((e) => e.key.startsWith(itemPrefix))
        .map((e) => publishDelete(e.key)),
    );
    const busValue = JSON.stringify(value);
    await publishEdit(fieldKey, busValue);
    await applyEdit(fieldKey, busValue);
    onSaved();
    onClose();
  };

  return (
    <Dialog>
      <Heading>{fieldSchema.label}</Heading>
      <Content>
        {/* Scopes any image/file sub-field's "this entry's assets" tab to
            this entry's own directory, matching SingletonPage.tsx's own
            EntryDirectoryProvider usage. */}
        <EntryDirectoryProvider value={resolveEntryRef(config, ref).dir}>
          <VStack
            id={formId}
            elementType="form"
            onSubmit={(event: FormEvent) => {
              if (event.target !== event.currentTarget) return;
              event.preventDefault();
              onDone();
            }}
            gap="xxlarge"
          >
            <FormValueContentFromPreviewProps
              autoFocus
              {...previewProps}
              forceValidation={forceValidation}
            />
          </VStack>
        </EntryDirectoryProvider>
      </Content>
      <ButtonGroup>
        <Button onPress={onClose}>{stringFormatter.format("cancel")}</Button>
        <Button form={formId} prominence="high" type="submit">
          {stringFormatter.format("done")}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

function VeiReviewDialog({
  config,
  onChange,
  onResetAll,
}: {
  config: Config<any, any>;
  onChange: () => void;
  onResetAll: () => void;
}) {
  const [changes, setChanges] = useState<FieldChange[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPendingChanges(config).then((list) => {
      if (cancelled) return;
      setChanges(list);
    });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Discard a single field's edit: drop it from the store, revert the live DOM
  // back to its original value (text or image - see bind.ts), and refresh the
  // toolbar's pending count.
  const handleDelete = async (key: string) => {
    await publishDelete(key);
    revertFieldToOriginal(key);
    setChanges((cs) => cs?.filter((c) => c.key !== key) ?? null);
    onChange();
  };

  return (
    <ChangePreviewDialog
      changes={changes}
      onDelete={handleDelete}
      onResetAll={onResetAll}
      renderImage={(path: string) => <VeiImageThumb path={path} />}
    />
  );
}

// Prefers the pending-blob cache (see edit-sync.ts) over the raw path, same
// as bind.ts's paintImage - a freshly picked file's bytes are known locally
// before it's guaranteed servable at its path (github mode needs a deploy to
// catch up).
function VeiImageThumb({ path }: { path: string }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!path) {
      setBlobUrl(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    getPendingBlob(path).then((bytes) => {
      if (cancelled || !bytes) return;
      createdUrl = URL.createObjectURL(new Blob([bytes as any]));
      setBlobUrl(createdUrl);
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [path]);

  return <ImageThumbFrame path={path} src={blobUrl ?? path} />;
}
