// Cross-tab / visual-editor sync for one editable entry (a singleton, or one
// collection item) - keeps a form's live React state in step with the shared
// edit-sync bus (packages/drystack/src/app/edit-sync.ts), the same bus the
// visual editor (packages/astro/src/editor) reads/writes. Originally lived
// inline in SingletonPage.tsx; extracted here so LocalItemPage (ItemPage.tsx)
// can share the exact same logic for collection items instead of hand-
// rolling a second, inevitably-diverging copy - this is the most delicate
// code in the app (see the guard/ordering comments throughout), so a fork
// here is a maintenance trap waiting to happen.
//
// This module is a mechanical generalization of that original code: every
// place that used to say "singleton" now takes an EntryRef (so it addresses
// either a singleton or one collection slug), and every place that used the
// singleton's own path/schema now takes them as plain arguments. The
// sync/guard/ordering behavior itself is unchanged.
import { useCallback, useEffect, useRef } from "react";
import { ComponentSchema } from "../form/api";
import {
  contentAssetsDir,
  createLatestGuard,
  editKey,
  entryRefKey,
  forEachContentLeaf,
  getAllEdits,
  getPendingBlobsUnder,
  getSyncableFieldKind,
  htmlFromContentSerialize,
  isAssetKind,
  omitContentLeaves,
  parseEditKey,
  publishDelete,
  publishEdit,
  resolveSchemaAtFieldPath,
  resolveValueAtFieldPath,
  spliceValueEdit,
  stashContentBlobs,
  subscribeEdits,
  type LatestGuard,
  type PendingEdit,
  type StashedBlobs,
  type SyncableFieldKind,
} from "./edit-sync";
import type { EntryRef } from "./path-utils";

const textEncoder = new TextEncoder();

// The narrow slice of a fields.content schema this file drives - typed
// structurally (rather than importing content.Field) so this module doesn't
// pull the field's own module graph in.
type ContentFieldSchema = {
  parse(
    value: unknown,
    extra: {
      content: Uint8Array;
      other: ReadonlyMap<string, Uint8Array>;
      external: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
      slug: undefined;
    },
  ): unknown;
  serialize(value: unknown): {
    value: unknown;
    content: Uint8Array;
    other: Map<string, Uint8Array>;
  };
};

// Turns a parsed edit key (which also carries `field`) back into a plain
// EntryRef, so it can be compared against the entry this hook instance
// serves via entryRefKey - one string-equality check instead of a
// hand-rolled type+name(+slug) comparison at every call site below.
function toEntryRef(parsed: { type: "singleton" | "collection"; name: string; slug?: string }): EntryRef {
  return parsed.type === "singleton"
    ? { type: "singleton", name: parsed.name }
    : { type: "collection", name: parsed.name, slug: parsed.slug! };
}

// Rebuilds a content field's form value from the raw HTML on the bus.
// Parsing with an `other` map missing any image the HTML names silently
// repoints it - edit-sync.ts spells out how - so this assembles the map from
// every source that can hold one, weakest first:
//
//   `ownValues`  the field's value in this form, mined for the bytes of the
//                images it embeds. Pass the entry's *loaded* value as well as
//                its current one: the loaded one stands in for a read of the
//                entry's assets/ directory (it embeds exactly what was on disk
//                at load), which is what covers an image the user has since
//                deleted here but the sender still shows.
//   blob store   images the sender embedded that exist nowhere else yet.
async function contentFromBusValue(
  fieldSchema: ContentFieldSchema,
  html: string,
  assetsDir: string,
  ownValues: readonly unknown[],
): Promise<unknown> {
  const other = new Map<string, Uint8Array>();
  for (const value of ownValues) {
    if (value === undefined) continue;
    for (const [name, bytes] of fieldSchema.serialize(value).other) {
      other.set(name, bytes);
    }
  }
  for (const [name, bytes] of await getPendingBlobsUnder(assetsDir)) {
    other.set(name, bytes);
  }
  return fieldSchema.parse(undefined, {
    content: textEncoder.encode(html),
    other,
    external: new Map(),
    slug: undefined,
  });
}

