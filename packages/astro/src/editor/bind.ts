import type { Config } from '@drystack/core';
import { getAllEdits, setEdit, clearEdits, getMeta, setMeta } from './store';

const BUILD_VERSION_KEY = 'buildVersion';

let editing = false;
let onChangeCallback: (() => void) | undefined;

function handleInput(e: Event) {
  const el = (e.target as HTMLElement)?.closest<HTMLElement>('[data-dry]');
  if (!el) return;
  const key = el.getAttribute('data-dry');
  if (!key) return;
  setEdit(key, el.textContent ?? '').then(() => onChangeCallback?.());
}

export function isEditing() {
  return editing;
}

export function enableEditing(onChange?: () => void) {
  editing = true;
  onChangeCallback = onChange;
  document.body.classList.add('editing');
  document.querySelectorAll<HTMLElement>('[data-dry]').forEach(el => {
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
    await clearEdits();
    await setMeta(BUILD_VERSION_KEY, buildVersion);
  }
}

// Applies edits saved in IndexedDB on top of the server-rendered DOM — runs
// on every page load (even before Edit mode is turned on) so an unsaved edit
// survives a reload, per plan.md's "chưa lưu thì reload phải lấy IndexDB".
export async function applyPendingEdits(): Promise<number> {
  const edits = await getAllEdits();
  for (const edit of edits) {
    const el = document.querySelector<HTMLElement>(
      `[data-dry="${CSS.escape(edit.key)}"]`
    );
    if (el) el.textContent = edit.value;
  }
  return edits.length;
}
