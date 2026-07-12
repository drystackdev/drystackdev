import type { Config } from '@drystack/core';
import {
  getAllEdits,
  publishEdit,
  publishClear,
  getMeta,
  setMeta,
  subscribeEdits,
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

function handleInput(e: Event) {
  const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-dry]');
  if (!el) return;
  const key = el.getAttribute('data-dry');
  if (!key) return;
  publishEdit(key, el.textContent ?? '').then(() => onChangeCallback?.());
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
    // No pending edit was painted here, so the current text is the on-disk
    // value — safe to snapshot now as the diff baseline.
    if (key) rememberOriginal(key, el.textContent ?? '');
    el.contentEditable = 'plaintext-only';
    // Firefox versions without plaintext-only support silently ignore it.
    if (el.contentEditable !== 'plaintext-only') el.contentEditable = 'true';
  });
  document.addEventListener('input', handleInput, true);
}

export function disableEditing() {
  editing = false;
  document.body.classList.remove('editing');
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    el.removeAttribute('contenteditable');
  });
  document.removeEventListener('input', handleInput, true);
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
    await setMeta(BUILD_VERSION_KEY, buildVersion);
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
          resetOriginalValue(key, value);
          el.textContent = value;
        });
    })
  );
}

// Discards every pending edit: restores each on-page field to its captured
// baseline (kept accurate by refreshFromLatestSource/applyPendingEdits) and
// clears the IndexedDB edit log — no network fetch needed.
export async function resetPendingEdits(): Promise<void> {
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
    const key = el.getAttribute('data-dry');
    const original = key ? getOriginalValue(key) : undefined;
    if (original !== undefined) el.textContent = original;
  });
  await publishClear();
}

// Paints one pending edit onto every DOM element carrying its key — a field
// can be rendered more than once on a page (e.g. a site title in both the
// header and footer), so every matching element must get it, not just the
// first in document order. Shared by the bulk on-load apply below and the
// live cross-tab subscription, which paints one key at a time as edits
// arrive from other tabs.
function applyEdit(key: string, value: string): void {
  const els = document.querySelectorAll<HTMLElement>(
    `[data-dry="${CSS.escape(key)}"]`
  );
  els.forEach(el => {
    // Capture the on-disk value before overwriting it with the pending edit.
    rememberOriginal(key, el.textContent ?? '');
    el.textContent = value;
  });
}

// Repaints every element for `key` back to its captured baseline — used when
// a remote tab deletes/clears an edit this page had already painted.
function restoreOriginal(key: string): void {
  const original = getOriginalValue(key);
  if (original === undefined) return;
  document
    .querySelectorAll<HTMLElement>(`[data-dry="${CSS.escape(key)}"]`)
    .forEach(el => {
      el.textContent = original;
    });
}

// Applies edits saved in IndexedDB on top of the server-rendered DOM — runs
// on every page load (even before Edit mode is turned on) so an unsaved edit
// survives a reload, per plan.md's "chưa lưu thì reload phải lấy IndexDB".
export async function applyPendingEdits(): Promise<number> {
  const edits = await getAllEdits();
  for (const edit of edits) applyEdit(edit.key, edit.value);
  return edits.length;
}

// Keeps this page's DOM live-synced with edits published from other tabs
// (admin or another visual-editor tab) — not just on load, per plan.md's
// cross-tab requirement. Returns an unsubscribe function; the editor mounts
// once per page load and is never torn down, so callers are free to ignore it.
export function subscribeToRemoteEdits(
  onChange?: () => void
): () => void {
  return subscribeEdits((msg: EditBusMessage) => {
    if (msg.type === 'set') {
      applyEdit(msg.key, msg.value);
    } else if (msg.type === 'delete') {
      restoreOriginal(msg.key);
    } else {
      document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
        const key = el.getAttribute('data-dry');
        if (key) restoreOriginal(key);
      });
    }
    onChange?.();
  });
}
