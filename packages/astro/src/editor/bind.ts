import type { Config } from '@drystack/core';
import {
  getAllEdits,
  publishEdit,
  publishClear,
  getMeta,
  setMeta,
  subscribeEdits,
  getSourceCache,
  setSourceCache,
  clearSourceCache,
  getPendingBlob,
  clearPendingBlobs,
  type EditBusMessage,
} from './store';
import { getLatestFieldValues } from './save';

const BUILD_VERSION_KEY = 'buildVersion';

let editing = false;
let onChangeCallback: (() => void) | undefined;

// The server-rendered (on-disk) value for each editable key, captured before
// any pending edit is painted over it. Lets the review dialog show a
// before/after diff entirely client-side — no file-read round-trip needed.
const originalValues = new Map<string, string>();

function rememberOriginal(key: string, value: string) {
  if (!originalValues.has(key)) originalValues.set(key, value);
}

export function getOriginalValue(key: string): string | undefined {
  return originalValues.get(key);
}

// Force the diff baseline for `key` to `value`, overwriting any existing
// baseline. Used after a deploy ships: the value now live on the server *is*
// `value`, so the next edit to this field should diff against it rather than
// whatever was on screen before the just-shipped edit.
export function resetOriginalValue(key: string, value: string) {
  originalValues.set(key, value);
}

function isImageSpot(el: HTMLElement): boolean {
  return el.getAttribute('data-dry-kind') === 'image';
}

function isArraySpot(el: HTMLElement): boolean {
  return el.getAttribute('data-dry-kind') === 'array';
}

// --- Array binding (template-clone) --------------------------------------
//
// A fields.array container (e.g. <ul {...dry.item('array')}>) renders its
// items as ordinary child elements the page author wrote themselves (e.g.
// <li {...dry.item('array.0')}>) — there's no framework-owned render function
// to re-invoke when the array's length changes. Instead, the first existing
// item element is captured as a per-container "template" the first time it's
// seen; growing the array clones it, shrinking removes the trailing excess.
// Only direct children of the container count as items (matches the
// dry.item('array.N') convention) — this is the scoped MVP for array-of-text
// and array-of-image, see plan/vei-array-object.md.
const arrayTemplates = new Map<string, HTMLElement>();

function getArrayItemChildren(container: HTMLElement, key: string): HTMLElement[] {
  const prefix = `${key}.`;
  return Array.from(container.children).filter(
    (child): child is HTMLElement =>
      child.getAttribute('data-dry')?.startsWith(prefix) === true
  );
}

// An array's items all share the same element schema, so one representative
// element's own data-dry-kind (server-rendered by dry.item(), preserved
// through template-clone) tells us how to read/paint every item — the
// captured template is checked first since it survives even after the array
// is edited down to zero items on screen.
function getArrayElementKind(container: HTMLElement, key: string): 'text' | 'image' {
  const kindOf = (el: HTMLElement | undefined) =>
    el?.getAttribute('data-dry-kind') === 'image' ? 'image' : 'text';
  const template = arrayTemplates.get(key);
  if (template) return kindOf(template);
  return kindOf(getArrayItemChildren(container, key)[0]);
}

function readArrayValues(container: HTMLElement, key: string): string[] {
  const kind = getArrayElementKind(container, key);
  return getArrayItemChildren(container, key).map(el => {
    if (kind !== 'image') return el.textContent ?? '';
    // `data-dry-value` (set by paintImageSpot/applyEdit) is the real path;
    // `src` alone can be a transient blob: preview URL once a pending image
    // edit has been applied — reading that back as "the value" would leak
    // the local object URL into a save. Only an item never touched by JS
    // (straight from SSR) lacks the attribute, and its `src` is real then.
    return el.getAttribute('data-dry-value') ?? el.getAttribute('src') ?? '';
  });
}

// Captures a clonable template from the first existing item, if one exists
// and none has been captured yet — a container that had no items when first
// seen has nothing to clone a shape from, so it never gets a template (the
// toolbar's gear button stays disabled whenever an array has zero items on
// the page, see Toolbar.tsx, which is what keeps this reachable state rare).
function captureArrayTemplate(container: HTMLElement, key: string): HTMLElement[] {
  const items = getArrayItemChildren(container, key);
  if (items.length > 0 && !arrayTemplates.has(key)) {
    const template = items[0].cloneNode(true) as HTMLElement;
    template.removeAttribute('contenteditable');
    arrayTemplates.set(key, template);
  }
  return items;
}

