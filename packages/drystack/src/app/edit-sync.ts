// Shared per-field edit bus used by both the admin app and the visual editor
// (packages/astro/src/editor) to keep an in-progress edit in sync across
// browser tabs. Persistence is IndexedDB (DB `drystack-edits`, stores `edits`
// + `meta`) - the same physical database is visible to every tab of this
// origin, so a write from one tab is already readable from another as soon
// as the transaction commits. BroadcastChannel (with a localStorage
// `storage`-event fallback for browsers without it) exists only to push an
// immediate notification to already-open tabs instead of waiting for their
// next poll/reload.
import type { ArrayField, ComponentSchema, ObjectField } from "..";
import { isContentEditorField } from "../form/fields/content/is-content-field";

const DB_NAME = "drystack-edits";
const STORE_NAME = "edits";
const META_STORE_NAME = "meta";
const SOURCE_STORE_NAME = "source";
const BLOB_STORE_NAME = "blobs";

export type PendingEdit = { key: string; value: string; updatedAt: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(META_STORE_NAME))
        db.createObjectStore(META_STORE_NAME);
      if (!db.objectStoreNames.contains(SOURCE_STORE_NAME))
        db.createObjectStore(SOURCE_STORE_NAME);
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME))
        db.createObjectStore(BLOB_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllEdits(): Promise<PendingEdit[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setEdit(key: string, value: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put({ key, value, updatedAt: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteEdit(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteEdits(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearEdits(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta<T = unknown>(
  key: string,
): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readonly");
    const req = tx.objectStore(META_STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, "readwrite");
    tx.objectStore(META_STORE_NAME).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Source cache --------------------------------------------------------
//
// Last-known field values fetched straight from the real source (local API,
// or the GitHub Contents API) for a singleton, persisted across reloads.
// Exists to bridge the gap between a github-mode save succeeding (the commit
// is live) and the next static build/deploy actually shipping it - without
// this, reloading the page during that window shows the stale pre-deploy
// HTML with nothing to paint over it, since a save clears the per-field
// pending-edit entries as soon as it succeeds. Populated wherever
// getLatestFieldValues is already being fetched (entering edit mode, right
// after save) - no extra network calls. Cleared once a newer buildVersion
// confirms the static build has actually caught up (discardEditsIfBuildIsNewer),
// so a stale cache entry can never paint over fresher static HTML.
export async function getSourceCache(
  singletonName: string,
): Promise<Record<string, string> | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOURCE_STORE_NAME, "readonly");
    const req = tx.objectStore(SOURCE_STORE_NAME).get(singletonName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setSourceCache(
  singletonName: string,
  values: Record<string, string>,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOURCE_STORE_NAME, "readwrite");
    tx.objectStore(SOURCE_STORE_NAME).put(values, singletonName);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSourceCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOURCE_STORE_NAME, "readwrite");
    tx.objectStore(SOURCE_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Pending blobs -------------------------------------------------------
//
// Bytes for a `fields.image` value picked/uploaded through the visual
// editor, keyed by the repo path the media library wrote them to (e.g.
// `/assets/foo.png`). A freshly-uploaded image isn't guaranteed to be
// servable at that path yet - local dev serves it immediately, but github
// mode only gets a real URL once the next Cloudflare build ships it (see
// `astro:build:done`'s assets mirror). Caching the bytes here lets the field
// preview instantly from the blob and survive a reload during that gap,
// mirroring the source cache above. Cleared once a newer buildVersion
// confirms the static build has caught up (discardEditsIfBuildIsNewer).
export async function putPendingBlob(
  path: string,
  content: Uint8Array,
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, "readwrite");
    tx.objectStore(BLOB_STORE_NAME).put(content, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingBlob(
  path: string,
): Promise<Uint8Array | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, "readonly");
    const req = tx.objectStore(BLOB_STORE_NAME).get(path);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// Every pending blob stored directly under `dir`, keyed by its name relative
// to it (`<dir>/foo.png` → `foo.png`). That relative keying is what a content
// field's `other` map wants (see the field's parse/serialize, whose keys are
// relative to `<entryDir>/assets`), so the result drops straight into a parse
// without re-keying at the call site. Flat: a name still containing a `/` sits
// in a subdirectory, which the admin never writes embedded images into.
export async function getPendingBlobsUnder(
  dir: string,
): Promise<Map<string, Uint8Array>> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, "readonly");
    const store = tx.objectStore(BLOB_STORE_NAME);
    const keysReq = store.getAllKeys();
    const valsReq = store.getAll();
    tx.oncomplete = () => {
      const out = new Map<string, Uint8Array>();
      const keys = keysReq.result;
      const vals = valsReq.result;
      const prefix = `${dir}/`;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        if (typeof key !== "string" || !key.startsWith(prefix)) continue;
        const name = key.slice(prefix.length);
        if (name.includes("/")) continue;
        out.set(name, vals[i]);
      }
      resolve(out);
    };
    tx.onerror = () => reject(tx.error);
  });
}

export async function deletePendingBlob(path: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, "readwrite");
    tx.objectStore(BLOB_STORE_NAME).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPendingBlobs(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, "readwrite");
    tx.objectStore(BLOB_STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// --- Edit key helpers -------------------------------------------------
//
// A key identifies one editable field: `${type}::${name}::${field}`, e.g.
// `singleton::home::heading`. Matches the `data-dry` attribute the visual
// editor already renders (packages/astro/src/dry.ts), so both surfaces
// address the same field the same way.

export function editKey(
  type: "singleton",
  name: string,
  field: string,
): string {
  return `${type}::${name}::${field}`;
}

export function parseEditKey(key: string): {
  type: string;
  name: string;
  field: string;
} {
  const [type, name, field] = key.split("::");
  return { type, name, field };
}

export type SyncableFieldKind =
  | "text"
  | "image"
  | "file"
  | "array"
  | "object"
  | "content";

// A field counts as syncable when its schema is `kind: 'form'` and either
// `formKind: 'slug'` (fields.text - this fork, and the name field inside
// fields.slug share that tag), `columnKind: 'image'` (fields.image),
// `columnKind: 'file'` (fields.file), or it's the HTML rich-text
// fields.content (see isContentEditorField), or when it's `kind: 'array'`
// (fields.array) or `kind: 'object'` (fields.object - standalone at any
// depth, not just top-level). Shared by the admin's publish effect
// (SingletonPage.tsx) and the visual editor's dry() helper so both recognize
// the same fields, and dispatch on how a field's value gets edited/painted
// (contenteditable text, media-library picker, a live ProseMirror mount for
// 'content', or a container's recursive read/paint - see bind.ts's
// readContainerValue/paintContainerValue), the same way.
export function getSyncableFieldKind(
  fieldSchema: ComponentSchema | undefined,
): SyncableFieldKind | undefined {
  if (!fieldSchema) return undefined;
  if (fieldSchema.kind === "array") return "array";
  if (fieldSchema.kind === "object") return "object";
  if (fieldSchema.kind !== "form") return undefined;
  if ((fieldSchema as { formKind?: string }).formKind === "slug") return "text";
  if ((fieldSchema as { columnKind?: string }).columnKind === "image")
    return "image";
  if ((fieldSchema as { columnKind?: string }).columnKind === "file")
    return "file";
  // Checked after the columnKind branches above: fields.content shares
  // `formKind: 'assets'` with fields.image/fields.file's underlying tag, so
  // only the `htmlContentEditor` marker distinguishes it.
  if (isContentEditorField(fieldSchema)) return "content";
  return undefined;
}

// --- Carrying a content field over the bus ------------------------------
//
// Every kind above is bus-syncable, content included. The other kinds are
// easy: the bus carries strings, and their form values either are one or
// JSON-encode to one losslessly. A content field's form value is a ProseMirror
// EditorState, so each side converts via a serialize/parse round trip through
// the field's own schema - the body travels as raw HTML, matching what the
// visual editor already publishes and what save.ts already expects to read.
//
// The catch is embedded images. `parse` resolves each `<img>`'s bytes out of
// the `other` map handed to it, and a filename missing from that map parses to
// a zero-byte node (markdoc/editor/html/parse.ts's UNHYDRATED_IMAGE_BYTES)
// that serializes back out as `/media-library/<name>` - silently repointing
// the image to the shared library. So a receiver must never parse incoming
// HTML with a half-populated map. Both surfaces build `other` the same way:
//
//   1. Images already in the receiver's own doc, harvested from its current
//      state via serialize().other - bytes it necessarily already holds.
//   2. Images the *sender* just embedded, which exist nowhere on disk yet.
//      The publisher stashes those into the `blobs` store beside the HTML
//      (keyed by their eventual repo path, `<entryDir>/assets/<filename>`,
//      the same path save.ts writes them to); the receiver reads them back
//      with getPendingBlobsUnder.
//
// (2) is what makes this safe rather than lossy: without it, typing in one
// surface after inserting an image in the other would repoint that image on
// the very next keystroke.

// Names already handed to putPendingBlob this session, so republishing a body
// doesn't rewrite every image it embeds on every keystroke. A filename is
// minted per inserted image and its bytes don't change afterwards, so having
// stashed one once is enough. Owned by whichever surface is publishing (one
// set per mounted editor / form).
export type StashedBlobs = Set<string>;

// Writes the embedded image bytes that have to accompany a content field's
// HTML on the bus - `other` as returned by the field's own serialize(), whose
// keys are relative to `<entryDir>/assets`. Await this *before* publishing the
// body: a receiver woken by the broadcast reads the bytes it references
// straight away, so publishing first leaves a window where those images
// resolve to nothing (see above for what that silently does to them).
//
// Marks a name stashed only *after* its write commits - marking it first (the
// original bug here) means a rejected `putPendingBlob` (quota exceeded, tx
// error) permanently skips that name on every later retry, since `stashed`
// already claims it's on disk. A rejection here propagates to the caller,
// which must not publish the body in that case (see toBusValue callers).
export async function stashContentBlobs(
  other: ReadonlyMap<string, Uint8Array>,
  assetsDir: string,
  stashed: StashedBlobs,
): Promise<void> {
  await Promise.all(
    [...other].map(async ([name, bytes]) => {
      if (stashed.has(name)) return;
      await putPendingBlob(`${assetsDir}/${name}`, bytes);
      stashed.add(name);
    }),
  );
}

// Per-key monotonic token so an async publish/apply chain can tell whether
// it's still the most recent one issued for that key before writing its
// result - several content-sync call sites (SingletonPage.tsx,
// InlineContentEditors.tsx) start a fresh async chain (IndexedDB read +
// schema round-trip) per keystroke/message with no cancellation, so a slower
// older chain can otherwise finish after a faster newer one and overwrite it
// with stale content. `claim` at the point the async work starts; `isCurrent`
// right before committing its result - if the token has moved on, drop the
// result instead of applying it.
export type LatestGuard = {
  claim(key: string): number;
  isCurrent(key: string, token: number): boolean;
};

export function createLatestGuard(): LatestGuard {
  const seq = new Map<string, number>();
  return {
    claim(key) {
      const next = (seq.get(key) ?? 0) + 1;
      seq.set(key, next);
      return next;
    },
    isCurrent(key, token) {
      return seq.get(key) === token;
    },
  };
}

// Splices one leaf edit into a nested array/object value tree, walking
// `path` (e.g. ["0", "tags", "1", "label"] for a bus key's
// "cards.0.tags.1.label" suffix) down `schema` in lockstep - an array
// segment is a numeric index into `schema`'s `element`, an object segment is
// a field name into `schema`'s `fields`. Copy-on-write only along the spine
// actually touched (mirrors the immutability convention every caller already
// used before this was extracted: `[...arr]` / `{...obj}`). `setLeaf` is
// called once path is exhausted, with the leaf's own schema and its previous
// value, so each caller can decode the raw bus string its own way (save.ts
// keeps it a raw string for YAML; SingletonPage.tsx decodes '' → null for
// assets via fromBusValue) without this function needing to know which.
// Shared by save.ts's mergeFieldEdits and SingletonPage.tsx's
// applyArrayItemEdit, which independently hand-rolled the same one-level-only
// splice before this existed.
export function spliceValueEdit(
  prev: unknown,
  path: readonly string[],
  schema: ComponentSchema,
  setLeaf: (leafSchema: ComponentSchema, prevLeaf: unknown) => unknown,
): unknown {
  if (path.length === 0) return setLeaf(schema, prev);
  const [seg, ...rest] = path;
  if (schema.kind === "array") {
    const idx = Number(seg);
    if (!Number.isInteger(idx) || idx < 0) return prev;
    const arr = Array.isArray(prev) ? [...prev] : [];
    arr[idx] = spliceValueEdit(
      arr[idx],
      rest,
      (schema as ArrayField<ComponentSchema>).element,
      setLeaf,
    );
    return arr;
  }
  if (schema.kind === "object") {
    const subSchema = (schema as ObjectField).fields[seg];
    if (!subSchema) return prev;
    const obj =
      typeof prev === "object" && prev !== null && !Array.isArray(prev)
        ? { ...(prev as Record<string, unknown>) }
        : {};
    obj[seg] = spliceValueEdit(obj[seg], rest, subSchema, setLeaf);
    return obj;
  }
  return prev; // schema has no further nesting - malformed path, no-op.
}

// A syncable field whose value is edited via the media-library picker
// (rather than contenteditable text or the array template-clone binding).
// Shared so every place that dispatches on "is this an image/file field"
// (dry.ts, bind.ts, Toolbar.tsx, save.ts, SingletonPage.tsx,
// computeFieldChanges.ts) agrees, instead of each hand-rolling the same
// `kind === 'image' || kind === 'file'` check.
export function isAssetKind(
  kind: string | undefined | null,
): kind is "image" | "file" {
  return kind === "image" || kind === "file";
}

// --- Nested content field paths ------------------------------------------
//
// A fields.content leaf nested inside a fields.object/fields.array (e.g.
// "brand.name", where `brand` is a fields.object) resolves its own
// schema/value/asset-directory the same way wherever it's touched - the
// visual editor's mount (InlineContentEditors.tsx), its save path (save.ts),
// and the admin's bus sync (SingletonPage.tsx) all import these instead of
// each hand-rolling the same schema/value walk. A content leaf itself never
// nests further (fields.content has no sub-fields), so every walk below
// bottoms out there.

// Walks a dotted field path (e.g. "brand.name", "stats.0.body") against a
// singleton's flat top-level schema map, one segment at a time - an array
// segment is a numeric index into `.element`, an object segment is a field
// name into `.fields`. Mirrors dry.ts's resolveDrySpot, minus the value walk
// (see resolveValueAtFieldPath for that).
export function resolveSchemaAtFieldPath(
  rootSchema: Record<string, ComponentSchema>,
  dottedField: string,
): ComponentSchema | undefined {
  const [baseField, ...rest] = dottedField.split(".");
  let schema: ComponentSchema | undefined = rootSchema[baseField];
  for (const seg of rest) {
    if (!schema) return undefined;
    if (schema.kind === "array") {
      if (!/^\d+$/.test(seg)) return undefined;
      schema = (schema as ArrayField<ComponentSchema>).element;
    } else if (schema.kind === "object") {
      schema = (schema as ObjectField).fields[seg];
    } else {
      return undefined;
    }
  }
  return schema;
}

// Read-only dual of the above over a value tree instead of a schema - used to
// harvest a nested content leaf's current value (e.g. image-byte hydration,
// see ownContentValues in SingletonPage.tsx).
export function resolveValueAtFieldPath(
  rootValue: unknown,
  dottedField: string,
): unknown {
  let value: unknown = rootValue;
  for (const seg of dottedField.split(".")) {
    if (value === undefined || value === null) return undefined;
    value = (value as Record<string, unknown>)[seg];
  }
  return value;
}

// Visits every fields.content leaf nested under `value` (schema-guided, any
// depth of array/object nesting), yielding its dotted path relative to
// `basePath` (e.g. a leaf directly under "brand" comes back as "brand.name",
// matching the bus key convention), its own schema, and its current value.
export function forEachContentLeaf(
  schema: ComponentSchema,
  value: unknown,
  basePath: string,
  cb: (path: string, leafSchema: ComponentSchema, leafValue: unknown) => void,
): void {
  if (schema.kind === "object") {
    const obj =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : {};
    for (const [seg, subSchema] of Object.entries(
      (schema as ObjectField).fields,
    )) {
      const subPath = basePath ? `${basePath}.${seg}` : seg;
      if (getSyncableFieldKind(subSchema) === "content") {
        cb(subPath, subSchema, obj[seg]);
      } else {
        forEachContentLeaf(subSchema, obj[seg], subPath, cb);
      }
    }
    return;
  }
  if (schema.kind === "array") {
    const arr = Array.isArray(value) ? value : [];
    const element = (schema as ArrayField<ComponentSchema>).element;
    arr.forEach((item, i) => {
      const subPath = basePath ? `${basePath}.${i}` : String(i);
      if (getSyncableFieldKind(element) === "content") {
        cb(subPath, element, item);
      } else {
        forEachContentLeaf(element, item, subPath, cb);
      }
    });
  }
}

// Deep-copies `value` with every nested fields.content leaf removed. A
// content leaf never rides inside its container's own bus JSON/save value -
// it always travels on its own dotted key, the same way a top-level content
// field already does (see toBusValue's content branch) - otherwise a
// container carrying a content leaf would JSON-stringify the leaf's raw
// ProseMirror EditorState instead of publishing its HTML properly, and a
// receiver replacing the whole container from that JSON would blank the
// leaf. Returns `value` itself untouched when there's nothing to strip, so
// callers with no nested content pay no copying cost.
export function omitContentLeaves(
  schema: ComponentSchema,
  value: unknown,
): unknown {
  if (schema.kind === "object") {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return value;
    const obj = value as Record<string, unknown>;
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [seg, subSchema] of Object.entries(
      (schema as ObjectField).fields,
    )) {
      if (!(seg in obj)) continue;
      if (getSyncableFieldKind(subSchema) === "content") {
        changed = true;
        continue;
      }
      const sub = omitContentLeaves(subSchema, obj[seg]);
      out[seg] = sub;
      if (sub !== obj[seg]) changed = true;
    }
    return changed ? out : value;
  }
  if (schema.kind === "array") {
    if (!Array.isArray(value)) return value;
    const element = (schema as ArrayField<ComponentSchema>).element;
    let changed = false;
    const out = value.map((item) => {
      const sub = omitContentLeaves(element, item);
      if (sub !== item) changed = true;
      return sub;
    });
    return changed ? out : value;
  }
  return value;
}

const contentPathTextDecoder = new TextDecoder();

// A content field's serialize() output carries its HTML body in `content`
// bytes for a non-inline field (a separate sibling file) but straight in
// `value` for an inline one (fields.content({ inline: true }) - see the
// field's own serialize). Picks whichever is present so every surface that
// needs the HTML (not the summary/YAML value) decodes a content field's
// output the same way, instead of assuming `content` is always populated -
// mirrors InlineContentEditors.tsx's original htmlFromSerializeOutput.
export function htmlFromContentSerialize(out: {
  value: unknown;
  content?: Uint8Array;
}): string {
  if (out.content !== undefined) return contentPathTextDecoder.decode(out.content);
  return typeof out.value === "string" ? out.value : "";
}

// Path helpers for a content field's own on-disk namespace. A top-level
// content field (no dots in its field name) keeps its existing flat layout
// unchanged (`<entryDir>/assets`, `<entryDir>/<field><ext>`); a nested one
// (e.g. "brand.name") gets its own subdirectory so two content fields in the
// same singleton never collide on an embedded image's filename (see
// stashContentBlobs - both write/read `<dir>/<name>` with no field-scoping
// of their own).
export function contentEntryDir(
  entryDir: string,
  dottedField: string,
): string {
  return dottedField.includes(".") ? `${entryDir}/${dottedField}` : entryDir;
}

export function contentAssetsDir(
  entryDir: string,
  dottedField: string,
): string {
  return `${contentEntryDir(entryDir, dottedField)}/assets`;
}

// --- Cross-tab bus -----------------------------------------------------

export type EditBusMessage =
  | {
      type: "set";
      key: string;
      value: string;
      updatedAt: number;
      origin: string;
    }
  | { type: "delete"; key: string; origin: string }
  | { type: "clear"; origin: string };

const CHANNEL_NAME = "drystack-edits";
const FALLBACK_STORAGE_KEY = "__drystack_edits_bus__";

// Identifies this tab so it can ignore its own broadcasts (BroadcastChannel
// already excludes the sending context, but the localStorage fallback's
// `storage` event does not carry a sender identity of its own).
const origin =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | undefined;
function getChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === "undefined") return undefined;
  if (!channel) channel = new BroadcastChannel(CHANNEL_NAME);
  return channel;
}

function broadcast(msg: EditBusMessage): void {
  const bc = getChannel();
  if (bc) {
    bc.postMessage(msg);
    return;
  }
  // Safari < 15.4 and other environments without BroadcastChannel: piggyback
  // on the `storage` event, which already hands every other tab the new
  // value via `event.newValue` - no separate wake-then-reread-IndexedDB step
  // needed. Only fires in *other* tabs, never the one that wrote it.
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(msg));
  }
}

