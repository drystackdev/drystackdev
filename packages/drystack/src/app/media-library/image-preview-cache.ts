import {
  getThumbFromPersistedCache,
  setThumbToPersistedCache,
} from '../object-cache';

// Shared image-preview caching used by every thumbnail/preview in the File
// Manager and Media Library. Two layers live here:
//
//  1. A refcounted object-URL cache. Blob bytes already live in `blobCache` /
//     IndexedDB (see useItemData.ts), but each preview component used to call
//     `URL.createObjectURL` on mount and revoke on unmount — so scrolling a
//     grid back and forth churned object URLs constantly for bytes we already
//     had. Here an object URL is created once per cache key and shared; when
//     the last consumer releases it, it lingers in a small idle queue instead
//     of being revoked immediately, so re-mounting reuses it.
//
//  2. Thumbnail generation. Grid cards render at ~110px but the raw blob is a
//     full-resolution original; `getThumbnailBytes` downscales once and
//     persists the result (keyed by blob sha) so later sessions skip both the
//     GitHub fetch of the full image AND the re-encode.

// ---------------------------------------------------------------------------
// Refcounted object-URL cache
// ---------------------------------------------------------------------------

type UrlEntry = { url: string; refs: number };
const urlCache = new Map<string, UrlEntry>();

// Keys whose refs have dropped to 0 but whose URL we keep alive a little
// longer (most-recently-released last). Revoked only when evicted past the
// limit — this is what makes scroll-back instant.
const IDLE_URL_LIMIT = 60;
const idleUrlQueue: string[] = [];

function unqueueIdle(key: string) {
  const i = idleUrlQueue.indexOf(key);
  if (i !== -1) idleUrlQueue.splice(i, 1);
}

// Reuse an already-created object URL for `key` without needing the bytes
// again — lets a re-mounting consumer skip re-fetching/re-encoding entirely.
// Returns null if nothing is cached for the key.
export function acquireExistingObjectURL(key: string): string | null {
  const existing = urlCache.get(key);
  if (!existing) return null;
  existing.refs++;
  unqueueIdle(key);
  return existing.url;
}

export function acquireObjectURL(key: string, bytes: Uint8Array): string {
  const existing = urlCache.get(key);
  if (existing) {
    existing.refs++;
    unqueueIdle(key);
    return existing.url;
  }
  const url = URL.createObjectURL(new Blob([bytes]));
  urlCache.set(key, { url, refs: 1 });
  return url;
}

export function releaseObjectURL(key: string): void {
  const entry = urlCache.get(key);
  if (!entry) return;
  entry.refs--;
  if (entry.refs > 0) return;
  idleUrlQueue.push(key);
  while (idleUrlQueue.length > IDLE_URL_LIMIT) {
    const evicted = idleUrlQueue.shift()!;
    const e = urlCache.get(evicted);
    // Guard: it may have been re-acquired between queueing and eviction.
    if (e && e.refs === 0) {
      URL.revokeObjectURL(e.url);
      urlCache.delete(evicted);
    }
  }
}

// ---------------------------------------------------------------------------
// Thumbnail generation + persistent cache
// ---------------------------------------------------------------------------

export const THUMBNAIL_MAX_DIM = 256;

export function thumbnailKey(sha: string, maxDim = THUMBNAIL_MAX_DIM) {
  return `${sha}@${maxDim}`;
}

// Dedupe concurrent generations for the same blob — a grid mounts N cards for
// the same image at once and they'd otherwise each decode+encode it.
const thumbInFlight = new Map<string, Promise<Uint8Array>>();

// Returns downscaled bytes for `sourceBytes`, falling back to `sourceBytes`
// unchanged when downscaling isn't possible/worthwhile (see generateThumbnail).
export async function getThumbnailBytes(
  sha: string,
  sourceBytes: Uint8Array,
  maxDim = THUMBNAIL_MAX_DIM
): Promise<Uint8Array> {
  const key = thumbnailKey(sha, maxDim);
  const inFlight = thumbInFlight.get(key);
  if (inFlight) return inFlight;

  const promise = (async () => {
    const cached = await getThumbFromPersistedCache(key);
    if (cached) return cached;
    const thumb = await generateThumbnail(sourceBytes, maxDim);
    if (!thumb) return sourceBytes;
    setThumbToPersistedCache(key, thumb);
    return thumb;
  })();
  thumbInFlight.set(key, promise);
  try {
    return await promise;
  } finally {
    thumbInFlight.delete(key);
  }
}

// Downscales via createImageBitmap + OffscreenCanvas. Returns null (caller
// falls back to the full bytes) when the environment lacks these APIs, the
// image can't be decoded (e.g. SVG in some browsers), or it's already small
// enough that re-encoding wouldn't save anything.
async function generateThumbnail(
  sourceBytes: Uint8Array,
  maxDim: number
): Promise<Uint8Array | null> {
  if (
    typeof createImageBitmap !== 'function' ||
    typeof OffscreenCanvas === 'undefined'
  ) {
    return null;
  }
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([sourceBytes]));
  } catch {
    return null;
  }
  try {
    const { width, height } = bitmap;
    const scale = Math.min(1, maxDim / Math.max(width, height));
    if (scale >= 1) return null; // already ≤ maxDim, keep the original
    const w = Math.max(1, Math.round(width * scale));
    const h = Math.max(1, Math.round(height * scale));
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0, w, h);
    let blob: Blob;
    try {
      blob = await canvas.convertToBlob({ type: 'image/webp', quality: 0.8 });
    } catch {
      blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    }
    return new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  } finally {
    bitmap.close();
  }
}
