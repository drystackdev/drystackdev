import { useMemo, type ReactNode } from "react";
import { Provider as UrqlProvider } from "urql";
import type { Config } from "../../config";
import { createUrqlClient } from "../provider";
import { RouterProvider } from "../router";
import { ConfigContext, AppStateContext } from "../shell/context";
import {
  GitHubAppShellDataProvider,
  GitHubAppShellProvider,
  LocalAppShellProvider,
} from "../shell/data";
import { isGitHubConfig, isLocalShapedConfig } from "../utils";
import { FileManagerHost } from "../file-manager/FileManagerHost";

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
  if (isLocalShapedConfig(config)) {
    return (
      <LocalAppShellProvider config={config}>{children}</LocalAppShellProvider>
    );
  }
  return null;
}

// The provider stack needed to mount real admin surfaces (FileManagerHost,
// but also - see packages/astro/src/editor/Toolbar.tsx - the admin's own
// field editors like ImageFieldInput/FileFieldInput/ArrayFieldInput) outside
// the admin app itself: the visual editor on the live site. Provides only the
// context that subtree actually needs - no sidebar, no routing UI, no
// KeystarProvider (the mounting root already provides one; Keystar dialogs
// portal to <body> but stay in this React tree, so they still pick up that
// theme).
//
// `currentBranch` only matters in github mode - resolve it (getCurrentBranchName
// in editor/save.ts) before mounting this component; it's the same default
// branch the visual editor's Save commits to.
export function VeiAdminProviders({
  config,
  basePath,
  currentBranch,
  children,
}: {
  config: Config<any, any>;
  basePath: string;
  currentBranch: string;
  children: ReactNode;
}) {
  const client = useMemo(
    () => createUrqlClient(config, basePath),
    [config, basePath],
  );
  return (
    <ConfigContext.Provider value={config}>
      <AppStateContext.Provider value={{ basePath }}>
        <RouterProvider basePath={basePath}>
          <UrqlProvider value={client}>
            <ShellProviders config={config} currentBranch={currentBranch}>
              {children}
            </ShellProviders>
          </UrqlProvider>
        </RouterProvider>
      </AppStateContext.Provider>
    </ConfigContext.Provider>
  );
}

// Headless mount of the admin's media-library picker (FileManagerHost) via
// VeiAdminProviders - a convenience export for a caller that only needs the
// picker and nothing else (see VeiAdminProviders' own doc comment for why
// this stack is safe to mount outside the admin app).
export function VeiMediaHost({
  config,
  basePath,
  currentBranch,
}: {
  config: Config<any, any>;
  basePath: string;
  currentBranch: string;
}) {
  return (
    <VeiAdminProviders
      config={config}
      basePath={basePath}
      currentBranch={currentBranch}
    >
      <FileManagerHost />
    </VeiAdminProviders>
  );
}