export async function publishEdit(key: string, value: string): Promise<void> {
  await setEdit(key, value);
  broadcast({ type: "set", key, value, updatedAt: Date.now(), origin });
}

export async function publishDelete(key: string): Promise<void> {
  await deleteEdit(key);
  broadcast({ type: "delete", key, origin });
}

export async function publishClear(): Promise<void> {
  await clearEdits();
  broadcast({ type: "clear", origin });
}

// Subscribes to edits published from other tabs (this tab's own publishes
// are filtered out via `origin`). Returns an unsubscribe function.
export function subscribeEdits(cb: (msg: EditBusMessage) => void): () => void {
  const bc = getChannel();
  if (bc) {
    const handler = (e: MessageEvent<EditBusMessage>) => {
      if (e.data.origin === origin) return;
      cb(e.data);
    };
    bc.addEventListener("message", handler);
    return () => bc.removeEventListener("message", handler);
  }
  if (typeof window === "undefined") return () => {};
  const handler = (e: StorageEvent) => {
    if (e.key !== FALLBACK_STORAGE_KEY || !e.newValue) return;
    try {
      const msg = JSON.parse(e.newValue) as EditBusMessage;
      if (msg.origin === origin) return;
      cb(msg);
    } catch {
      // ignore malformed payloads written by a mismatched version in another tab
    }
  };
  window.addEventListener("storage", handler);
  return () => window.removeEventListener("storage", handler);
}
