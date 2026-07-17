import { useEffect, useRef, useState } from "react";
import type { Config, ComponentSchema } from "@drystack/core";
import {
  InlineDocumentEditor,
  type ContentEditorState as EditorState,
} from "@drystack/core/field-editor";
import { getSingletonPath } from "@drystack/core/path-utils";
import {
  contentAssetsDir,
  contentEntryDir,
  createLatestGuard,
  getPendingBlobsUnder,
  publishEdit,
  resolveSchemaAtFieldPath,
  stashContentBlobs,
  type LatestGuard,
  type StashedBlobs,
} from "./store";
import { setContentSpotPainter } from "./bind";
import { listAssetFiles } from "./save";

const textDecoder = new TextDecoder();

// The narrow slice of a fields.content schema this file drives. Typed
// structurally rather than importing content.Field so the editor bundle
// doesn't pull the field's own module graph in.
type ContentFieldSchema = {
  // Not parse(): the inline variant renders without the admin editor's own
  // block spacing, so the live page's typography is what shows while editing
  // (see the field's own inlineParse). Both produce the same HTML on the way
  // back out.
  inlineParse(
    html: string,
    other: ReadonlyMap<string, Uint8Array>,
  ): EditorState;
  serialize(
    value: EditorState,
    extra?: { slug?: undefined; entryDirectory?: string },
  ): {
    value: unknown;
    content?: Uint8Array;
    other: Map<string, Uint8Array>;
  };
};

function parseHtml(
  schema: ContentFieldSchema,
  html: string,
  other: ReadonlyMap<string, Uint8Array>,
): EditorState {
  return schema.inlineParse(html, other);
}

// `content` bytes are only present for a non-inline field (a separate .html
// file); an inline field's serialize() puts the HTML straight into `value`.
function htmlFromSerializeOutput(out: {
  value: unknown;
  content?: Uint8Array;
}): string {
  if (out.content !== undefined) return textDecoder.decode(out.content);
  return typeof out.value === "string" ? out.value : "";
}

function serializeHtml(
  schema: ContentFieldSchema,
  state: EditorState,
  entryDirectory: string,
): string {
  return htmlFromSerializeOutput(schema.serialize(state, { entryDirectory }));
}

type Spot = {
  key: string;
  el: HTMLElement;
  singletonName: string;
  schema: ContentFieldSchema;
};

