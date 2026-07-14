import React, {
  FormEvent,
  lazy,
  Suspense,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ArrayField, ComponentSchema, Config } from '@drystack/core';
import { getSingletonPath } from '@drystack/core/path-utils';
import {
  openMediaLibrary,
  waitForMediaLibraryOpener,
  type MediaLibraryPick,
} from '@drystack/core/media-library-bridge';
// @ts-expect-error — provided by the drystack Astro integration's Vite plugin
import apiPath from 'virtual:drystack-path';
import { Badge } from '@keystar/ui/badge';
import { ActionButton, Button, ButtonGroup } from '@keystar/ui/button';
import { Dialog, DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { editIcon } from '@keystar/ui/icon/icons/editIcon';
import { xIcon } from '@keystar/ui/icon/icons/xIcon';
import { saveIcon } from '@keystar/ui/icon/icons/saveIcon';
import { eyeIcon } from '@keystar/ui/icon/icons/eyeIcon';
import { externalLinkIcon } from '@keystar/ui/icon/icons/externalLinkIcon';
import { rotateCcwIcon } from '@keystar/ui/icon/icons/rotateCcwIcon';
import { rocketIcon } from '@keystar/ui/icon/icons/rocketIcon';
import { slidersIcon } from '@keystar/ui/icon/icons/slidersIcon';
import { VStack } from '@keystar/ui/layout';
import { Content } from '@keystar/ui/slots';
import { toastQueue } from '@keystar/ui/toast';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';
import { Heading } from '@keystar/ui/typography';
import {
  ChangePreviewDialog,
  ImageThumbFrame,
  type FieldChange,
} from '@drystack/core/change-preview';
import {
  createGetPreviewProps,
  FormValueContentFromPreviewProps,
  clientSideValidateProp,
} from '@drystack/core/field-editor';
import {
  enableEditing,
  disableEditing,
  getArrayValueFromDom,
  getOriginalValue,
  refreshFromLatestSource,
  resetPendingEdits,
  applyEdit,
  revertFieldToOriginal,
  setImageSpotClickHandler,
} from './bind';
import {
  getAllEdits,
  publishDelete,
  publishEdit,
  subscribeEdits,
  putPendingBlob,
  getPendingBlob,
} from './store';
import { saveEdits, getCurrentBranchName, getGithubToken } from './save';
import { brandDisplayLabel } from '@drystack/core/brand-label';
import { CloudflareStatusCompact } from '@drystack/core/deploy-cloudflare-status';
import { useVeiDeploy } from './deploy';

// Loaded lazily (only once the visual editor actually needs to open the
// image picker) — this chunk pulls in urql + graphcache + the admin's file
// manager, which would otherwise bloat every live-site page's JS payload.
const VeiMediaHost = lazy(() =>
  import('@drystack/core/media-host').then(m => ({ default: m.VeiMediaHost }))
);

type Spot = { key: string; name: string; field: string };

// The single source of truth for "what's actually pending" — reads
// IndexedDB via getAllEdits() and drops any entry whose value happens to
// equal its captured original (e.g. typed then reverted by hand). Shared by
// the toolbar's badge/Save-Reset-enabled state and the review dialog's list
// so the two can never disagree about whether there's anything to review.
//
// `kind` is read straight off the matching DOM element's data-dry-kind
// (rather than threaded through from config) since that's the same
// attribute bind.ts already dispatches on to paint the value — one fewer
// thing that could disagree. Defaults to 'text' if no matching element is on
// this page (e.g. a pending edit for a singleton not rendered here).
//
// `label` is resolved from the singleton's own schema (same `field.label ??
// key` fallback as the admin's computeFieldChanges) rather than the raw
// field key, so the review dialog reads identically in the admin and here —
// see CLAUDE.md's UI-consistency expectations for this shared component.
async function getPendingChanges(config: Config<any, any>): Promise<FieldChange[]> {
  const edits = await getAllEdits();
  return edits
    .map(e => {
      const [, name, field] = e.key.split('::');
      const el = document.querySelector<HTMLElement>(
        `[data-dry="${CSS.escape(e.key)}"]`
      );
      const kind: 'text' | 'image' =
        el?.getAttribute('data-dry-kind') === 'image' ? 'image' : 'text';
      const fieldSchema = config.singletons?.[name]?.schema?.[field] as
        | { label?: string }
        | undefined;
      return {
        key: e.key,
        label: fieldSchema?.label ?? field,
        kind,
        before: getOriginalValue(e.key) ?? '',
        after: e.value,
      };
    })
    .filter(c => c.before !== c.after);
}

const adminBase = `/${String(apiPath).replace(/^\/+|\/+$/g, '')}`;

// Whether the edit-mode toolbar was expanded, persisted across reloads —
// without this, refreshing the page while editing silently drops back to
// view mode (pending edits themselves already survive via IndexedDB, see
// bind.ts's applyPendingEdits, but the toolbar/contentEditable state didn't).
const EDITING_STORAGE_KEY = 'drystack-vei-editing';

function readStoredEditing(): boolean {
  try {
    return localStorage.getItem(EDITING_STORAGE_KEY) === '1';
  } catch {
    // localStorage can throw (e.g. blocked cookies) — just won't persist.
    return false;
  }
}

function writeStoredEditing(value: boolean): void {
  try {
    if (value) localStorage.setItem(EDITING_STORAGE_KEY, '1');
    else localStorage.removeItem(EDITING_STORAGE_KEY);
  } catch {
    // Same as above — best-effort persistence only.
  }
}

// Every editable spot rendered on the current page, read from the DOM.
// Deduped by key — the same field can appear on multiple elements (e.g. a
// site title in both the header and footer), and consumers below need one
// entry per key, not one per DOM node, since they re-query all matching
// elements by key when they need to touch the DOM.
function readSpots(): Spot[] {
  const seen = new Set<string>();
  const spots: Spot[] = [];
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    const key = el.getAttribute('data-dry');
    if (!key || seen.has(key)) return;
    const [type, name, field] = key.split('::');
    if (type === 'singleton' && name && field) {
      seen.add(key);
      spots.push({ key, name, field });
    }
  });
  return spots;
}

