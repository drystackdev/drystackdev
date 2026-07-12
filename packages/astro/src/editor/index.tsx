import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { KeystarProvider } from '@keystar/ui/core';
import { Toaster } from '@keystar/ui/toast';
import type { Config } from '@drystack/core';
import { Toolbar } from './Toolbar';
import {
  applyPendingEdits,
  discardEditsIfBuildIsNewer,
  subscribeToRemoteEdits,
} from './bind';
// Raw CSS string (Vite ?inline) — injected into the host page's <head> below.
import editorStyles from './editor.css?inline';

const ROOT_ID = 'drystack-editor-root';

function prefersDark() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

function EditorRoot({ config }: { config: Config<any, any> }) {
  const [scheme, setScheme] = useState<'light' | 'dark'>(
    prefersDark() ? 'dark' : 'light'
  );
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setScheme(mq.matches ? 'dark' : 'light');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return (
    <KeystarProvider colorScheme={scheme}>
      <Toolbar config={config} />
      <Toaster />
    </KeystarProvider>
  );
}

export async function mount(
  config: Config<any, any>,
  buildVersion?: number
): Promise<void> {
  if (document.getElementById(ROOT_ID)) return;

  await discardEditsIfBuildIsNewer(config, buildVersion);
  await applyPendingEdits();
  // Live-sync this page's DOM with edits published from the admin panel or
  // another visual-editor tab — kept active regardless of edit-mode state.
  subscribeToRemoteEdits();

  const style = document.createElement('style');
  style.textContent = editorStyles;
  document.head.appendChild(style);

  const host = document.createElement('div');
  host.id = ROOT_ID;
  document.body.appendChild(host);

  createRoot(host).render(<EditorRoot config={config} />);
}
