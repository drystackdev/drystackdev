import type { Config } from '@drystack/core';
// @ts-expect-error — provided by the drystack Astro integration's Vite plugin
import apiPath from 'virtual:drystack-path';
import type { DryMapEntry } from '../dry';
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

function isFileSpot(el: HTMLElement): boolean {
  return el.getAttribute('data-dry-kind') === 'file';
}

// image and file spots share every editing behavior below (not
// contentEditable, edited via the media-library picker, value lives in
// data-dry-value with a pending-blob preview) — they only differ in which
// native attribute (`src` vs `href`) carries the pristine SSR value. See
// readAssetAttr/paintAssetSpot.
function isAssetSpot(el: HTMLElement): boolean {
  return isImageSpot(el) || isFileSpot(el);
}

function isArraySpot(el: HTMLElement): boolean {
  return el.getAttribute('data-dry-kind') === 'array';
}

// A container element whose own value is a fields.object — either an
// array-of-object item's *wrapper* (set server-side by dry.item('cards.0'))
// or a standalone object field at any depth (dry.item('brand'),
// dry.item('sections.0.nested'), …). Purely a structural marker: it's never
// itself contentEditable, and its own descendant spots (leaf or a further-
// nested container) are handled individually by the generic branches below —
// see isContainerSpot/readContainerValue/paintContainerValue.
function isObjectSpot(el: HTMLElement): boolean {
  return el.getAttribute('data-dry-kind') === 'object';
}

// Either kind of structural container marker (array or object) — never
// contentEditable itself; its value is read/painted as one recursive unit via
// readContainerValue/paintContainerValue rather than the flat text/asset
// branches below.
function isContainerSpot(el: HTMLElement): boolean {
  return isArraySpot(el) || isObjectSpot(el);
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
// dry.item('array.N') convention). An item may itself be a further-nested
// container (object, or another array) — see readContainerValue/
// paintContainerValue below, plan/de-quy-object.md.
const arrayTemplates = new Map<string, HTMLElement>();

// Elements at or under `root` (including `root` itself) whose data-dry
// starts with `prefix`, self first. Lets every array-item helper below work
// whether the item's dry.item() spot lives on the item root itself (the
// legacy self-marked pattern, e.g. arrayImg's <Image {...dry.item('arrayImg.0')}/>)
// or on a descendant inside author-supplied wrapper markup the item root
// itself doesn't carry data-dry for (e.g. <li><div {...dry.item('array.0')}>
// ...</div></li> — the <li> is just the clone-template unit).
function collectDrySpots(root: HTMLElement, prefix: string): HTMLElement[] {
  const spots: HTMLElement[] = [];
  if (root.getAttribute('data-dry')?.startsWith(prefix)) spots.push(root);
  root.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    if (el.getAttribute('data-dry')?.startsWith(prefix)) spots.push(el);
  });
  return spots;
}

// Cheaper existence check than collectDrySpots(...).length > 0 for callers
// that only need a boolean — `[data-dry^="prefix"]` lets the engine stop at
// the first match instead of collecting every match just to measure it.
function hasDrySpot(root: HTMLElement, prefix: string): boolean {
  if (root.getAttribute('data-dry')?.startsWith(prefix)) return true;
  return root.querySelector(`[data-dry^="${CSS.escape(prefix)}"]`) !== null;
}

function getArrayItemChildren(container: HTMLElement, key: string): HTMLElement[] {
  const prefix = `${key}.`;
  return Array.from(container.children).filter(
    (child): child is HTMLElement => hasDrySpot(child as HTMLElement, prefix)
  );
}

// Direct sub-field/item spots of a container at `key` — every descendant
// whose key extends `prefix` (= `${key}.`) by exactly one segment (no
// further dot), found via the prefix-scan above (collectDrySpots) so authors
// can still wrap arbitrary non-dry markup between a container and its marked
// children. A descendant two-or-more segments deeper — a grandchild reached
// through some *other*, itself-nested container — is excluded here; that
// nested container's own recursive read/paint call handles it, not this one.
function directChildSpots(root: HTMLElement, prefix: string): HTMLElement[] {
  return collectDrySpots(root, prefix).filter(
    el => !el.getAttribute('data-dry')!.slice(prefix.length).includes('.')
  );
}