// Reconciles a container's item elements to match `values`, by index —
// clones the captured template to grow, removes trailing elements to shrink,
// and repaints surviving elements' text + data-dry index in place. Live and
// framework-agnostic: no VDOM diffing, just direct DOM surgery on whatever
// markup the page author wrote.
function renderArray(container: HTMLElement, key: string, values: string[]): void {
  const items = captureArrayTemplate(container, key);
  const template = arrayTemplates.get(key);
  const kind = getArrayElementKind(container, key);
  for (let i = 0; i < values.length; i++) {
    let el = items[i];
    if (!el) {
      if (!template) break;
      el = template.cloneNode(true) as HTMLElement;
      container.appendChild(el);
      items[i] = el;
    }
    const itemKey = `${key}.${i}`;
    el.setAttribute('data-dry', itemKey);
    if (kind === 'image') {
      revokeImageObjectUrl(itemKey);
      paintImageSpot(el, values[i]);
    } else {
      el.textContent = values[i];
      if (editing) {
        el.contentEditable = 'plaintext-only';
        if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
      }
    }
  }
  for (let i = values.length; i < items.length; i++) {
    items[i].remove();
  }
}

// Reads a fields.array field's current live value straight off the DOM
// (already up to date with any pending item/container edits already
// painted) — used to seed the array editor dialog and to check whether the
// toolbar's gear button should be enabled (see Toolbar.tsx).
export function getArrayValueFromDom(key: string): string[] | undefined {
  const container = document.querySelector<HTMLElement>(`[data-dry="${CSS.escape(key)}"]`);
  if (!container) return undefined;
  return readArrayValues(container, key);
}

function handleInput(e: Event) {
  const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-dry]');
  if (!el || isImageSpot(el)) return;
  const key = el.getAttribute('data-dry');
  if (!key) return;
  publishEdit(key, el.textContent ?? '').then(() => onChangeCallback?.());
}

// Registered by the toolbar once the media-library host has mounted — clicking
// an image spot in edit mode opens the same file-manager picker the admin's
// fields.image input uses, rather than making the image contenteditable.
let onImageSpotClickCallback: ((key: string) => void) | undefined;

export function setImageSpotClickHandler(cb: ((key: string) => void) | undefined) {
  onImageSpotClickCallback = cb;
}

function handleImageSpotClick(e: MouseEvent) {
  const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-dry]');
  if (!el || !isImageSpot(el)) return;
  e.preventDefault();
  const key = el.getAttribute('data-dry');
  if (key) onImageSpotClickCallback?.(key);
}

export function isEditing() {
  return editing;
}

export function enableEditing(onChange?: () => void) {
  editing = true;
  onChangeCallback = onChange;
  document.body.classList.add('editing');
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    const key = el.getAttribute('data-dry');
    if (isImageSpot(el)) {
      // No pending edit was painted here, so the current `src` is the
      // on-disk value — safe to snapshot now as the diff baseline.
      if (key) rememberOriginal(key, el.getAttribute('src') ?? '');
      return;
    }
    if (isArraySpot(el)) {
      // Not contentEditable — edited via the toolbar's gear-button dialog
      // (whole-array replace) or by typing directly into an item spot
      // (array.N, a plain text spot handled by the branch below).
      if (key) {
        rememberOriginal(key, JSON.stringify(readArrayValues(el, key)));
        captureArrayTemplate(el, key);
      }
      return;
    }
    if (key) rememberOriginal(key, el.textContent ?? '');
    el.contentEditable = 'plaintext-only';
    // Firefox versions without plaintext-only support silently ignore it.
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  });
  document.addEventListener('input', handleInput, true);
  document.addEventListener('click', handleImageSpotClick, true);
}

