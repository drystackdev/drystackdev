import { Idiomorph } from 'idiomorph';
import { clearEdits } from './store';
import { resetOriginalValue } from './bind';

// Called once a build carrying this tab's edits has shipped. Swaps the live
// DOM for the freshly deployed HTML in place — no `location.reload()` — so
// the page doesn't flash/lose scroll position, then clears the edits that
// just shipped and re-baselines their diff origin against the new server
// value (so a follow-up edit to the same field diffs against what's actually
// live now, not against whatever was on screen before the shipped edit).
export async function refreshAfterDeploy(editedKeys: string[]): Promise<void> {
  const res = await fetch(location.pathname + location.search, {
    cache: 'reload',
  });
  if (!res.ok) return;
  const html = await res.text();
  const newDoc = new DOMParser().parseFromString(html, 'text/html');

  const editorRoot = document.getElementById('drystack-editor-root');
  editorRoot?.remove();

  Idiomorph.morph(document.body, newDoc.body, { morphStyle: 'innerHTML' });
  if (newDoc.title) document.title = newDoc.title;

  if (editorRoot) document.body.appendChild(editorRoot);

  await clearEdits();
  for (const key of editedKeys) {
    const el = document.querySelector<HTMLElement>(`[data-dry="${CSS.escape(key)}"]`);
    if (el) resetOriginalValue(key, el.textContent ?? '');
  }
}
