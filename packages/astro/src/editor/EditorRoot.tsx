import React, { useEffect, useState } from 'react';
import { KeystarProvider } from '@keystar/ui/core';
import { Toaster } from '@keystar/ui/toast';
import type { Config } from '@drystack/core';
import { Toolbar } from './Toolbar';

// Mirrors the admin app's theme picker, which persists the choice to
// localStorage under this key as 'auto' | 'light' | 'dark'
// (packages/drystack/src/app/shell/theme.tsx). The editor is a separate React
// tree on a separate (live-site) tab, so reading this key + listening for
// `storage` events keeps its Keystar theme in sync with the admin in realtime,
// resolving 'auto' against the OS preference.
const THEME_STORAGE_KEY = 'drystack-color-scheme';

function readStoredScheme(): 'auto' | 'light' | 'dark' {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch {
    // localStorage can throw (e.g. blocked cookies) — fall back to auto.
  }
  return 'auto';
}

function prefersDark() {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-color-scheme: dark)').matches
  );
}

function resolveScheme(stored: 'auto' | 'light' | 'dark'): 'light' | 'dark' {
  if (stored === 'auto') return prefersDark() ? 'dark' : 'light';
  return stored;
}

// Kept in its own file — separate from index.tsx's `mount` export — so this
// is the only thing that file exports. A .tsx file mixing a component export
// with a non-component one (like `mount`) fails @vitejs/plugin-react's
// Fast Refresh boundary check on its very first evaluation (not just on
// edits), which invalidates the module and, since it's reached only via a
// dynamic import() from an injected <script> rather than Vite's static import
// graph, has no accepting boundary — so Vite falls back to a full page
// reload. That reload re-runs the injected script, which re-imports this
// module, re-triggering the same invalidate: an infinite reload loop that
// silently fights any in-progress edit (e.g. resets a contentEditable spot's
// caret on every cycle).
export function EditorRoot({ config }: { config: Config<any, any> }) {
  const [scheme, setScheme] = useState<'light' | 'dark'>(() =>
    resolveScheme(readStoredScheme())
  );
  useEffect(() => {
    const recompute = () => setScheme(resolveScheme(readStoredScheme()));
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    // `storage` fires in this (live-site) tab when the admin tab changes the
    // theme; the matchMedia change keeps 'auto' honest as the OS flips.
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === THEME_STORAGE_KEY) recompute();
    };
    window.addEventListener('storage', onStorage);
    mq.addEventListener('change', recompute);
    return () => {
      window.removeEventListener('storage', onStorage);
      mq.removeEventListener('change', recompute);
    };
  }, []);
  return (
    <KeystarProvider colorScheme={scheme}>
      <Toolbar config={config} />
      <Toaster />
    </KeystarProvider>
  );
}
