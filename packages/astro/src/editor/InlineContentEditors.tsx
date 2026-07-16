import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import type { Config, ComponentSchema } from "@drystack/core";
import {
  InlineDocumentEditor,
  type ContentEditorState as EditorState,
} from "@drystack/core/field-editor";
import { getSingletonPath } from "@drystack/core/path-utils";
import { publishEdit } from "./store";
import { setContentSpotPainter } from "./bind";
import { listAssetFiles } from "./save";
import { withViewTransition } from "./view-transition";

const textDecoder = new TextDecoder();

// The narrow slice of a fields.content schema this file drives. Typed
// structurally rather than importing content.Field so the editor bundle
// doesn't pull the field's own module graph in.
type ContentFieldSchema = {
  // Not parse(): the inline variant renders without the admin editor's own
  // block spacing, so the live page's typography is what shows while editing
  // (see the field's own inlineParse). Both produce the same HTML on the way
  // back out.
  inlineParse(html: string, other: ReadonlyMap<string, Uint8Array>): EditorState;
  serialize(value: EditorState): {
    value: unknown;
    content: Uint8Array;
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

function serializeHtml(schema: ContentFieldSchema, state: EditorState): string {
  return textDecoder.decode(schema.serialize(state).content);
}

type Spot = {
  key: string;
  el: HTMLElement;
  singletonName: string;
  schema: ContentFieldSchema;
};

// One live ProseMirror view bound to one `[data-dry-kind="content"]` element
// already on the page. Mounts as soon as edit mode turns on (like a text
// spot, unlike the array/object gear dialog) — the whole point is editing in
// place, so there's nothing to wait for a click on.
function InlineContentEditor({
  config,
  spot,
  onChange,
}: {
  config: Config<any, any>;
  spot: Spot;
  onChange: () => void;
}) {
  const { el, key, schema, singletonName } = spot;
  const [state, setState] = useState<EditorState | null>(null);
  // This entry's assets/ bytes, kept for the lifetime of the editor: every
  // later re-parse (see the painter below) needs them just as much as the
  // first one does, and re-fetching per paint would be pointless network.
  const assetsRef = useRef<ReadonlyMap<string, Uint8Array>>(new Map());

  // Reads the element's current HTML and turns it into an editor state, with
  // this entry's own assets/ bytes hydrated first (see listAssetFiles for why
  // that ordering is load-bearing). Kicked off on mount; nothing renders — and
  // so nothing touches the element — until it resolves, which leaves the
  // server-rendered HTML on screen in the meantime.
  useEffect(() => {
    let cancelled = false;
    const html = el.innerHTML;
    listAssetFiles(config, singletonName)
      .catch(() => new Map<string, Uint8Array>())
      .then((other) => {
        if (cancelled) return;
        assetsRef.current = other;
        const parsed = parseHtml(schema, html, other);
        // The swap to ProseMirror's markup happens here, a fetch's worth of
        // time after the visitor clicked Edit — so it reads as the page
        // lurching on its own rather than as a response to anything. Hand it
        // to a view transition to dissolve instead.
        //
        // flushSync, because the transition snapshots the new DOM as soon as
        // this callback returns: the child's ProseMirror view mounts in a
        // layout effect, which React would otherwise commit *after* the
        // snapshot was already taken, leaving the transition to cross-fade the
        // old markup into itself and the real swap to snap in afterwards.
        withViewTransition(() => {
          flushSync(() => setState(parsed));
        });
      });
    return () => {
      cancelled = true;
    };
  }, [config, el, schema, singletonName]);

  // Cleanup closures capture their variables at effect-setup time, so the
  // repaint below has to read the *latest* state through a ref rather than
  // the `state` binding it would otherwise close over (which would be
  // whatever it was when the effect last ran, i.e. the pre-edit doc).
  const stateRef = useRef(state);
  stateRef.current = state;

  // ProseMirror empties an externally-mounted node on destroy() instead of
  // leaving the last-rendered doc in it — so unlike every other spot kind,
  // this element would go blank the moment edit mode turned off. Repaint it
  // from the final state.
  //
  // The repaint has to land in the same frame as the destroy, which rules out
  // both of the obvious placements:
  //
  //  - A passive cleanup runs after React has yielded, so the browser is free
  //    to paint the emptied element first. That blank frame collapses the
  //    field to zero height and snaps the rest of the page up and back — the
  //    hard jolt on leaving edit mode, worst on long content fields.
  //  - A layout cleanup runs too *early*: React destroys a deleted subtree
  //    parent-first, so this would write the HTML before the child
  //    ProseMirrorEditor's destroy() wipes it right back out (which is exactly
  //    what silently blanked the field when this was tried before).
  //
  // Queueing from a layout cleanup threads between the two: microtasks run
  // once the whole commit — destroy() included — unwinds, and always before
  // the browser paints.
  useLayoutEffect(() => {
    return () => {
      const latest = stateRef.current;
      if (!latest) return;
      const html = serializeHtml(schema, latest);
      queueMicrotask(() => {
        el.innerHTML = html;
      });
    };
  }, [el, schema]);

  // Lets bind.ts hand this view any paint aimed at the element — a Reset, a
  // fresh value fetched from source, an edit arriving from another tab —
  // instead of assigning innerHTML underneath a live view. Registered even
  // before `state` resolves so a paint landing during that window isn't
  // applied directly and then immediately overwritten by the initial parse.
  useEffect(() => {
    return setContentSpotPainter(key, (html) => {
      // assetsRef, not an empty map — re-parsing without this entry's bytes
      // would repoint every embedded image (see listAssetFiles).
      setState(parseHtml(schema, html, assetsRef.current));
    });
  }, [key, schema]);

  if (!state) return null;

  return (
    <InlineDocumentEditor
      mount={el}
      value={state}
      onChange={(next) => {
        setState(next);
        publishEdit(key, serializeHtml(schema, next)).then(onChange);
      }}
      entryDirectory={getSingletonPath(config, singletonName)}
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
      // Only top-level content fields on a singleton — a content field nested
      // inside an array/object would need a per-path content filename, which
      // neither dry() nor the save path resolves yet.
      if (type !== "singleton" || !singletonName || !field) return;
      if (field.includes(".")) return;
      const schema = config.singletons?.[singletonName]?.schema?.[field] as
        | ComponentSchema
        | undefined;
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
 * edit mode is on — unmounting is what hands each element back to the page.
 */
export function InlineContentEditors({
  config,
  onChange,
}: {
  config: Config<any, any>;
  onChange: () => void;
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
        />
      ))}
    </>
  );
}
