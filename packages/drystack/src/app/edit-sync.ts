// Shared per-field edit bus used by both the admin app and the visual editor
// (packages/astro/src/editor) to keep an in-progress edit in sync across
// browser tabs. Persistence is IndexedDB (DB `drystack-edits`, stores `edits`
// + `meta`) — the same physical database is visible to every tab of this
// origin, so a write from one tab is already readable from another as soon
// as the transaction commits. BroadcastChannel (with a localStorage
// `storage`-event fallback for browsers without it) exists only to push an
// immediate notification to already-open tabs instead of waiting for their
// next poll/reload.
import type { ComponentSchema } from '..';

const DB_NAME = 'drystack-edits';
const STORE_NAME = 'edits';
const META_STORE_NAME = 'meta';
const SOURCE_STORE_NAME = 'source';
const BLOB_STORE_NAME = 'blobs';

export type PendingEdit = { key: string; value: string; updatedAt: number };

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 4);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
      if (!db.objectStoreNames.contains(META_STORE_NAME)) db.createObjectStore(META_STORE_NAME);
      if (!db.objectStoreNames.contains(SOURCE_STORE_NAME)) db.createObjectStore(SOURCE_STORE_NAME);
      if (!db.objectStoreNames.contains(BLOB_STORE_NAME)) db.createObjectStore(BLOB_STORE_NAME);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAllEdits(): Promise<PendingEdit[]> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setEdit(key: string, value: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).put({ key, value, updatedAt: Date.now() }, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteEdit(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function deleteEdits(keys: string[]): Promise<void> {
  if (keys.length === 0) return;
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    for (const key of keys) store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearEdits(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, 'readonly');
    const req = tx.objectStore(META_STORE_NAME).get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE_NAME, 'readwrite');
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
// is live) and the next static build/deploy actually shipping it — without
// this, reloading the page during that window shows the stale pre-deploy
// HTML with nothing to paint over it, since a save clears the per-field
// pending-edit entries as soon as it succeeds. Populated wherever
// getLatestFieldValues is already being fetched (entering edit mode, right
// after save) — no extra network calls. Cleared once a newer buildVersion
// confirms the static build has actually caught up (discardEditsIfBuildIsNewer),
// so a stale cache entry can never paint over fresher static HTML.
export async function getSourceCache(
  singletonName: string
): Promise<Record<string, string> | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOURCE_STORE_NAME, 'readonly');
    const req = tx.objectStore(SOURCE_STORE_NAME).get(singletonName);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function setSourceCache(
  singletonName: string,
  values: Record<string, string>
): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOURCE_STORE_NAME, 'readwrite');
    tx.objectStore(SOURCE_STORE_NAME).put(values, singletonName);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearSourceCache(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(SOURCE_STORE_NAME, 'readwrite');
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
// servable at that path yet — local dev serves it immediately, but github
// mode only gets a real URL once the next Cloudflare build ships it (see
// `astro:build:done`'s assets mirror). Caching the bytes here lets the field
// preview instantly from the blob and survive a reload during that gap,
// mirroring the source cache above. Cleared once a newer buildVersion
// confirms the static build has caught up (discardEditsIfBuildIsNewer).
export async function putPendingBlob(path: string, content: Uint8Array): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, 'readwrite');
    tx.objectStore(BLOB_STORE_NAME).put(content, path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getPendingBlob(path: string): Promise<Uint8Array | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, 'readonly');
    const req = tx.objectStore(BLOB_STORE_NAME).get(path);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function deletePendingBlob(path: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, 'readwrite');
    tx.objectStore(BLOB_STORE_NAME).delete(path);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function clearPendingBlobs(): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(BLOB_STORE_NAME, 'readwrite');
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

export function editKey(type: 'singleton', name: string, field: string): string {
  return `${type}::${name}::${field}`;
}

export function parseEditKey(
  key: string
): { type: string; name: string; field: string } {
  const [type, name, field] = key.split('::');
  return { type, name, field };
}

export type SyncableFieldKind = 'text' | 'image' | 'file' | 'array';

// A field counts as syncable when its schema is `kind: 'form'` and either
// `formKind: 'slug'` (fields.text — this fork, and the name field inside
// fields.slug share that tag), `columnKind: 'image'` (fields.image), or
// `columnKind: 'file'` (fields.file), or when it's `kind: 'array'`
// (fields.array — MVP scope: array of a primitive element, see
// plan/vei-array-object.md). Shared by the admin's publish effect
// (SingletonPage.tsx) and the visual editor's dry() helper so both recognize
// the same fields, and dispatch on how a field's value gets edited/painted
// (contenteditable text, media-library picker, or the array's template-clone
// list binding), the same way.
export function getSyncableFieldKind(
  fieldSchema: ComponentSchema | undefined
): SyncableFieldKind | undefined {
  if (!fieldSchema) return undefined;
  if (fieldSchema.kind === 'array') return 'array';
  if (fieldSchema.kind !== 'form') return undefined;
  if ((fieldSchema as { formKind?: string }).formKind === 'slug') return 'text';
  if ((fieldSchema as { columnKind?: string }).columnKind === 'image') return 'image';
  if ((fieldSchema as { columnKind?: string }).columnKind === 'file') return 'file';
  return undefined;
}

// A syncable field whose value is edited via the media-library picker
// (rather than contenteditable text or the array template-clone binding).
// Shared so every place that dispatches on "is this an image/file field"
// (dry.ts, bind.ts, Toolbar.tsx, save.ts, SingletonPage.tsx,
// computeFieldChanges.ts) agrees, instead of each hand-rolling the same
// `kind === 'image' || kind === 'file'` check.
export function isAssetKind(
  kind: string | undefined | null
): kind is 'image' | 'file' {
  return kind === 'image' || kind === 'file';
}

// --- Cross-tab bus -----------------------------------------------------

export type EditBusMessage =
  | { type: 'set'; key: string; value: string; updatedAt: number; origin: string }
  | { type: 'delete'; key: string; origin: string }
  | { type: 'clear'; origin: string };

const CHANNEL_NAME = 'drystack-edits';
const FALLBACK_STORAGE_KEY = '__drystack_edits_bus__';

// Identifies this tab so it can ignore its own broadcasts (BroadcastChannel
// already excludes the sending context, but the localStorage fallback's
// `storage` event does not carry a sender identity of its own).
const origin =
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

let channel: BroadcastChannel | undefined;
function getChannel(): BroadcastChannel | undefined {
  if (typeof BroadcastChannel === 'undefined') return undefined;
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
  // value via `event.newValue` — no separate wake-then-reread-IndexedDB step
  // needed. Only fires in *other* tabs, never the one that wrote it.
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(FALLBACK_STORAGE_KEY, JSON.stringify(msg));
  }
}

export async function publishEdit(key: string, value: string): Promise<void> {
  await setEdit(key, value);
  broadcast({ type: 'set', key, value, updatedAt: Date.now(), origin });
}

export async function publishDelete(key: string): Promise<void> {
  await deleteEdit(key);
  broadcast({ type: 'delete', key, origin });
}

export async function publishClear(): Promise<void> {
  await clearEdits();
  broadcast({ type: 'clear', origin });
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
    bc.addEventListener('message', handler);
    return () => bc.removeEventListener('message', handler);
  }
  if (typeof window === 'undefined') return () => {};
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
  window.addEventListener('storage', handler);
  return () => window.removeEventListener('storage', handler);
}