// The element carrying EXACTLY `key` as its own data-dry (not merely
// prefixed by it) — `root` itself first, else the closest descendant.
// Distinguishes "this item/container has its own explicit dry.item() mark"
// (self-marked leaf, or self-marked array/object container) from the
// unmarked-wrapper fallback used by readItemOrLeaf/paintItemOrLeaf below.
function exactDrySpot(root: HTMLElement, key: string): HTMLElement | undefined {
  if (root.getAttribute('data-dry') === key) return root;
  return root.querySelector<HTMLElement>(`[data-dry="${CSS.escape(key)}"]`) ?? undefined;
}

// The native attribute an asset spot's kind carries its value in — `src` for
// an image, `href` for a file (typically an <a> download link). Dispatches
// on data-dry-kind, same as every other decision in this file, rather than
// the element's tag name, so it stays correct even if a future spot renders
// its kind on an unexpected element.
function nativeAssetAttr(el: HTMLElement): 'src' | 'href' {
  return isImageSpot(el) ? 'src' : 'href';
}

// The native attribute carrying an asset spot's pristine SSR value. Only
// meaningful before any JS has painted over it (see paintAssetSpot, which
// always records the real value in data-dry-value afterwards).
function readAssetAttr(el: HTMLElement): string | null {
  return el.getAttribute(nativeAssetAttr(el));
}

// Reads one image/file/text spot's current live value off the DOM.
function readSpotValue(el: HTMLElement): string {
  if (!isAssetSpot(el)) return el.textContent ?? '';
  // `data-dry-value` (set by paintAssetSpot/applyEdit) is the real path;
  // `src`/`href` alone can be a transient blob: preview URL once a pending
  // edit has been applied — reading that back as "the value" would leak the
  // local object URL into a save. Only an item never touched by JS (straight
  // from SSR) lacks the attribute, and its native attribute is real then.
  return el.getAttribute('data-dry-value') ?? readAssetAttr(el) ?? '';
}

// Reads one object container's direct sub-fields into a plain object —
// `root` is the container's own element (or, for the unmarked-wrapper
// fallback, the item element that has no mark of its own — see
// readItemOrLeaf). Image/file sub-fields read null when empty, matching
// fields.image/fields.file's null value so the shape lines up with the
// admin form/reader; a sub-field that's itself a container recurses via
// readContainerValue instead of reading a flat leaf value.
function readObjectFields(root: HTMLElement, key: string): Record<string, unknown> {
  const prefix = `${key}.`;
  const obj: Record<string, unknown> = {};
  directChildSpots(root, prefix).forEach(el => {
    const sub = el.getAttribute('data-dry')!.slice(prefix.length);
    const subKey = `${key}.${sub}`;
    const subKind = el.getAttribute('data-dry-kind');
    if (subKind === 'array' || subKind === 'object') {
      obj[sub] = readContainerValue(el, subKey);
    } else if (isAssetSpot(el)) {
      const v = readSpotValue(el);
      obj[sub] = v === '' ? null : v;
    } else {
      obj[sub] = el.textContent ?? '';
    }
  });
  return obj;
}

// Reads one array item's value — dispatches on the item's own explicit mark
// if it has one (self-marked leaf, or self-marked array/object container),
// else falls back to the legacy unmarked-wrapper pattern (no mark of its
// own; treated as an object whose direct children are its sub-fields, each
// of which may itself now be a further-nested container).
function readItemOrLeaf(itemEl: HTMLElement, key: string): unknown {
  const own = exactDrySpot(itemEl, key);
  if (own) {
    const kind = own.getAttribute('data-dry-kind');
    if (kind === 'array' || kind === 'object') return readContainerValue(own, key);
    return readSpotValue(own);
  }
  return readObjectFields(itemEl, key);
}

// Reads a container's (array or object) current live value off the DOM,
// recursing into any array item / object sub-field that's itself a
// container. `el` must be the container's own marked element (its
// data-dry-kind decides which shape to read).
function readContainerValue(el: HTMLElement, key: string): unknown {
  if (el.getAttribute('data-dry-kind') === 'array') {
    return getArrayItemChildren(el, key).map((item, i) => readItemOrLeaf(item, `${key}.${i}`));
  }
  return readObjectFields(el, key);
}

