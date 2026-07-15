import React from 'react';
import { createRoot } from 'react-dom/client';
import type { Config } from '@drystack/core';
import { EditorRoot } from './EditorRoot';
import {
  applyPendingEdits,
  discardEditsIfBuildIsNewer,
  hydrateDryAttributesFromMap,
  subscribeToRemoteEdits,
} from './bind';
// Raw CSS string (Vite ?inline) — injected into the host page's <head> below.
import editorStyles from './editor.css?inline';

const ROOT_ID = 'drystack-editor-root';

// This file's only export is `mount` (not a component) — deliberately kept
// free of any component *definition* (EditorRoot lives in its own file). A
// .tsx file mixing a component export with a non-component one fails
// @vitejs/plugin-react's Fast Refresh boundary check on its very first
// evaluation, which invalidates the module; since it's reached only via a
// dynamic import() from an injected <script> rather than Vite's static import
// graph, there's no accepting boundary, so Vite falls back to a full page
// reload — which re-runs the injected script, re-imports this module, and
// re-triggers the same invalidate. That was an infinite reload loop that
// silently fought any in-progress edit (e.g. reset a contentEditable spot's
// caret every cycle). See EditorRoot.tsx for the longer explanation.
export async function mount(
  config: Config<any, any>,
  buildVersion?: number
): Promise<void> {
  if (document.getElementById(ROOT_ID)) return;

  // Must run first — discardEditsIfBuildIsNewer/applyPendingEdits below (and
  // every other DOM lookup in bind.ts) key off the real `data-dry` attribute,
  // which GitHub-mode production HTML doesn't carry until this patches it
  // back in. See bind.ts's hydrateDryAttributesFromMap for why. `false` means
  // the injected script's cheap cookie-presence check let a stale/invalid
  // GitHub session through — bail rather than mount a Toolbar with nothing
  // actually bound to edit.
  if (!(await hydrateDryAttributesFromMap(config))) return;

  await discardEditsIfBuildIsNewer(config, buildVersion);
  await applyPendingEdits();
  // Live-sync this page's DOM with edits published from the admin panel or
  // another visual-editor tab — kept active regardless of edit-mode state.
  subscribeToRemoteEdits(config);

  const style = document.createElement('style');
  style.textContent = editorStyles;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.body.appendChild(host);

  createRoot(host).render(<EditorRoot config={config} />);
}