// The edit-sync bus only carries strings (see edit-sync.ts's PendingEdit) -
// fields.image/fields.file's `null` (no value) is represented on the bus as
// '', the same sentinel bind.ts's paintAssetSpot and the visual editor's
// save.ts already use. fields.array/fields.object's value is JSON-encoded,
// matching the encoding used everywhere else on the bus (see bind.ts's
// parseArrayValue/parseObjectValue and the visual editor's
// Toolbar.tsx/save.ts). fields.text values are always strings already, so
// they pass through as-is.
function toBusValue(
  kind: SyncableFieldKind,
  value: unknown,
  fieldSchema: ComponentSchema,
): string | undefined {
  // fields.content travels as raw HTML, the same encoding the visual editor
  // publishes and save.ts reads back. Its embedded image bytes ride along
  // separately - see stashContentBlobs, which the publish effect pairs with
  // this. htmlFromContentSerialize, not a blind decode(.content): an inline
  // content field's body lives in `.value` (a string), not `.content` (see
  // the field's own serialize) - decoding an absent `.content` silently
  // published an empty string for every inline content field before.
  if (kind === "content") {
    return htmlFromContentSerialize(
      (fieldSchema as unknown as ContentFieldSchema).serialize(value),
    );
  }
  if (isAssetKind(kind)) {
    if (value === null) return "";
    return typeof value === "string" ? value : undefined;
  }
  // omitContentLeaves: a content leaf nested anywhere inside this
  // array/object never rides along in the container's own JSON - it
  // publishes on its own dotted key instead (see the publish effect below),
  // the same way a top-level content field already does. Without this, the
  // leaf's raw ProseMirror EditorState would get JSON.stringify'd into the
  // container's bus value, and a receiver replacing the whole container from
  // it would blank the leaf (nothing there parses HTML out of JSON).
  if (kind === "array") {
    return Array.isArray(value)
      ? JSON.stringify(omitContentLeaves(fieldSchema, value))
      : undefined;
  }
  if (kind === "object") {
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? JSON.stringify(omitContentLeaves(fieldSchema, value))
      : undefined;
  }
  return typeof value === "string" ? value : undefined;
}