export function disableEditing() {
  editing = false;
  document.body.classList.remove('editing');
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    if (isImageSpot(el)) return;
    if (isArraySpot(el)) return;
    el.removeAttribute('contenteditable');
  });
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('click', handleImageSpotClick, true);
}

// Cloudflare Pages builds fresh on every deploy, so buildVersion (a build-time
// timestamp) increases with each deploy. Only github-hosted content can drift
// out from under a browser's IndexedDB this way — a Cloudflare build finishing
// after this tab loaded means the DOM it applies edits onto is stale — so
// local mode (always serving whatever's on disk right now) skips this check.
//
// The stored high-water mark only ever moves forward. A lower buildVersion
// than what's stored isn't a rollback signal worth acting on — it's what a
// CDN edge node serving a not-yet-updated cache during rollout looks like —
// so it's ignored entirely: no clear, and the stored mark isn't dragged back
// down (which would otherwise make a later, merely-stale-again reload look
// like a "new" deploy and wrongly clear edits made in between).
export async function discardEditsIfBuildIsNewer(
  config: Config<any, any>,
  buildVersion: number | undefined
): Promise<void> {
  if (config.storage.kind !== 'github' || buildVersion == null) return;
  const lastSeen = await getMeta<number>(BUILD_VERSION_KEY);
  if (lastSeen == null) {
    await setMeta(BUILD_VERSION_KEY, buildVersion);
    return;
  }
  if (buildVersion > lastSeen) {
    await publishClear();
    // The static build just caught up, so its HTML is now at least as fresh
    // as anything cached below — keeping a stale entry around would risk it
    // later painting over even-fresher static HTML from a *subsequent*
    // deploy this tab never re-fetched for. Same reasoning covers the pending
    // image blobs: any image the build just shipped is now servable from its
    // real path, so the preview bytes cached for it are no longer needed.
    await clearSourceCache();
    await clearPendingBlobs();
    await setMeta(BUILD_VERSION_KEY, buildVersion);
  }
}

// Live object URLs currently painted onto an image spot, keyed by field key —
// tracked so a later paint (or a reset/discard) can revoke the previous one
// instead of leaking it.
const imageObjectUrls = new Map<string, string>();

function revokeImageObjectUrl(key: string): void {
  const existing = imageObjectUrls.get(key);
  if (existing) {
    URL.revokeObjectURL(existing);
    imageObjectUrls.delete(key);
  }
}

// Paints an image spot's `src` and records the real value (never a blob:
// preview URL) in `data-dry-value` — `src` alone isn't a reliable read-back
// source once a pending-blob preview has been painted over it (see
// applyEdit below), but array items need to read *some* attribute off the
// DOM to reconstruct their container's current value (see readArrayValues),
// so this is the one place that intentionally survives a blob-URL repaint.
function paintImageSpot(el: HTMLElement, value: string): void {
  el.removeAttribute('srcset');
  el.hidden = !value;
  if (value) {
    el.setAttribute('src', value);
    el.setAttribute('data-dry-value', value);
  } else {
    el.removeAttribute('data-dry-value');
  }
}

// Paints a value fetched straight from source (never a pending edit — see
// refreshFromLatestSource/applyCachedSource) onto one element and resets its
// diff baseline to match. Source values are always real, already-servable
// paths (never pending-blob previews), so no blob lookup is needed here.
function paintFetchedValue(el: HTMLElement, key: string, value: string): void {
  resetOriginalValue(key, value);
  if (isImageSpot(el)) {
    revokeImageObjectUrl(key);
    paintImageSpot(el, value);
    return;
  }
  if (isArraySpot(el)) {
    const parsed = parseArrayValue(value);
    if (parsed) renderArray(el, key, parsed);
    return;
  }
  el.textContent = value;
}

// `value` on the edit-sync bus is always a string — a fields.array value is
// carried as its JSON-encoded form (see save.ts's getLatestFieldValues and
// the array dialog's publishEdit in Toolbar.tsx). Malformed/foreign JSON is
// swallowed rather than thrown, since a bad value here shouldn't break
// painting for the rest of the page.
function parseArrayValue(value: string): string[] | undefined {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as string[]) : undefined;
  } catch {
    return undefined;
  }
}