// Whether an array's items are themselves containers (object or nested
// array) rather than flat leaves — sampled from the captured template (or
// the first live item) the same way the array's shared shape is sampled
// elsewhere, reduced to a boolean. Used only to decide whether a
// source-refresh repaint is safe (see paintFetchedValue) — item-level
// read/paint itself dispatches per item via readItemOrLeaf/paintItemOrLeaf
// and doesn't need this.
function arrayHasContainerItems(container: HTMLElement, key: string): boolean {
  const sample = arrayTemplates.get(key) ?? getArrayItemChildren(container, key)[0];
  if (!sample) return false;
  const itemKey = `${key}.0`;
  const own = exactDrySpot(sample, itemKey);
  if (own) {
    const kind = own.getAttribute('data-dry-kind');
    return kind === 'array' || kind === 'object';
  }
  // Unmarked wrapper — the legacy pattern always implies an object item.
  return directChildSpots(sample, `${itemKey}.`).length > 0;
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
    // For an object-item template, its text sub-field spots may already carry
    // contenteditable — strip them so a freshly cloned item starts clean
    // (renderArray re-adds it per sub-field when in edit mode).
    template
      .querySelectorAll('[contenteditable]')
      .forEach(el => el.removeAttribute('contenteditable'));
    arrayTemplates.set(key, template);
  }
  return items;
}

// Makes an element contentEditable in edit mode (plaintext-only, with the
// Firefox fallback), matching how a plain text spot is enabled.
function makeEditableIfEditing(el: HTMLElement): void {
  if (!editing) return;
  el.contentEditable = 'plaintext-only';
  if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
}

// Paints one object container's direct sub-fields from `obj`, mirroring
// readObjectFields — a sub-field that's itself a container recurses via
// paintContainerValue instead of a flat leaf paint. `root` is the
// container's own element (or, for the unmarked-wrapper fallback, the item
// element that has no mark of its own — see paintItemOrLeaf). Never touches
// re-indexing; callers that need it (array items — see paintArrayItem) do
// that separately first.
async function paintObjectFields(
  root: HTMLElement,
  key: string,
  obj: Record<string, unknown>,
  resolveBlobs = false
): Promise<void> {
  const prefix = `${key}.`;
  const paints: Promise<void>[] = [];
  directChildSpots(root, prefix).forEach(el => {
    const sub = el.getAttribute('data-dry')!.slice(prefix.length);
    const subKey = `${key}.${sub}`;
    const value = obj?.[sub];
    const subKind = el.getAttribute('data-dry-kind');
    if (subKind === 'array' || subKind === 'object') {
      paints.push(
        paintContainerValue(el, subKey, value ?? (subKind === 'array' ? [] : {}), resolveBlobs)
      );
    } else if (isAssetSpot(el)) {
      paints.push(
        paintAssetValue(el, subKey, typeof value === 'string' ? value : '', resolveBlobs)
      );
    } else {
      el.textContent = value == null ? '' : String(value);
      makeEditableIfEditing(el);
    }
  });
  await Promise.all(paints);
}

// Paints one array item's value, dispatching the same way readItemOrLeaf
// reads it: a self-marked container recurses via paintContainerValue, a
// self-marked leaf paints directly, and an unmarked wrapper falls back to
// paintObjectFields.
async function paintItemOrLeaf(
  itemEl: HTMLElement,
  key: string,
  value: unknown,
  resolveBlobs = false
): Promise<void> {
  const own = exactDrySpot(itemEl, key);
  if (own) {
    const kind = own.getAttribute('data-dry-kind');
    if (kind === 'array' || kind === 'object') {
      await paintContainerValue(own, key, value, resolveBlobs);
      return;
    }
    if (isAssetSpot(own)) {
      await paintAssetValue(own, key, typeof value === 'string' ? value : '', resolveBlobs);
    } else {
      own.textContent = value == null ? '' : String(value);
      makeEditableIfEditing(own);
    }
    return;
  }
  await paintObjectFields(itemEl, key, (value ?? {}) as Record<string, unknown>, resolveBlobs);
}