// One live ProseMirror view bound to one `[data-dry-kind="content"]` element
// already on the page. Mounts as soon as edit mode turns on (like a text
// spot, unlike the array/object gear dialog) - the whole point is editing in
// place, so there's nothing to wait for a click on.
function InlineContentEditor({
  config,
  spot,
  onChange,
  currentBranch,
}: {
  config: Config<any, any>;
  spot: Spot;
  onChange: () => void;
  currentBranch: string;
}) {
  const { el, key, schema, singletonName } = spot;
  const field = key.split("::")[2];
  const [state, setState] = useState<EditorState | null>(null);
  // Nested (e.g. "brand.name") gets its own subdirectory so it can't collide
  // on an embedded image's filename with a sibling content field - see
  // contentEntryDir/contentAssetsDir.
  const singletonDir = getSingletonPath(config, singletonName);
  const entryDir = contentEntryDir(singletonDir, field);
  const assetsDir = contentAssetsDir(singletonDir, field);
  // This entry's assets/ bytes, kept for the lifetime of the editor: every
  // later re-parse (see the painter below) needs them just as much as the
  // first one does, and re-fetching per paint would be pointless network.
  //
  // Seeded from disk *and* from the bus's blob store, because an image the
  // admin has embedded but not yet saved exists only in the latter - parsing
  // its HTML without those bytes would repoint the image (see edit-sync.ts).
  const assetsRef = useRef<ReadonlyMap<string, Uint8Array>>(new Map());
  // Images this editor has already published bytes for - see stashContentBlobs.
  const stashedRef = useRef<StashedBlobs>(new Set());
  // Both the painter below and onChange's publish start a fresh async chain
  // (an IndexedDB blob read, or a stash-then-publish) with no debounce or
  // cancellation - typing fast, or two paints arriving close together, can
  // let an older chain resolve after a newer one and overwrite it. One
  // shared instance since painter (apply) and onChange (publish) both write
  // to this same editor's `state`/the bus and must agree on what's latest.
  const guardRef = useRef<LatestGuard>(createLatestGuard());

  // Reads the element's current HTML and turns it into an editor state, with
  // this entry's own assets/ bytes hydrated first (see listAssetFiles for why
  // that ordering is load-bearing). Kicked off on mount; nothing renders - and
  // so nothing touches the element - until it resolves, which leaves the
  // server-rendered HTML on screen in the meantime.
  useEffect(() => {
    let cancelled = false;
    const html = el.innerHTML;
    Promise.all([
      listAssetFiles(
        config,
        singletonName,
        currentBranch || undefined,
        field,
      ).catch(() => new Map<string, Uint8Array>()),
      getPendingBlobsUnder(assetsDir).catch(
        () => new Map<string, Uint8Array>(),
      ),
    ]).then(([saved, pending]) => {
      if (cancelled) return;
      // Pending wins: it's the newer copy of any name present in both.
      const other = new Map([...saved, ...pending]);
      assetsRef.current = other;
      setState(parseHtml(schema, html, other));
    });
    return () => {
      cancelled = true;
    };
  }, [config, el, schema, singletonName, field, assetsDir, currentBranch]);

  // Cleanup closures capture their variables at effect-setup time, so the
  // repaint below has to read the *latest* state through a ref rather than
  // the `state` binding it would otherwise close over (which would be
  // whatever it was when the effect last ran, i.e. the pre-edit doc).
  const stateRef = useRef(state);
  stateRef.current = state;

  // ProseMirror empties an externally-mounted node on destroy() instead of
  // leaving the last-rendered doc in it - so unlike every other spot kind,
  // this element would go blank the moment edit mode turned off. Repaint it
  // from the final state.
  //
  // Must stay a plain useEffect: the child ProseMirrorEditor destroys its
  // view in a *layout* effect cleanup, and only a passive cleanup here is
  // guaranteed to run after that. A previous attempt to make this a
  // useLayoutEffect (to fix an unrelated race) silently wiped the whole field
  // on every edit-mode toggle.
  useEffect(() => {
    return () => {
      const latest = stateRef.current;
      if (latest) el.innerHTML = serializeHtml(schema, latest, entryDir);
    };
  }, [el, schema, entryDir]);

  // Lets bind.ts hand this view any paint aimed at the element - a Reset, a
  // fresh value fetched from source, an edit arriving from another tab -
  // instead of assigning innerHTML underneath a live view. Registered even
  // before `state` resolves so a paint landing during that window isn't
  // applied directly and then immediately overwritten by the initial parse.
  useEffect(() => {
    return setContentSpotPainter(key, (html) => {
      // assetsRef, not an empty map - re-parsing without this entry's bytes
      // would repoint every embedded image (see listAssetFiles).
      //
      // Re-read the blob store first: an incoming paint can be an admin edit
      // that embedded an image this editor has never seen, whose bytes exist
      // nowhere else yet. Names already known keep their bytes, so this only
      // ever grows the map.
      //
      // Claimed before the read: two paints arriving close together each
      // start their own chain, and without this an older one resolving
      // after a newer one would setState back to stale content.
      const token = guardRef.current.claim(key);
      getPendingBlobsUnder(assetsDir)
        .catch(() => new Map<string, Uint8Array>())
        .then((pending) => {
          if (!guardRef.current.isCurrent(key, token)) return;
          const other = new Map([...assetsRef.current, ...pending]);
          assetsRef.current = other;
          setState(parseHtml(schema, html, other));
        });
    });
  }, [key, schema, assetsDir]);

  if (!state) return null;

  return (
    <InlineDocumentEditor
      mount={el}
      value={state}
      onChange={(next) => {
        setState(next);
        // One serialize for both halves of what a content edit publishes: the
        // HTML body, and the bytes of any image embedded in it that isn't on
        // disk yet. The bytes go first - see stashContentBlobs.
        //
        // Unthrottled - every keystroke starts its own stash-then-publish
        // chain. Claimed up front so a slow chain (e.g. a large embedded
        // image's stash) that's still running when a later keystroke's
        // chain already published drops its own publish instead of
        // overwriting the bus with older text.
        const token = guardRef.current.claim(key);
        const out = schema.serialize(next);
        stashContentBlobs(out.other, assetsDir, stashedRef.current)
          .then(() => {
            if (!guardRef.current.isCurrent(key, token)) return;
            return publishEdit(key, htmlFromSerializeOutput(out)).then(
              onChange,
            );
          })
          .catch(() => {
            // A blob failed to stash - publishing now would embed an image
            // reference the bus can't resolve yet (see stashContentBlobs).
            // Leave the bus untouched; the next keystroke retries the stash.
          });
      }}
      entryDirectory={entryDir}
    />
  );
}

function readContentSpots(config: Config<any, any>): Spot[] {
  const spots: Spot[] = [];
  document
    .querySelectorAll<HTMLElement>('[data-dry-kind="content"]')
    .forEach((el) => {
      const key = el.getAttribute("data-dry");
      if (!key) return;
      const [type, singletonName, field] = key.split("::");
      if (type !== "singleton" || !singletonName || !field) return;
      // Any depth of array/object nesting (e.g. "brand.name") - resolved
      // against the schema rather than assumed flat, since a nested content
      // leaf's own schema object is what carries inlineParse/serialize.
      const rootSchema = config.singletons?.[singletonName]?.schema as
        | Record<string, ComponentSchema>
        | undefined;
      if (!rootSchema) return;
      const schema = resolveSchemaAtFieldPath(rootSchema, field);
      if (!schema) return;
      spots.push({
        key,
        el,
        singletonName,
        schema: schema as unknown as ContentFieldSchema,
      });
    });
  return spots;
}

/**
 * Mounts an inline editor onto every fields.content spot on the page. Rendered
 * by Toolbar.tsx inside VeiAdminProviders (the editor needs the admin's config
 * + urql context to open the media library for embedded images) and only while
 * edit mode is on - unmounting is what hands each element back to the page.
 */
export function InlineContentEditors({
  config,
  onChange,
  currentBranch,
}: {
  config: Config<any, any>;
  onChange: () => void;
  currentBranch: string;
}) {
  // Read once per mount: the spots are server-rendered and this component's
  // whole lifetime is one edit-mode session.
  const [spots] = useState(() => readContentSpots(config));
  return (
    <>
      {spots.map((spot) => (
        <InlineContentEditor
          key={spot.key}
          config={config}
          spot={spot}
          onChange={onChange}
          currentBranch={currentBranch}
        />
      ))}
    </>
  );
}