// Re-reads every on-page singleton straight from its real source (local API,
// or the GitHub Contents API at the default branch) and repaints any field
// that has no pending edit — called when entering edit mode so a visitor
// starts from what's actually on disk/GitHub, not from HTML that may be
// stale (a github-mode page can be served from a Cloudflare CDN edge that
// hasn't caught up with the latest deploy yet). Fields with a pending edit
// are left alone: unsaved typed content always wins over a fresh fetch.
// Best-effort — a fetch failure (e.g. no GitHub auth cookie) just leaves the
// server-rendered text in place rather than blocking edit mode.
export async function refreshFromLatestSource(
  config: Config<any, any>
): Promise<void> {
  const singletonNames = new Set<string>();
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    const [type, name] = el.getAttribute('data-dry')?.split('::') ?? [];
    if (type === 'singleton' && name) singletonNames.add(name);
  });

  const pendingKeys = new Set((await getAllEdits()).map(edit => edit.key));

  await Promise.all(
    Array.from(singletonNames, async name => {
      let latest: Record<string, string>;
      try {
        latest = await getLatestFieldValues(config, name);
      } catch {
        return;
      }
      // Persist what we just fetched so a reload during the window between
      // "commit landed on GitHub" and "the next static build/deploy actually
      // ships it" still shows this instead of stale pre-deploy HTML — see
      // applyCachedSource below.
      await setSourceCache(name, latest);
      document
        .querySelectorAll<HTMLElement>(
          `[data-dry^="singleton::${CSS.escape(name)}::"]`
        )
        .forEach(el => {
          const key = el.getAttribute('data-dry')!;
          if (pendingKeys.has(key)) return;
          const field = key.split('::')[2];
          const value = latest[field];
          if (value === undefined) return;
          paintFetchedValue(el, key, value);
        });
    })
  );
}

// Restores one field's on-page element(s) to their captured baseline — shared
// by resetPendingEdits (all fields) and the review dialog's per-field discard.
// Baseline values (see rememberOriginal) are always real on-disk/GitHub
// values, never pending-blob previews, so this never needs a blob lookup.
export function revertFieldToOriginal(key: string): void {
  const original = getOriginalValue(key);
  if (original === undefined) return;
  document
    .querySelectorAll<HTMLElement>(`[data-dry="${CSS.escape(key)}"]`)
    .forEach(el => {
      if (isImageSpot(el)) {
        revokeImageObjectUrl(key);
        paintImageSpot(el, original);
        return;
      }
      if (isArraySpot(el)) {
        const parsed = parseArrayValue(original);
        if (parsed) renderArray(el, key, parsed);
        return;
      }
      el.textContent = original;
    });
}

// Discards every pending edit: restores each on-page field to its captured
// baseline (kept accurate by refreshFromLatestSource/applyPendingEdits) and
// clears the IndexedDB edit log — no network fetch needed.
export async function resetPendingEdits(): Promise<void> {
  const keys = new Set<string>();
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    const key = el.getAttribute('data-dry');
    if (key) keys.add(key);
  });
  keys.forEach(revertFieldToOriginal);
  await publishClear();
  await clearPendingBlobs();
}