// Paints a container's (array or object) value onto its own marked element —
// the recursive counterpart to readContainerValue. `el`'s own data-dry-kind
// decides which shape to paint.
async function paintContainerValue(
  el: HTMLElement,
  key: string,
  value: unknown,
  resolveBlobs = false
): Promise<void> {
  if (el.getAttribute('data-dry-kind') === 'array') {
    await renderArray(el, key, Array.isArray(value) ? value : [], resolveBlobs);
    return;
  }
  await paintObjectFields(el, key, (value ?? {}) as Record<string, unknown>, resolveBlobs);
}

// Re-indexes every descendant spot under `item` (including `item`'s own, if
// it carries one) from whatever index it currently embeds to `i` — needed
// whenever a grown/shrunk/reordered array moves an item to a new position,
// regardless of whether the item is a leaf, an object, or itself a further-
// nested array: any of those can carry descendant spots whose keys embed the
// old index, and the rewrite is the same string-splice either way (replace
// the segment right after `key.` with `i`, keep everything past it — if
// any — verbatim). Then paints `value` onto the item at its new key via
// paintItemOrLeaf. `item` must be the specific item root element — querying
// from the whole array container would match every item's descendants (they
// all share the same `key.` prefix), reindexing every other item too.
async function paintArrayItem(
  item: HTMLElement,
  key: string,
  i: number,
  value: unknown,
  resolveBlobs = false
): Promise<void> {
  const itemPrefix = `${key}.`;
  const reindex = (el: HTMLElement) => {
    const k = el.getAttribute('data-dry');
    if (!k || !k.startsWith(itemPrefix)) return;
    const afterKey = k.slice(itemPrefix.length); // "<oldIdx>" or "<oldIdx>.<rest…>"
    const dot = afterKey.indexOf('.');
    const rest = dot === -1 ? '' : afterKey.slice(dot); // "" or ".<rest…>"
    el.setAttribute('data-dry', `${key}.${i}${rest}`);
  };
  reindex(item);
  item.querySelectorAll<HTMLElement>('[data-dry]').forEach(reindex);
  await paintItemOrLeaf(item, `${key}.${i}`, value, resolveBlobs);
}

// Revokes any object URLs held by an item's own or nested image/file spots
// before that item is removed (shrink), so previews don't leak — matches
// image/file spots at any depth under `item`, including `item` itself if
// it's directly an asset spot (a leaf array item).
function revokeItemAssets(item: HTMLElement): void {
  if (isAssetSpot(item)) {
    const k = item.getAttribute('data-dry');
    if (k) revokeAssetObjectUrl(k);
  }
  item
    .querySelectorAll<HTMLElement>('[data-dry-kind="image"], [data-dry-kind="file"]')
    .forEach(el => {
      const k = el.getAttribute('data-dry');
      if (k) revokeAssetObjectUrl(k);
    });
}

// Reconciles a container's item elements to match `values`, by index —
// clones the captured template to grow, removes trailing elements to shrink,
// and repaints surviving elements' value + data-dry index in place via
// paintArrayItem (which dispatches per item: leaf, container, or unmarked
// object wrapper — see readItemOrLeaf/arrayHasContainerItems for the same
// per-item dispatch on the read side). Live and framework-agnostic: no VDOM
// diffing, just direct DOM surgery on whatever markup the page author wrote.
async function renderArray(
  container: HTMLElement,
  key: string,
  values: unknown[],
  resolveBlobs = false
): Promise<void> {
  const items = captureArrayTemplate(container, key);
  const template = arrayTemplates.get(key);
  const paints: Promise<void>[] = [];
  for (let i = 0; i < values.length; i++) {
    let el = items[i];
    if (!el) {
      if (!template) break;
      el = template.cloneNode(true) as HTMLElement;
      container.appendChild(el);
      items[i] = el;
    }
    paints.push(paintArrayItem(el, key, i, values[i], resolveBlobs));
  }
  for (let i = values.length; i < items.length; i++) {
    revokeItemAssets(items[i]);
    items[i].remove();
  }
  await Promise.all(paints);
}

// Reads a fields.array or fields.object field's current live value straight
// off the DOM (already up to date with any pending item/container edits
// already painted) — used to seed the container editor dialog and to check
// whether the toolbar's gear button should be enabled (see Toolbar.tsx).
export function getContainerValueFromDom(key: string): unknown {
  const el = document.querySelector<HTMLElement>(`[data-dry="${CSS.escape(key)}"]`);
  if (!el) return undefined;
  return readContainerValue(el, key);
}