export function Toolbar({ config }: { config: Config<any, any> }) {
  const [editing, setEditing] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [saving, setSaving] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [spots, setSpots] = useState<Spot[]>([]);

  // Array-field gear button — a floating icon portaled to <body>, shown
  // while hovering any fields.array container spot in edit mode (identified
  // by data-dry-kind="array", set server-side by dry.item()), positioned
  // over that element via getBoundingClientRect. Clicking it opens
  // ArrayFieldDialog, which renders the exact admin editor for that array
  // (see field-editor.tsx re-exports).
  const [arrayGearSpot, setArrayGearSpot] = useState<{
    key: string;
    rect: DOMRect;
  } | null>(null);
  const [arrayDialogKey, setArrayDialogKey] = useState<string | null>(null);
  const arrayGearCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  );
  // The element currently backing arrayGearSpot, kept around purely so
  // scroll/resize can recompute its rect — getBoundingClientRect() is
  // viewport-relative and goes stale the instant the page scrolls.
  const arrayGearElRef = useRef<HTMLElement | null>(null);

  // Deploy menu — a second pill (brand name + Deploy), github-only, mutually
  // exclusive with the edit menu it sits beside.
  const isGithub = config.storage.kind === 'github';
  const [deployOpen, setDeployOpen] = useState(false);
  const {
    brand,
    deploy,
    refreshBrand,
    isBusy: deployBusy,
    label: deployLabel,
    hasChanges: deployHasChanges,
  } = useVeiDeploy(config);

  // Hover dropdown state — the menu itself is portaled to <body>.
  const refWrapRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [refOpen, setRefOpen] = useState(false);
  const [refPos, setRefPos] = useState({ left: 0, bottom: 0 });

  const refreshCount = async () => {
    setPendingCount((await getPendingChanges(config)).length);
  };

  useEffect(() => {
    refreshCount();
    setSpots(readSpots());
    // Restore edit mode if it was on before the last reload (see
    // EDITING_STORAGE_KEY above).
    if (readStoredEditing()) startEditing();
    // Keep the badge/review-dialog count accurate when edits arrive from
    // another tab (admin or another visual-editor tab), not just this one.
    return subscribeEdits(() => refreshCount());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Hover detection for the array-field gear button — only active in edit
  // mode. Delegated at the document level (capture phase) rather than one
  // listener per spot, since spots can appear/disappear as the array grows
  // or shrinks via template-clone (see bind.ts's renderArray).
  useEffect(() => {
    if (!editing) {
      arrayGearElRef.current = null;
      setArrayGearSpot(null);
      return;
    }
    const onOver = (e: MouseEvent) => {
      const el = (e.target as HTMLElement)?.closest<HTMLElement>(
        '[data-dry-kind="array"]'
      );
      if (!el) return;
      const key = el.getAttribute('data-dry');
      if (!key) return;
      clearTimeout(arrayGearCloseTimer.current);
      arrayGearElRef.current = el;
      setArrayGearSpot({ key, rect: el.getBoundingClientRect() });
    };
    const onOut = (e: MouseEvent) => {
      const related = e.relatedTarget as HTMLElement | null;
      if (
        related?.closest('[data-dry-kind="array"]') ||
        related?.closest('.dry-array-gear')
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
      setArrayGearSpot(prev => (prev ? { ...prev, rect: el.getBoundingClientRect() } : prev));
    };
    document.addEventListener('mouseover', onOver, true);
    document.addEventListener('mouseout', onOut, true);
    document.addEventListener('scroll', onReposition, true);
    window.addEventListener('resize', onReposition);
    return () => {
      document.removeEventListener('mouseover', onOver, true);
      document.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('scroll', onReposition, true);
      window.removeEventListener('resize', onReposition);
      clearTimeout(arrayGearCloseTimer.current);
    };
  }, [editing]);

  // The admin's media-library picker (VeiMediaHost) — lazy-mounted once an
  // image spot is actually clicked, not on every page load (see the lazy()
  // import above). `mediaHostBranch` only matters in github mode; resolved
  // once, right before the first mount, into a ref rather than state since
  // nothing needs to re-render off it changing.
  const [mediaHostMounted, setMediaHostMounted] = useState(false);
  const mediaHostBranchRef = useRef('');

  // Mounts VeiMediaHost on first use and waits for its FileManagerHost to
  // finish registering the picker (registerMediaLibraryOpener runs in an
  // effect, one or more renders after the mount is requested — see
  // waitForMediaLibraryOpener). Returns false (after surfacing a toast) if
  // github mode has no admin session — mounting the host without one would
  // hit the shell's own "not authenticated" redirect, which would navigate
  // this live-site tab to the admin login page.
  const ensureMediaHostMounted = async (): Promise<boolean> => {
    if (!mediaHostMounted) {
      if (isGithub) {
        if (!getGithubToken()) {
          toastQueue.critical('Cần đăng nhập admin để đổi ảnh.');
          return false;
        }
        try {
          mediaHostBranchRef.current = (await getCurrentBranchName(config)) ?? '';
        } catch (err) {
          toastQueue.critical(err instanceof Error ? err.message : String(err));
          return false;
        }
      }
      setMediaHostMounted(true);
    }
    const ready = await waitForMediaLibraryOpener();
    if (!ready) toastQueue.critical('Không thể mở thư viện media.');
    return ready;
  };

  // Wired to every fields.image spot's click (see bind.ts's
  // handleImageSpotClick) — opens the exact same file-manager dialog the
  // admin's ImageFieldInput uses, scoped to this singleton's own assets
  // folder (matching EntryDirectoryProvider's convention in SingletonPage.tsx).
  useEffect(() => {
    const handler = async (key: string) => {
      const ready = await ensureMediaHostMounted();
      if (!ready) return;
      const [, singletonName] = key.split('::');
      let pick: MediaLibraryPick | undefined;
      try {
        pick = await openMediaLibrary({
          accept: 'image',
          local: {
            directory: `${getSingletonPath(config, singletonName)}/assets`,
            label: 'Trang này',
          },
        });
      } catch (err) {
        toastQueue.critical(err instanceof Error ? err.message : String(err));
        return;
      }
      if (!pick) return;
      await putPendingBlob(pick.path, pick.content);
      await publishEdit(key, pick.path);
      await applyEdit(key, pick.path);
      refreshCount();
    };
    setImageSpotClickHandler(handler);
    return () => setImageSpotClickHandler(undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, isGithub, mediaHostMounted]);

  // Opening the edit/function menu closes the deploy menu (mutually
  // exclusive).
  const startEditing = () => {
    setDeployOpen(false);
    enableEditing(refreshCount);
    setSpots(readSpots());
    // Don't block entering edit mode on the network — repaint with the
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

  const toggleDeploy = () => {
    setDeployOpen(prev => {
      const next = !prev;
      if (next) {
        // Opening deploy closes the edit/function menu and exits edit mode
        // (disableEditing keeps pending edits — see bind.ts). Refresh the brand
        // shown in the pill in case another tab created/rotated it.
        if (editing) stopEditing();
        refreshBrand();
      }
      return next;
    });
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await saveEdits(config);
      // The write (commit or local disk) reflects the true source
      // immediately — re-sync the DOM from it rather than waiting for a
      // Cloudflare deploy to actually ship the change to the public site.
      await refreshFromLatestSource(config);
      await refreshCount();
      toastQueue.positive('Changes saved', { timeout: 4000 });
    } catch (err) {
      toastQueue.critical(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onReset = async () => {
    await resetPendingEdits();
    await refreshCount();
  };

  // Open the admin home in a new tab. Synchronous (fired straight from the
  // click) so the browser doesn't treat it as a blocked popup.
  const openAdminHome = () => {
    window.open(adminBase, '_blank', 'noopener,noreferrer');
  };

  // Deep-link to a singleton's admin editor in a new tab. github mode needs an
  // async branch lookup, so open the tab up front — preserving the click's user
  // activation — and point it at the URL once resolved; a window.open() issued
  // after the await would be killed by the popup blocker.
  const goToAdmin = async (name: string) => {
    const tab = window.open('', '_blank');
    if (tab) tab.opener = null;
    try {
      const branch = await getCurrentBranchName(config);
      const branchSegment = branch ? `branch/${encodeURIComponent(branch)}/` : '';
      const url = `${adminBase}/${branchSegment}singleton/${encodeURIComponent(name)}`;
      if (tab) tab.location.href = url;
      else window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      tab?.close();
      toastQueue.critical(err instanceof Error ? err.message : String(err));
    }
  };

  // Highlight (and scroll to) every editable spot belonging to a singleton.
  const flashSingleton = (name: string, on: boolean) => {
    const els = spots
      .filter(s => s.name === name)
      .flatMap(s =>
        Array.from(
          document.querySelectorAll<HTMLElement>(`[data-dry="${CSS.escape(s.key)}"]`)
        )
      );
    els.forEach(el => el.classList.toggle('dry-spot-flash', on));
    if (on && els[0]) {
      els[0].scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  // One entry per singleton (deduped), labelled from config.
  const singletonList = Array.from(
    new Map(
      spots.map(s => [
        s.name,
        (config.singletons?.[s.name] as { label?: string })?.label ?? s.name,
      ])
    )
  ).map(([name, label]) => ({ name, label }));

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

  const brandLabel = brand ? brandDisplayLabel(brand.label) : '';

  return (
    <div className="dry-bar">
      {/* Unified edit menu — a single pill that's always on screen. Collapsed
          it's just the edit FAB; enabling edit expands the action buttons out
          to the right (width collapse) and morphs the pencil into an ✕ that
          collapses the menu again. */}
      <div className={`dry-menu${editing ? ' is-open' : ''}`}>
        <div className="dry-menu-pill">
          {/* Toggle button — always visible, leads the pill. */}
          <Button
            prominence="high"
            aria-label={editing ? 'Exit edit mode' : 'Edit page'}
            onPress={toggleEdit}
            UNSAFE_className="dry-fab"
          >
            <span
              className={`dry-fab-icon dry-fab-icon--edit${editing ? ' is-hidden' : ''}`}
            >
              <Icon src={editIcon} />
            </span>
            <span
              className={`dry-fab-icon dry-fab-icon--x${editing ? '' : ' is-hidden'}`}
            >
              <Icon src={xIcon} />
            </span>
          </Button>

          {/* Collapsible action group — revealed only in edit mode. */}
          <div className="dry-menu-actions">
            <div className="dry-menu-actions-inner">
              <div
                className="dry-ref"
                ref={refWrapRef}
                onMouseEnter={openRefMenu}
                onMouseLeave={scheduleCloseRefMenu}
              >
                <ActionButton
                  aria-label="Open in drystack admin"
                  onPress={openAdminHome}
                  UNSAFE_className="dry-iconbtn"
                >
                  <Icon src={externalLinkIcon} />
                </ActionButton>
              </div>

              <TooltipTrigger>
                <div className="dry-review">
                  <ActionButton
                    aria-label="Review changes"
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
                <Tooltip>Review changes</Tooltip>
              </TooltipTrigger>

              <TooltipTrigger>
                <ActionButton
                  aria-label="Reset changes"
                  onPress={onReset}
                  isDisabled={nothingToSave || saving}
                  UNSAFE_className="dry-iconbtn"
                >
                  <Icon src={rotateCcwIcon} />
                </ActionButton>
                <Tooltip>Reset changes</Tooltip>
              </TooltipTrigger>

              <TooltipTrigger>
                <Button
                  aria-label="Save changes"
                  prominence="high"
                  onPress={onSave}
                  isDisabled={nothingToSave || saving}
                  UNSAFE_className="dry-iconbtn"
                >
                  <Icon src={saveIcon} />
                </Button>
                <Tooltip>{saving ? 'Saving…' : 'Save changes'}</Tooltip>
              </TooltipTrigger>
            </div>
          </div>
        </div>
      </div>

      {/* Deploy menu — same unified pill as the edit menu above, sitting to its
          right: collapsed it's just the rocket FAB; opening it expands the
          Cloudflare status indicator + deploy action out to the right and
          morphs the rocket into an ✕. The brand name isn't shown here (no
          room for its variable length) — it's the Deploy button's tooltip. */}
      {isGithub && (
        <div className={`dry-menu${deployOpen ? ' is-open' : ''}`}>
          <div className="dry-menu-pill">
            <Button
              prominence="high"
              aria-label={deployOpen ? 'Đóng menu deploy' : 'Mở menu deploy'}
              onPress={toggleDeploy}
              UNSAFE_className="dry-fab"
            >
              <span
                className={`dry-fab-icon dry-fab-icon--edit${deployOpen ? ' is-hidden' : ''}`}
              >
                <Icon src={rocketIcon} />
              </span>
              <span
                className={`dry-fab-icon dry-fab-icon--x${deployOpen ? '' : ' is-hidden'}`}
              >
                <Icon src={xIcon} />
              </span>
            </Button>

            <div className="dry-menu-actions">
              <div className="dry-menu-actions-inner">
                <CloudflareStatusCompact />

                <TooltipTrigger>
                  <Button
                    aria-label="Deploy"
                    prominence="high"
                    onPress={deploy}
                    isDisabled={deployBusy || !brand || !deployHasChanges}
                    UNSAFE_className="dry-iconbtn"
                  >
                    <Icon src={rocketIcon} />
                  </Button>
                  <Tooltip>{deployBusy ? deployLabel : brand ? brandLabel : 'Chưa có brand'}</Tooltip>
                </TooltipTrigger>
              </div>
            </div>
          </div>
        </div>
      )}

      {refOpen &&
        singletonList.length > 0 &&
        createPortal(
          <div
            className="dry-ref-menu"
            role="menu"
            style={{ left: refPos.left, bottom: refPos.bottom }}
            onMouseEnter={openRefMenu}
            onMouseLeave={scheduleCloseRefMenu}
          >
            {singletonList.map(s => (
              <button
                type="button"
                role="menuitem"
                key={s.name}
                className="dry-ref-item"
                onMouseEnter={() => flashSingleton(s.name, true)}
                onMouseLeave={() => flashSingleton(s.name, false)}
                onClick={() => goToAdmin(s.name)}
              >
                <span className="dry-ref-name">{s.label}</span>
              </button>
            ))}
          </div>,
          document.body
        )}

      {arrayGearSpot &&
        createPortal(
          <button
            type="button"
            className="dry-array-gear"
            aria-label="Edit list"
            disabled={(getArrayValueFromDom(arrayGearSpot.key)?.length ?? 0) === 0}
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
              setArrayDialogKey(arrayGearSpot.key);
              arrayGearElRef.current = null;
              setArrayGearSpot(null);
            }}
          >
            <Icon src={slidersIcon} />
          </button>,
          document.body
        )}

      <DialogContainer onDismiss={() => setReviewOpen(false)}>
        {reviewOpen && <VeiReviewDialog config={config} onChange={refreshCount} />}
      </DialogContainer>

      <DialogContainer onDismiss={() => setArrayDialogKey(null)}>
        {arrayDialogKey && (
          <ArrayFieldDialog
            config={config}
            fieldKey={arrayDialogKey}
            onClose={() => setArrayDialogKey(null)}
            onSaved={() => {
              refreshCount();
              setSpots(readSpots());
            }}
          />
        )}
      </DialogContainer>

      {mediaHostMounted && (
        <Suspense fallback={null}>
          <VeiMediaHost
            config={config}
            basePath={adminBase}
            currentBranch={mediaHostBranchRef.current}
          />
        </Suspense>
      )}
    </div>
  );
}

// Renders the exact admin editor (Add/Edit/Reorder/Delete) for one
// fields.array field, seeded from its current live value (already up to
// date with any pending item/container edits — see bind.ts's
// getArrayValueFromDom). Reuses the admin's own field-rendering engine via
// createGetPreviewProps + FormValueContentFromPreviewProps (see
// field-editor.tsx) instead of a bespoke reimplementation — MVP scope is
// array-of-fields.text only, see plan/vei-array-object.md.
function ArrayFieldDialog({
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
  const [, name, field] = fieldKey.split('::');
  const fieldSchema = config.singletons?.[name]?.schema?.[field] as
    | ArrayField<ComponentSchema>
    | undefined;
  const [value, setValue] = useState<string[]>(
    () => getArrayValueFromDom(fieldKey) ?? []
  );
  const [forceValidation, setForceValidation] = useState(false);
  const formId = useId();

  const getPreviewProps = useMemo(
    () =>
      fieldSchema
        ? // ArrayField<ComponentSchema>'s element is the broad ComponentSchema
          // union, so ParsedValueForComponentSchema resolves to a wide
          // `readonly unknown[]`-ish type that setValue's narrower
          // `string[]` updater doesn't structurally match — this dialog's
          // MVP scope (dry.ts only allows array-of-fields.text, see
          // plan/vei-array-object.md) guarantees the runtime shape is
          // always string[].
          createGetPreviewProps(fieldSchema, setValue as any, () => undefined)
        : undefined,
    [fieldSchema]
  );

  if (!fieldSchema || !getPreviewProps) return null;
  const previewProps = getPreviewProps(value);

  const onDone = async () => {
    if (!clientSideValidateProp(fieldSchema, value, undefined)) {
      setForceValidation(true);
      return;
    }
    // A whole-array replace supersedes any inline item edits already queued
    // for this array (typed into an item spot before this dialog was
    // opened) — otherwise a stale array.N edit would win back over this
    // index when the file is written (see save.ts's mergeFieldEdits, which
    // layers item edits on top of the container edit).
    const edits = await getAllEdits();
    const itemPrefix = `${fieldKey}.`;
    await Promise.all(
      edits.filter(e => e.key.startsWith(itemPrefix)).map(e => publishDelete(e.key))
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
      </Content>
      <ButtonGroup>
        <Button onPress={onClose}>Hủy</Button>
        <Button form={formId} prominence="high" type="submit">
          Xong
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

function VeiReviewDialog({
  config,
  onChange,
}: {
  config: Config<any, any>;
  onChange: () => void;
}) {
  const [changes, setChanges] = useState<FieldChange[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    getPendingChanges(config).then(list => {
      if (cancelled) return;
      setChanges(list);
    });
    return () => {
      cancelled = true;
    };
  }, [config]);

  // Discard a single field's edit: drop it from the store, revert the live DOM
  // back to its original value (text or image — see bind.ts), and refresh the
  // toolbar's pending count.
  const handleDelete = async (key: string) => {
    await publishDelete(key);
    revertFieldToOriginal(key);
    setChanges(cs => cs?.filter(c => c.key !== key) ?? null);
    onChange();
  };

  return (
    <ChangePreviewDialog
      changes={changes}
      onDelete={handleDelete}
      renderImage={(path: string) => <VeiImageThumb path={path} />}
    />
  );
}

// Prefers the pending-blob cache (see edit-sync.ts) over the raw path, same
// as bind.ts's paintImage — a freshly picked file's bytes are known locally
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
    getPendingBlob(path).then(bytes => {
      if (cancelled || !bytes) return;
      createdUrl = URL.createObjectURL(new Blob([bytes]));
      setBlobUrl(createdUrl);
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [path]);

  return <ImageThumbFrame path={path} src={blobUrl ?? path} />;
}