// Every bus-decodable kind - i.e. all but 'content', whose value needs the
// entry's image bytes and an async round trip through the field's own schema
// (contentFromBusValue). Callers dispatch content away before reaching here.
type FieldValue = string | null | unknown[] | Record<string, unknown>;
function fromBusValue(
  kind: Exclude<SyncableFieldKind, "content">,
  busValue: string,
): FieldValue {
  if (isAssetKind(kind)) return busValue === "" ? null : busValue;
  if (kind === "array") {
    try {
      const parsed = JSON.parse(busValue);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  if (kind === "object") {
    try {
      const parsed = JSON.parse(busValue);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch {
      return {};
    }
  }
  return busValue;
}

// Splices one per-path fields.array/fields.object edit into `current` (the
// base field's own current value) via spliceValueEdit (edit-sync.ts). `field`
// is "baseField.<path>" at any depth (e.g. "cards.0.title" or "info.label").
// A leaf is decoded per its own kind (image '' → null) via fromBusValue,
// matching how the visual editor's save.ts (mergeFieldEdits) and bind.ts read
// the same nested keys.
function applyContainerPathEdit(
  current: unknown,
  baseField: string,
  field: string,
  busValue: string,
  baseSchema: ComponentSchema,
): unknown {
  const path = field.slice(baseField.length + 1).split(".");
  return spliceValueEdit(current, path, baseSchema, (leafSchema, prevLeaf) => {
    const leafKind = getSyncableFieldKind(leafSchema);
    // A content leaf nested inside a container is handled upstream, before
    // this function ever runs: the subscribeEdits 'set' handler and the
    // mount catch-up effect both check resolveSchemaAtFieldPath first and
    // route a content key through the async contentFromBusValue path
    // instead (parsing HTML into an EditorState needs an await, which this
    // synchronous splice can't do). This branch only guards against a
    // malformed/stale key that somehow reaches here anyway - writing the raw
    // HTML in as if it were a text leaf would put a string where the form
    // expects an editor state.
    if (leafKind === "content") return prevLeaf;
    return leafKind ? fromBusValue(leafKind, busValue) : busValue;
  });
}

/**
 * Keeps one entry's live form state synced with the shared edit-sync bus:
 * catches up on mount with whatever's already pending in IndexedDB, publishes
 * this form's own changes (debounced) for other tabs/the visual editor to
 * see, applies incoming edits from other tabs live, and - once a save lands -
 * drops this entry's now-committed keys from the bus.
 *
 * `ref` identifies the entry (`{type:"singleton",name}` or
 * `{type:"collection",name,slug}`); `entryDir` is its on-disk directory
 * (getSingletonPath/getCollectionItemPath), used only to derive each content
 * field's own assets/ subdirectory.
 */
export function useEntryEditSync(args: {
  ref: EntryRef;
  schema: Record<string, ComponentSchema>;
  entryDir: string;
  state: unknown;
  onPreviewPropsChange: (
    cb: (state: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  initialState: Record<string, unknown> | null;
  committedOverrides: Record<string, unknown>;
  setCommittedOverrides: (
    updater: (prev: Record<string, unknown>) => Record<string, unknown>,
  ) => void;
  // Whatever useUpsertItem's state currently is - the hook only reacts once
  // `.kind === "updated"`, but takes the whole value (not a derived boolean)
  // so its effect deps mirror the original inline code's exactly.
  updateResult: { kind: string };
}): void {
  const {
    ref,
    schema,
    entryDir,
    state,
    onPreviewPropsChange,
    initialState,
    setCommittedOverrides,
    updateResult,
  } = args;
  const refKey = entryRefKey(ref);

  // `lastSyncedRef` tracks, per field, the value already reflected on the
  // shared edit-sync bus - set either right before we publish it (below) or
  // right after we apply an incoming remote value. Diffing against it
  // (instead of the previous render's `state`) is what stops an incoming
  // remote update from immediately bouncing back out as if it were a local
  // edit.
  const lastSyncedRef = useRef<Record<string, string> | undefined>(undefined);
  // Lets the long-lived subscribeEdits callback below read the *current*
  // state without re-subscribing on every keystroke (state isn't in that
  // effect's deps) - assigned fresh every render.
  const stateRef = useRef(state);
  stateRef.current = state;
  // Embedded content images already written to the bus's blob store - see
  // stashContentBlobs. One Set per content field (keyed by its own dotted
  // path), not one shared Set: two different content fields in this entry
  // can each embed an image with the same filename (they live in separate
  // contentAssetsDir namespaces now), and a single shared Set would wrongly
  // skip the second field's stash for a name the first already wrote.
  const stashedBlobsByFieldRef = useRef<Map<string, StashedBlobs>>(new Map());
  const stashedBlobsFor = useCallback((field: string): StashedBlobs => {
    let set = stashedBlobsByFieldRef.current.get(field);
    if (!set) {
      set = new Set();
      stashedBlobsByFieldRef.current.set(field, set);
    }
    return set;
  }, []);
  // The values of `field` (any depth - a dotted path for a nested content
  // leaf) this form can mine for embedded image bytes when rebuilding an
  // incoming content edit - see contentFromBusValue for why the as-loaded
  // value is in here and not just the current one. Reads through refs: the
  // long-lived subscribeEdits callback below must see the newest of both
  // without re-subscribing.
  const initialStateRef = useRef(initialState);
  initialStateRef.current = initialState;
  const ownContentValues = useCallback(
    (field: string): unknown[] => [
      resolveValueAtFieldPath(initialStateRef.current, field),
      resolveValueAtFieldPath(stateRef.current, field),
    ],
    [],
  );
  // A content field's incoming-edit resolution (contentFromBusValue) and
  // outgoing-publish (stashContentBlobs) are both async with no natural
  // ordering - a slower older chain can finish after a faster newer one and
  // overwrite it. `applyGuardRef` guards state writes from the mount
  // catch-up effect and the live subscribeEdits handler below (they share
  // one instance so a stale mount-time resolution can't clobber a newer live
  // one, and vice versa); `publishGuardRef` guards the debounced publish
  // effect's own overlapping timers.
  const applyGuardRef = useRef<LatestGuard>(createLatestGuard());
  const publishGuardRef = useRef<LatestGuard>(createLatestGuard());
  // Fields a 'delete'/'clear' message wanted to fold into committedOverrides
  // but couldn't yet (see below) because their content resolution was still
  // in flight - settled by the subscribeEdits 'set' handler once that
  // resolution actually lands.
  const deferredCommitRef = useRef<Set<string>>(new Set());
  if (!lastSyncedRef.current) {
    lastSyncedRef.current = {};
    for (const [field, fieldSchema] of Object.entries(schema)) {
      const kind = getSyncableFieldKind(fieldSchema);
      if (!kind) continue;
      const busValue = toBusValue(
        kind,
        (state as Record<string, unknown>)[field],
        fieldSchema,
      );
      if (busValue !== undefined) lastSyncedRef.current[field] = busValue;
    }
  }

  // Catch up on mount: a field can already have a pending edit sitting in
  // the shared IndexedDB store - e.g. typed/picked in the visual editor, or
  // in an admin tab that's since been closed - before this tab ever
  // subscribed to the bus, so a live-only subscription would never see it.
  // Apply whatever is already there once, the same way the visual editor's
  // applyPendingEdits() does for the DOM on load.
  //
  // A fields.array/fields.object field can have edits at two granularities:
  // a whole-container replace (field === its base field, published by the
  // visual editor's container dialog) and/or per-path edits (field ===
  // "baseField.<path>", typed inline into a leaf spot at any depth) -
  // processed in two passes so a container edit is applied first and
  // per-path edits then splice on top of it, mirroring save.ts's
  // mergeFieldEdits precedence.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const edits = await getAllEdits();
      if (cancelled) return;
      const relevant = edits
        .map((edit) => ({ edit, parsed: parseEditKey(edit.key) }))
        .filter(
          (
            x,
          ): x is {
            edit: PendingEdit;
            parsed: EntryRef & { field: string };
          } => !!x.parsed && entryRefKey(toEntryRef(x.parsed)) === refKey,
        );
      const updates: Record<string, unknown> = {};
      for (const { edit, parsed } of relevant) {
        const { field } = parsed;
        const baseField = field.split(".")[0];
        if (field !== baseField) continue;
        const fieldSchema = schema[baseField];
        const kind = getSyncableFieldKind(fieldSchema);
        if (!kind) continue;
        if (lastSyncedRef.current![field] === edit.value) continue;
        lastSyncedRef.current![field] = edit.value;
        if (kind === "content") {
          // Guarded and caught, unlike a plain `await`: a rejection here
          // (e.g. IndexedDB unavailable) must not abort this loop and drop
          // every other field's edit queued after it, and a slower
          // resolution here losing to a faster one from the live
          // subscribeEdits handler below must not overwrite it.
          const token = applyGuardRef.current.claim(baseField);
          try {
            const value = await contentFromBusValue(
              fieldSchema as unknown as ContentFieldSchema,
              edit.value,
              `${entryDir}/assets`,
              ownContentValues(baseField),
            );
            if (cancelled) return;
            if (applyGuardRef.current.isCurrent(baseField, token)) {
              updates[baseField] = value;
            }
          } catch {
            // Leave this field's state as-is; the edit is still on the bus
            // and will be retried by the next mount or live message.
          }
          continue;
        }
        updates[baseField] = fromBusValue(kind, edit.value);
      }
      for (const { edit, parsed } of relevant) {
        const { field } = parsed;
        const baseField = field.split(".")[0];
        if (field === baseField) continue;
        const baseSchema = schema[baseField];
        const kind = getSyncableFieldKind(baseSchema);
        if (kind !== "array" && kind !== "object") continue;
        // A nested content leaf (e.g. "brand.name") needs an async HTML→
        // EditorState parse - handled in the pass below instead, which stays
        // synchronous so a container edit and its sibling per-path edits
        // apply as one batch.
        const leafSchema = resolveSchemaAtFieldPath(schema, field);
        if (getSyncableFieldKind(leafSchema) === "content") continue;
        if (lastSyncedRef.current![field] === edit.value) continue;
        lastSyncedRef.current![field] = edit.value;
        if (!(baseField in updates)) {
          updates[baseField] = (stateRef.current as Record<string, unknown>)[
            baseField
          ];
        }
        updates[baseField] = applyContainerPathEdit(
          updates[baseField],
          baseField,
          field,
          edit.value,
          baseSchema,
        );
      }
      // Nested content leaves - same async resolution as the top-level
      // content pass above (contentFromBusValue needs an await to hydrate
      // embedded-image bytes), spliced into updates[baseField] at the leaf's
      // own path once resolved rather than replacing the whole field.
      for (const { edit, parsed } of relevant) {
        const { field } = parsed;
        const baseField = field.split(".")[0];
        if (field === baseField) continue;
        const baseSchema = schema[baseField];
        const kind = getSyncableFieldKind(baseSchema);
        if (kind !== "array" && kind !== "object") continue;
        const leafSchema = resolveSchemaAtFieldPath(schema, field);
        if (getSyncableFieldKind(leafSchema) !== "content") continue;
        if (lastSyncedRef.current![field] === edit.value) continue;
        lastSyncedRef.current![field] = edit.value;
        const token = applyGuardRef.current.claim(field);
        try {
          const value = await contentFromBusValue(
            leafSchema as unknown as ContentFieldSchema,
            edit.value,
            contentAssetsDir(entryDir, field),
            ownContentValues(field),
          );
          if (cancelled) return;
          if (!applyGuardRef.current.isCurrent(field, token)) continue;
          if (!(baseField in updates)) {
            updates[baseField] = (stateRef.current as Record<string, unknown>)[
              baseField
            ];
          }
          const pathWithinBase = field.slice(baseField.length + 1).split(".");
          updates[baseField] = spliceValueEdit(
            updates[baseField],
            pathWithinBase,
            baseSchema,
            () => value,
          );
        } catch {
          // Leave this leaf's state as-is; the edit is still on the bus and
          // will be retried by the next mount or live message.
        }
      }
      if (Object.keys(updates).length > 0) {
        onPreviewPropsChange((s) => ({ ...s, ...updates }));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refKey, schema, entryDir, ownContentValues, onPreviewPropsChange]);

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    // One entry per publishable key this render's `state` produces - a
    // top-level field (any kind), plus one per fields.content leaf nested
    // inside a top-level array/object (walked via forEachContentLeaf). Built
    // up first, then turned into debounced publish timers below, all in the
    // same shape so every key (top-level or nested) goes through one
    // identical claim/stash/publish sequence.
    type Publishable = {
      field: string;
      busValue: string;
      serialized?: { content?: Uint8Array; other: Map<string, Uint8Array> };
      assetsDir: string;
    };
    const items: Publishable[] = [];
    for (const [field, fieldSchema] of Object.entries(schema)) {
      const kind = getSyncableFieldKind(fieldSchema);
      if (!kind) continue;
      const value = (state as Record<string, unknown>)[field];
      if (kind === "content") {
        // One serialize, reused for both halves of what it publishes: the
        // HTML body and the embedded image bytes that have to be readable
        // before it. Serializing the whole doc per keystroke is what the
        // visual editor's own inline editor already does.
        const serialized = (
          fieldSchema as unknown as ContentFieldSchema
        ).serialize(value);
        items.push({
          field,
          busValue: htmlFromContentSerialize(serialized),
          serialized,
          assetsDir: contentAssetsDir(entryDir, field),
        });
        continue;
      }
      const busValue = toBusValue(kind, value, fieldSchema);
      if (busValue !== undefined) {
        items.push({ field, busValue, assetsDir: contentAssetsDir(entryDir, field) });
      }
      // A content leaf nested anywhere inside this array/object publishes on
      // its own dotted key too (INV-1) - toBusValue already stripped it out
      // of the container's own JSON above, so without this the leaf would
      // never reach the bus at all.
      if (kind === "array" || kind === "object") {
        forEachContentLeaf(fieldSchema, value, field, (dottedField, leafSchema, leafValue) => {
          const serialized = (
            leafSchema as unknown as ContentFieldSchema
          ).serialize(leafValue);
          items.push({
            field: dottedField,
            busValue: htmlFromContentSerialize(serialized),
            serialized,
            assetsDir: contentAssetsDir(entryDir, dottedField),
          });
        });
      }
    }
    for (const { field, busValue, serialized, assetsDir } of items) {
      if (lastSyncedRef.current![field] === busValue) continue;
      lastSyncedRef.current![field] = busValue;
      // Debounced so fast typing doesn't flood other tabs with a broadcast
      // per keystroke - still "live" at ~200ms (plan.md open question 3).
      // A picked image only fires this once (no keystrokes), so the same
      // debounce just adds one imperceptible 200ms hop for it.
      timers.push(
        setTimeout(async () => {
          // Claimed here, not at schedule time: a slower earlier timer's
          // stash can still be in flight when a newer one already fired and
          // published - this makes the older one drop its stale publish
          // instead of overwriting the newer content once its stash finally
          // resolves.
          const token = publishGuardRef.current.claim(field);
          if (serialized) {
            try {
              await stashContentBlobs(
                serialized.other,
                assetsDir,
                stashedBlobsFor(field),
              );
            } catch {
              // A blob failed to write - publishing now would embed an
              // image reference the bus can't resolve yet (see
              // stashContentBlobs). Leave the bus untouched; the field
              // stays dirty and the next state change retries the stash.
              return;
            }
          }
          if (!publishGuardRef.current.isCurrent(field, token)) return;
          publishEdit(editKey(ref, field), busValue);
        }, 200),
      );
    }
    return () => timers.forEach(clearTimeout);
  }, [state, refKey, schema, entryDir, stashedBlobsFor]);

  useEffect(() => {
    return subscribeEdits((msg) => {
      if (msg.type === "set") {
        const parsed = parseEditKey(msg.key);
        if (!parsed || entryRefKey(toEntryRef(parsed)) !== refKey) return;
        const field = parsed.field;
        // A fields.array/fields.object field's edit can be nested
        // (baseField.<path>, a per-path inline edit at any depth) - the base
        // field is what's tagged in the schema and on the form's own
        // wrapper element either way.
        const baseField = field.split(".")[0];
        const baseSchema = schema[baseField];
        const kind = getSyncableFieldKind(baseSchema);
        if (!kind) return;
        // Don't stomp on what the user is actively typing - the field's
        // wrapper div carries data-field (object/ui.tsx) for exactly this
        // check. Last-write-wins once they move on: either their own next
        // edit publishes over this, or a later message applies here.
        const fieldEl = document.querySelector(
          `[data-field="${CSS.escape(baseField)}"]`,
        );
        if (fieldEl?.contains(document.activeElement)) return;
        lastSyncedRef.current![field] = msg.value;
        if (kind === "content") {
          // Async, unlike every other kind: rehydrating the body's images
          // means a read from the blob store first. lastSyncedRef being
          // stamped above only dedupes reprocessing the same value - it
          // doesn't gate which resolved promise's result actually gets
          // written, so applyGuardRef (shared with the mount catch-up
          // effect above) is what makes an older, slower-resolving message
          // lose to a newer, faster one instead of overwriting it.
          const token = applyGuardRef.current.claim(baseField);
          contentFromBusValue(
            baseSchema as unknown as ContentFieldSchema,
            msg.value,
            `${entryDir}/assets`,
            ownContentValues(baseField),
          )
            .then((next) => {
              if (!applyGuardRef.current.isCurrent(baseField, token)) return;
              onPreviewPropsChange((s) => ({ ...s, [baseField]: next }));
              // A 'delete'/'clear' for this field arrived while this
              // resolution was still in flight and deferred committing it
              // (see below) rather than freezing the stale pre-resolution
              // value as the new baseline - settle it now with the fresh one.
              if (deferredCommitRef.current.delete(baseField)) {
                setCommittedOverrides((prev) => ({
                  ...prev,
                  [baseField]: next,
                }));
              }
            })
            .catch(() => {
              // Blob-store read failed; leave state as-is, the edit stays
              // on the bus for the next message/mount to retry.
            });
          return;
        }
        // A content leaf nested inside this container (e.g. "brand.name") -
        // same async resolution as the top-level branch above, keyed by its
        // own dotted path (createLatestGuard keys per string it's given, so
        // this never shares a guard slot with a sibling leaf or the
        // container's own key).
        if (field !== baseField) {
          const leafSchema = resolveSchemaAtFieldPath(schema, field);
          if (getSyncableFieldKind(leafSchema) === "content") {
            const token = applyGuardRef.current.claim(field);
            contentFromBusValue(
              leafSchema as unknown as ContentFieldSchema,
              msg.value,
              contentAssetsDir(entryDir, field),
              ownContentValues(field),
            )
              .then((next) => {
                if (!applyGuardRef.current.isCurrent(field, token)) return;
                const pathWithinBase = field
                  .slice(baseField.length + 1)
                  .split(".");
                onPreviewPropsChange((s) => ({
                  ...s,
                  [baseField]: spliceValueEdit(
                    (s as Record<string, unknown>)[baseField],
                    pathWithinBase,
                    baseSchema,
                    () => next,
                  ),
                }));
                // No deferredCommitRef bookkeeping here: that reconciliation
                // (the 'delete'/'clear' handler below) only walks top-level
                // schema keys, so a nested dotted field can never have been
                // added to it in the first place.
              })
              .catch(() => {
                // Blob-store read failed; leave state as-is, the edit stays
                // on the bus for the next message/mount to retry.
              });
            return;
          }
        }
        if (field === baseField) {
          if (kind === "array" || kind === "object") {
            // INV-1/INV-2: the incoming JSON never carries a nested content
            // leaf (see toBusValue's omitContentLeaves) - re-graft whatever
            // this form currently holds for each one before replacing the
            // rest of the container, or a whole-container replace (the
            // visual editor's gear-icon dialog, or another admin tab) would
            // blank every nested content field it contains.
            const incoming = fromBusValue(kind, msg.value);
            onPreviewPropsChange((s) => {
              const current = (s as Record<string, unknown>)[baseField];
              let next: unknown = incoming;
              forEachContentLeaf(baseSchema, current, baseField, (leafPath) => {
                const pathWithinBase = leafPath
                  .slice(baseField.length + 1)
                  .split(".");
                next = spliceValueEdit(next, pathWithinBase, baseSchema, () =>
                  resolveValueAtFieldPath(current, leafPath),
                );
              });
              return { ...s, [baseField]: next };
            });
            return;
          }
          onPreviewPropsChange((s) => ({
            ...s,
            [baseField]: fromBusValue(kind, msg.value),
          }));
          return;
        }
        // Per-path array/object edit ("baseField.<path>" at any depth) -
        // splice the new value into the container's current state rather
        // than replacing the whole field.
        if (kind !== "array" && kind !== "object") return;
        onPreviewPropsChange((s) => {
          const current = (s as Record<string, unknown>)[baseField];
          return {
            ...s,
            [baseField]: applyContainerPathEdit(
              current,
              baseField,
              field,
              msg.value,
              baseSchema,
            ),
          };
        });
        return;
      }
      // 'delete' / 'clear' - the field(s) are no longer pending anywhere,
      // because they were just saved (or discarded) on another tab/surface.
      // Whatever this tab currently shows for them is that same saved/
      // reverted value (it already tracked live 'set' messages up to this
      // point), so it becomes the new "nothing to save" baseline - otherwise
      // the Unsaved badge and the full-entry draft (both driven by
      // hasChanged, which compares against `initialState`) would keep
      // treating already-committed content as locally unsaved forever.
      const fields =
        msg.type === "delete"
          ? (() => {
              const parsed = parseEditKey(msg.key);
              return parsed && entryRefKey(toEntryRef(parsed)) === refKey
                ? [parsed.field]
                : [];
            })()
          : Object.keys(schema);
      setCommittedOverrides((prev) => {
        let next: Record<string, unknown> | undefined;
        for (const field of fields) {
          const fieldSchema = schema[field];
          const kind = getSyncableFieldKind(fieldSchema);
          if (!kind) continue;
          const value = (stateRef.current as Record<string, unknown>)[field];
          // Shape-check what the bus-decodable kinds are supposed to hold.
          // 'content' is exempt: its value is the editor's own state object,
          // which this layer deliberately treats as opaque.
          if (
            (kind === "text" && typeof value !== "string") ||
            (isAssetKind(kind) &&
              typeof value !== "string" &&
              value !== null) ||
            (kind === "array" && !Array.isArray(value)) ||
            (kind === "object" &&
              (typeof value !== "object" ||
                value === null ||
                Array.isArray(value)))
          ) {
            continue;
          }
          // A content field's own async resolution (contentFromBusValue) can
          // still be in flight for this field: lastSyncedRef already holds
          // the newer bus value (stamped synchronously when the 'set'
          // message arrived), but `state` hasn't caught up to it yet.
          // Freezing today's stale `value` as the new baseline would desync
          // `state` from `effectiveInitialState` permanently once the
          // resolution lands - defer instead; the 'set' handler above
          // commits it once that resolution actually settles.
          const busValue = toBusValue(kind, value, fieldSchema);
          if (
            busValue === undefined ||
            lastSyncedRef.current![field] !== busValue
          ) {
            deferredCommitRef.current.add(field);
            continue;
          }
          if (prev[field] === value) continue;
          next ??= { ...prev };
          next[field] = value;
        }
        return next ?? prev;
      });
    });
  }, [refKey, schema, entryDir, ownContentValues, onPreviewPropsChange]);

  // A successful save means this entry's synced fields now match what's
  // pending - drop those keys from the shared edit-sync bus so a
  // visual-editor tab that had them queued (from live-typed/picked edits it
  // received earlier) stops treating already-saved content as unreviewed.
  useEffect(() => {
    if (updateResult.kind !== "updated") return;
    for (const [field, fieldSchema] of Object.entries(schema)) {
      const kind = getSyncableFieldKind(fieldSchema);
      if (!kind) continue;
      // Content included: this tab now mirrors a content field's pending edit
      // into its own form state, so the save above wrote that same body out
      // rather than the stale one it used to. Dropping the key is what makes
      // the edit stop showing as unreviewed in the visual editor.
      //
      // But only once `state` has actually caught up to whatever's on the
      // bus: a content field's incoming edit can still be resolving
      // asynchronously (contentFromBusValue) when Save runs - lastSyncedRef
      // is already stamped with that edit's bus value, but `state` (what
      // was just saved) isn't yet. Deleting the key in that window would
      // make the in-flight edit unrecoverable: the save wrote the stale
      // body, and the bus key that would let anything catch up to the real
      // one is gone. Keep the key until state genuinely matches it.
      const busValue = toBusValue(
        kind,
        (stateRef.current as Record<string, unknown>)[field],
        fieldSchema,
      );
      if (
        busValue !== undefined &&
        lastSyncedRef.current![field] !== busValue
      ) {
        continue;
      }
      publishDelete(editKey(ref, field));
    }
  }, [updateResult, refKey, schema]);
}