function handleInput(e: Event) {
  const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-dry]');
  if (!el || isAssetSpot(el) || isObjectSpot(el)) return;
  const key = el.getAttribute('data-dry');
  if (!key) return;
  publishEdit(key, el.textContent ?? '').then(() => onChangeCallback?.());
}

// Registered by the toolbar once its admin-provider boundary is ready —
// clicking an image/file spot in edit mode opens the same file-manager
// picker the admin's fields.image/fields.file input uses, rather than making
// the spot contenteditable. Keyed by data-dry-kind so a future asset kind
// only needs a new map entry, not a parallel var/setter/branch.
const assetSpotClickCallbacks: Partial<Record<'image' | 'file', (key: string) => void>> = {};

export function setImageSpotClickHandler(cb: ((key: string) => void) | undefined) {
  assetSpotClickCallbacks.image = cb;
}

export function setFileSpotClickHandler(cb: ((key: string) => void) | undefined) {
  assetSpotClickCallbacks.file = cb;
}

function handleAssetSpotClick(e: MouseEvent) {
  const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-dry]');
  if (!el) return;
  const key = el.getAttribute('data-dry');
  if (!key) return;
  const kind = el.getAttribute('data-dry-kind');
  if (kind !== 'image' && kind !== 'file') return;
  e.preventDefault();
  assetSpotClickCallbacks[kind]?.(key);
}

export function isEditing() {
  return editing;
}

export function enableEditing(onChange?: () => void) {
  editing = true;
  onChangeCallback = onChange;
  document.body.classList.add('editing');
  // Defer enabling the outline's hover transition until the class-add above
  // has actually painted — otherwise the browser treats this call itself as
  // the first style change and animates from the outline-less pre-editing
  // paint into blue (see editor.css's .dry-anim-ready comment).
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.body.classList.add('dry-anim-ready');
    });
  });
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    const key = el.getAttribute('data-dry');
    if (isAssetSpot(el)) {
      // No pending edit was painted here yet, so the current value (prefers
      // SSR's data-dry-value — see dry.ts's assetValue — over the native
      // src/href, which may just be author-supplied placeholder markup for
      // the empty case) is the on-disk value — safe to snapshot as the diff
      // baseline.
      const value = readSpotValue(el);
      if (key) rememberOriginal(key, value);
      // An empty asset spot is `hidden` server-side (see dry.ts/paintAssetSpot)
      // so regular visitors never see a dead link/broken image — but that
      // would also make it unclickable here, leaving no way to set a first
      // value via VEI. Reveal it for the duration of edit mode instead;
      // disableEditing re-hides it below if it's still empty on exit.
      if (!value) el.hidden = false;
      return;
    }
    if (isContainerSpot(el)) {
      // Not contentEditable — edited via the toolbar's gear-button dialog
      // (whole-container replace, array or object) or by typing directly
      // into a descendant leaf spot (a plain text/asset spot handled by the
      // branches above/below as the loop reaches it).
      if (key) {
        rememberOriginal(key, JSON.stringify(readContainerValue(el, key)));
        if (isArraySpot(el)) captureArrayTemplate(el, key);
      }
      return;
    }
    if (key) rememberOriginal(key, el.textContent ?? '');
    el.contentEditable = 'plaintext-only';
    // Firefox versions without plaintext-only support silently ignore it.
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  });
  document.addEventListener('input', handleInput, true);
  document.addEventListener('click', handleAssetSpotClick, true);
}

export function disableEditing() {
  editing = false;
  document.body.classList.remove('editing', 'dry-anim-ready');
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    if (isAssetSpot(el)) {
      // Re-hide any spot enableEditing revealed for editing that's still
      // empty, so a regular (non-editing) view doesn't show it.
      if (!readSpotValue(el)) el.hidden = true;
      return;
    }
    if (isContainerSpot(el)) return;
    el.removeAttribute('contenteditable');
  });
  document.removeEventListener('input', handleInput, true);
  document.removeEventListener('click', handleAssetSpotClick, true);
}