// Paints one pending edit onto every DOM element carrying its key — a field
// can be rendered more than once on a page (e.g. a site title in both the
// header and footer), so every matching element must get it, not just the
// first in document order. Shared by the bulk on-load apply below and the
// live cross-tab subscription, which paints one key at a time as edits
// arrive from other tabs.
//
// Image values prefer the pending-blob cache (see edit-sync.ts) over the raw
// path: a freshly picked/uploaded image isn't guaranteed servable at its path
// yet (github mode needs a deploy to catch up), but its bytes are already
// known locally. Exported so the toolbar's image-picker flow can paint a
// freshly picked file immediately after publishing it, the same way a
// same-key edit arriving from another tab gets painted below.
export async function applyEdit(key: string, value: string): Promise<void> {
  const els = document.querySelectorAll<HTMLElement>(
    `[data-dry="${CSS.escape(key)}"]`
  );
  let blob: Uint8Array | undefined;
  if (Array.from(els).some(isImageSpot) && value) {
    blob = await getPendingBlob(value);
  }
  els.forEach(el => {
    if (isImageSpot(el)) {
      // Capture the on-disk value before overwriting it with the pending edit.
      rememberOriginal(key, el.getAttribute('src') ?? '');
      revokeImageObjectUrl(key);
      el.removeAttribute('srcset');
      el.hidden = !value;
      if (!value) {
        el.removeAttribute('data-dry-value');
        return;
      }
      // `data-dry-value` always records `value` itself (the real path), even
      // when `src` is about to be overwritten with a local blob: preview —
      // see paintImageSpot/readArrayValues for why the two can't be the same
      // attribute.
      el.setAttribute('data-dry-value', value);
      if (blob) {
        const url = URL.createObjectURL(new Blob([blob]));
        imageObjectUrls.set(key, url);
        el.setAttribute('src', url);
      } else {
        el.setAttribute('src', value);
      }
      return;
    }
    if (isArraySpot(el)) {
      // Capture the on-disk value before overwriting it with the pending edit.
      rememberOriginal(key, JSON.stringify(readArrayValues(el, key)));
      const parsed = parseArrayValue(value);
      if (parsed) renderArray(el, key, parsed);
      return;
    }
    rememberOriginal(key, el.textContent ?? '');
    el.textContent = value;
  });
}

// Paints the last known fetched-from-source value (see refreshFromLatestSource)
// for singleton fields that don't have a pending edit — bridges a github-mode
// save's commit-to-deploy gap without a network fetch: a reload right after
// saving would otherwise show the stale pre-deploy static HTML with nothing
// to paint over it, since a successful save clears the pending-edit entry.
async function applyCachedSource(pendingKeys: Set<string>): Promise<void> {
  const singletonNames = new Set<string>();
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    const [type, name] = el.getAttribute('data-dry')?.split('::') ?? [];
    if (type === 'singleton' && name) singletonNames.add(name);
  });

  await Promise.all(
    Array.from(singletonNames, async name => {
      const cached = await getSourceCache(name);
      if (!cached) return;
      document
        .querySelectorAll<HTMLElement>(
          `[data-dry^="singleton::${CSS.escape(name)}::"]`
        )
        .forEach(el => {
          const key = el.getAttribute('data-dry')!;
          if (pendingKeys.has(key)) return;
          const field = key.split('::')[2];
          const value = cached[field];
          if (value === undefined) return;
          paintFetchedValue(el, key, value);
        });
    })
  );
}

// Applies edits saved in IndexedDB on top of the server-rendered DOM — runs
// on every page load (even before Edit mode is turned on) so an unsaved edit
// survives a reload, per plan.md's "chưa lưu thì reload phải lấy IndexDB".
export async function applyPendingEdits(): Promise<number> {
  const edits = await getAllEdits();
  const pendingKeys = new Set(edits.map(edit => edit.key));
  // Cached source first (sets the baseline for fields with no pending edit),
  // then pending edits on top — applyEdit's rememberOriginal only captures a
  // baseline if one isn't already set, so ordering here matters.
  await applyCachedSource(pendingKeys);
  for (const edit of edits) await applyEdit(edit.key, edit.value);
  return edits.length;
}

// Keeps this page's DOM live-synced with edits published from other tabs
// (admin or another visual-editor tab) — not just on load, per plan.md's
// cross-tab requirement. Returns an unsubscribe function; the editor mounts
// once per page load and is never torn down, so callers are free to ignore it.
export function subscribeToRemoteEdits(
  config: Config<any, any>,
  onChange?: () => void
): () => void {
  return subscribeEdits((msg: EditBusMessage) => {
    if (msg.type === 'set') {
      applyEdit(msg.key, msg.value).then(() => onChange?.());
      return;
    }
    // 'delete' / 'clear' — a save (this key's edit is now committed) or a
    // reset (it's discarded) happened somewhere. Either way this tab's own
    // `originalValues` snapshot is unreliable as "the current truth": for a
    // save it's the *pre-edit* value, not what's now on disk/GitHub. Re-fetch
    // for real instead of guessing, so a bystander tab always ends up
    // showing what's actually live, not a stale local baseline.
    refreshFromLatestSource(config).then(() => onChange?.());
  });
}
