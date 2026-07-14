import { useMemo, type ReactNode } from 'react';
import { Provider as UrqlProvider } from 'urql';
import type { Config } from '../../config';
import { createUrqlClient } from '../provider';
import { RouterProvider } from '../router';
import { ConfigContext, AppStateContext } from '../shell/context';
import {
  GitHubAppShellDataProvider,
  GitHubAppShellProvider,
  LocalAppShellProvider,
} from '../shell/data';
import { isGitHubConfig, isLocalConfig } from '../utils';
import { FileManagerHost } from '../file-manager/FileManagerHost';

function ShellProviders({
  config,
  currentBranch,
  children,
}: {
  config: Config<any, any>;
  currentBranch: string;
  children: ReactNode;
}) {
  if (isGitHubConfig(config)) {
    return (
      <GitHubAppShellDataProvider config={config}>
        <GitHubAppShellProvider currentBranch={currentBranch} config={config}>
          {children}
        </GitHubAppShellProvider>
      </GitHubAppShellDataProvider>
    );
  }
  if (isLocalConfig(config)) {
    return <LocalAppShellProvider config={config}>{children}</LocalAppShellProvider>;
  }
  return null;
}

// Headless mount of the admin's media-library picker (FileManagerHost) for
// use outside the admin app — the visual editor on the live site (see
// packages/astro/src/editor/Toolbar.tsx) reuses this verbatim so a
// fields.image spot gets the exact same file-manager dialog, upload flow,
// and github-commit path as the admin's ImageFieldInput, instead of a
// second bespoke picker. Provides only the context that subtree actually
// needs — no sidebar, no routing UI, no KeystarProvider (the visual
// editor's own root already provides one; Keystar dialogs portal to <body>
// but stay in this React tree, so they still pick up that theme).
//
// `currentBranch` only matters in github mode — resolve it (getCurrentBranchName
// in editor/save.ts) before mounting this component; it's the same default
// branch the visual editor's Save commits to.
export function VeiMediaHost({
  config,
  basePath,
  currentBranch,
}: {
  config: Config<any, any>;
  basePath: string;
  currentBranch: string;
}) {
  const client = useMemo(() => createUrqlClient(config, basePath), [config, basePath]);
  return (
    <ConfigContext.Provider value={config}>
      <AppStateContext.Provider value={{ basePath }}>
        <RouterProvider basePath={basePath}>
          <UrqlProvider value={client}>
            <ShellProviders config={config} currentBranch={currentBranch}>
              <FileManagerHost />
            </ShellProviders>
          </UrqlProvider>
        </RouterProvider>
      </AppStateContext.Provider>
    </ConfigContext.Provider>
  );
}