// GitHub-mode production HTML never carries plaintext data-dry/-kind/-value
// (see dry.ts) — only an opaque `data-dry-id`, to keep full field paths/kinds
// out of view-source for anonymous visitors. Must run before anything else
// touches `[data-dry]` (discardEditsIfBuildIsNewer/applyPendingEdits below
// resolve pending IndexedDB edits by querying `[data-dry="<key>"]`, and would
// find nothing if the real attributes aren't back on the elements yet).
// Fetches the reverse map from the `github/dry-map` API route — which only
// returns it once it verifies the caller's GitHub token server-side — and
// patches the real attributes onto each `[data-dry-id]` element in place. If
// the fetch 401s (not a real editor, e.g. a spoofed cookie) or the map is
// missing, elements are left with only `data-dry-id`: inert, no data-dry, so
// none of the editing logic below ever engages for them. Local mode already
// ships the real attributes directly (see dry.ts), so this is a no-op there.
export async function hydrateDryAttributesFromMap(
  config: Config<any, any>
): Promise<void> {
  if (config.storage.kind !== 'github') return;
  const elements = document.querySelectorAll<HTMLElement>('[data-dry-id]');
  if (elements.length === 0) return;
  let map: Record<string, DryMapEntry>;
  try {
    const res = await fetch(`/api/${apiPath}/github/dry-map`);
    if (!res.ok) return;
    map = await res.json();
  } catch {
    return;
  }
  for (const el of elements) {
    const id = el.getAttribute('data-dry-id');
    el.removeAttribute('data-dry-id');
    const entry = id ? map[id] : undefined;
    if (!entry) continue;
    el.setAttribute('data-dry', entry['data-dry']);
    el.setAttribute('data-dry-kind', entry['data-dry-kind']);
    if (entry['data-dry-value'] !== undefined) {
      el.setAttribute('data-dry-value', entry['data-dry-value']);
    }
  }
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

// Live object URLs currently painted onto an image/file spot, keyed by field
// key — tracked so a later paint (or a reset/discard) can revoke the
// previous one instead of leaking it.
const assetObjectUrls = new Map<string, string>();

function revokeAssetObjectUrl(key: string): void {
  const existing = assetObjectUrls.get(key);
  if (existing) {
    URL.revokeObjectURL(existing);
    assetObjectUrls.delete(key);
  }
}

// Paints an image/file spot's `src`/`href` and records the real value (never
// a blob: preview URL) in `data-dry-value` — the native attribute alone isn't
// a reliable read-back source once a pending-blob preview has been painted
// over it, but array items need to read *some* attribute off the DOM to
// reconstruct their container's current value (see readArrayValues), so this
// is the one place that intentionally survives a blob-URL repaint.
//
// `key` revokes this spot's previous object URL (if any) before painting —
// callers no longer do this themselves, so a blob preview (`blob`, a locally
// cached pending upload's bytes — see putPendingBlob/getPendingBlob) never
// needs the caller to also manage `assetObjectUrls`.
function paintAssetSpot(el: HTMLElement, key: string, value: string, blob?: Uint8Array): void {
  revokeAssetObjectUrl(key);
  el.removeAttribute('srcset');
  // Stays visible while editing even when empty, so it's still clickable to
  // set a first value (e.g. right after a Reset/discard lands back on empty
  // while edit mode is still on) — enableEditing/disableEditing handle the
  // same visibility for spots this function never repaints (the initial SSR
  // state on mode entry/exit).
  el.hidden = !value && !editing;
  const attr = nativeAssetAttr(el);
  if (!value) {
    // Clear the native attribute too, not just data-dry-value — readSpotValue
    // falls back to readAssetAttr() (the native src/href) whenever
    // data-dry-value is absent, so a stale href/src left in place here would
    // make a cleared nested container's file/image sub-field reappear as
    // "already selected" the next time the container dialog re-reads the DOM
    // (getContainerValueFromDom → readObjectFields → readSpotValue).
    el.removeAttribute(attr);
    el.removeAttribute('data-dry-value');
    return;
  }
  // `data-dry-value` always records `value` itself (the real path), even
  // when `src`/`href` is about to be overwritten with a local blob: preview.
  el.setAttribute('data-dry-value', value);
  if (blob) {
    const url = URL.createObjectURL(new Blob([blob as any]));
    assetObjectUrls.set(key, url);
    el.setAttribute(attr, url);
  } else {
    el.setAttribute(attr, value);
  }
}

// Resolves `value`'s pending-blob preview (a freshly picked/uploaded file's
// bytes, cached locally since it isn't guaranteed servable at its real path
// yet — github mode needs a deploy to catch up) when `resolveBlobs` is true,
// then paints it the same way applyEdit's single-field path already does.
// `resolveBlobs` is false for callers whose values are always real,
// already-servable paths (paintFetchedValue, revertFieldToOriginal) — no
// blob lookup needed there, and skipping it keeps this a plain synchronous
// paint for them (no `await` is ever reached, so nothing needs to change at
// those call sites beyond passing `key`).
async function paintAssetValue(
  el: HTMLElement,
  key: string,
  value: string,
  resolveBlobs: boolean
): Promise<void> {
  const blob = resolveBlobs && value ? await getPendingBlob(value) : undefined;
  paintAssetSpot(el, key, value, blob);
}

// Whether a container has any direct array-item or object-sub-field that's
// itself a container (rather than every direct child being a flat leaf) —
// the array case delegates to arrayHasContainerItems; the object case checks
// each direct sub-field spot's own kind the same way. Used only by
// paintFetchedValue's conservative skip below.
function containerHasNestedContainers(el: HTMLElement, key: string): boolean {
  if (isArraySpot(el)) return arrayHasContainerItems(el, key);
  return directChildSpots(el, `${key}.`).some(sub => {
    const k = sub.getAttribute('data-dry-kind');
    return k === 'array' || k === 'object';
  });
}

// Paints a value fetched straight from source (never a pending edit — see
// refreshFromLatestSource/applyCachedSource) onto one element and resets its
// diff baseline to match. Source values are always real, already-servable
// paths (never pending-blob previews), so no blob lookup is needed here.
//
// For a container, repainting unconditionally would silently clobber an
// in-progress item/sub-field edit (typed/picked but not yet saved) with the
// on-disk value, and would leave a not-pending entry's own diff baseline
// stuck at whatever enableEditing captured before this fetch ran (so a later
// Reset would revert it to a stale pre-fetch value instead of this fresh
// one). So each direct entry either keeps showing (and keeps the baseline
// of) its own pending edit untouched, or adopts the fetched value and has
// its baseline refreshed to match — mirroring save.ts's mergeFieldEdits
// precedence. A container-of-containers (array-of-object,
// object-with-nested-array, …) skips this entirely and leaves the current
// DOM alone — the per-key merge below only looks one level deep, so it can't
// safely tell which deeper leaf has a pending edit without repainting first
// (known limitation, inherited from the original array-of-object case; see
// plan/de-quy-object.md).
function paintFetchedValue(
  el: HTMLElement,
  key: string,
  value: string,
  pendingEdits: Map<string, string>
): void {
  resetOriginalValue(key, value);
  if (isAssetSpot(el)) {
    paintAssetSpot(el, key, value);
    return;
  }
  if (isContainerSpot(el)) {
    const parsed = isArraySpot(el) ? parseArrayValue(value) : parseObjectValue(value);
    if (parsed === undefined) return;
    if (containerHasNestedContainers(el, key)) return;
    if (isArraySpot(el)) {
      const merged = (parsed as unknown[]).map((v, i) => {
        const itemKey = `${key}.${i}`;
        const pending = pendingEdits.get(itemKey);
        if (pending !== undefined) return pending;
        resetOriginalValue(itemKey, v as string);
        return v;
      });
      renderArray(el, key, merged);
    } else {
      const merged: Record<string, unknown> = {};
      for (const [sub, v] of Object.entries(parsed as Record<string, unknown>)) {
        const subKey = `${key}.${sub}`;
        const pending = pendingEdits.get(subKey);
        if (pending !== undefined) {
          merged[sub] = pending;
          continue;
        }
        resetOriginalValue(subKey, v as string);
        merged[sub] = v;
      }
      paintObjectFields(el, key, merged);
    }
    return;
  }
  el.textContent = value;
}

// `value` on the edit-sync bus is always a string — a fields.array/
// fields.object value is carried as its JSON-encoded form (see save.ts's
// getLatestFieldValues and the container dialog's publishEdit in
// Toolbar.tsx). Malformed/foreign JSON is swallowed rather than thrown,
// since a bad value here shouldn't break painting for the rest of the page.
function parseArrayValue(value: string): unknown[] | undefined {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as unknown[]) : undefined;
  } catch {
    return undefined;
  }
}

function parseObjectValue(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
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

  const pendingEdits = new Map(
    (await getAllEdits()).map(edit => [edit.key, edit.value])
  );

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
          if (pendingEdits.has(key)) return;
          const field = key.split('::')[2];
          const value = latest[field];
          if (value === undefined) return;
          paintFetchedValue(el, key, value, pendingEdits);
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
      if (isAssetSpot(el)) {
        paintAssetSpot(el, key, original);
        return;
      }
      if (isContainerSpot(el)) {
        const parsed = isArraySpot(el) ? parseArrayValue(original) : parseObjectValue(original);
        if (parsed !== undefined) paintContainerValue(el, key, parsed);
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
// Image/file values prefer the pending-blob cache (see edit-sync.ts) over the
// raw path: a freshly picked/uploaded file isn't guaranteed servable at its
// path yet (github mode needs a deploy to catch up), but its bytes are
// already known locally. Exported so the toolbar's image/file-picker flow
// can paint a freshly picked file immediately after publishing it, the same
// way a same-key edit arriving from another tab gets painted below.
export async function applyEdit(key: string, value: string): Promise<void> {
  const els = document.querySelectorAll<HTMLElement>(
    `[data-dry="${CSS.escape(key)}"]`
  );
  let blob: Uint8Array | undefined;
  if (Array.from(els).some(isAssetSpot) && value) {
    blob = await getPendingBlob(value);
  }
  const pending: Promise<void>[] = [];
  els.forEach(el => {
    if (isAssetSpot(el)) {
      // Capture the on-disk value before overwriting it with the pending
      // edit — prefers data-dry-value over the native src/href, same reason
      // as enableEditing's baseline capture above.
      rememberOriginal(key, readSpotValue(el));
      paintAssetSpot(el, key, value, blob);
      return;
    }
    if (isContainerSpot(el)) {
      // Capture the on-disk value before overwriting it with the pending edit.
      rememberOriginal(key, JSON.stringify(readContainerValue(el, key)));
      const parsed = isArraySpot(el) ? parseArrayValue(value) : parseObjectValue(value);
      // resolveBlobs: true — a nested array/object item's freshly picked
      // file may not be servable at its real path yet either (same reason as
      // the asset branch above), so it previews from its own pending blob too.
      if (parsed !== undefined) pending.push(paintContainerValue(el, key, parsed, true));
      return;
    }
    rememberOriginal(key, el.textContent ?? '');
    el.textContent = value;
  });
  await Promise.all(pending);
}

// Paints the last known fetched-from-source value (see refreshFromLatestSource)
// for singleton fields that don't have a pending edit — bridges a github-mode
// save's commit-to-deploy gap without a network fetch: a reload right after
// saving would otherwise show the stale pre-deploy static HTML with nothing
// to paint over it, since a successful save clears the pending-edit entry.
async function applyCachedSource(
  pendingEdits: Map<string, string>
): Promise<void> {
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
          if (pendingEdits.has(key)) return;
          const field = key.split('::')[2];
          const value = cached[field];
          if (value === undefined) return;
          paintFetchedValue(el, key, value, pendingEdits);
        });
    })
  );
}

// Applies edits saved in IndexedDB on top of the server-rendered DOM — runs
// on every page load (even before Edit mode is turned on) so an unsaved edit
// survives a reload, per plan.md's "chưa lưu thì reload phải lấy IndexDB".
export async function applyPendingEdits(): Promise<number> {
  const edits = await getAllEdits();
  const pendingEdits = new Map(edits.map(edit => [edit.key, edit.value]));
  // Cached source first (sets the baseline for fields with no pending edit),
  // then pending edits on top — applyEdit's rememberOriginal only captures a
  // baseline if one isn't already set, so ordering here matters.
  await applyCachedSource(pendingEdits);
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
