import { ReactNode, useContext } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";

import { alertCircleIcon } from "@keystar/ui/icon/icons/alertCircleIcon";

import { Config } from "../../config";
import l10nMessages from "../l10n";

import { isGitHubConfig, isLocalShapedConfig } from "../utils";

import { AppStateContext, ConfigContext } from "./context";
import {
  GitHubAppShellProvider,
  AppShellErrorContext,
  LocalAppShellProvider,
  useBranches,
  useCurrentBranch,
  GitHubAppShellDataContext,
} from "./data";
import { SidebarProvider } from "./sidebar";
import { MainPanelLayout } from "./panels";
import { EmptyState } from "./empty-state";
import { FileManagerHost } from "../file-manager/FileManagerHost";
import { useBrandGuard } from "../brand";
import { AiModelProvider } from "../ai/useAiModels";
import { AiStatusProvider } from "../ai/useAiStatus";
import { AiConfigNotice } from "../ai/AiConfigNotice";

function BranchNotFound(props: { config: Config; children: ReactNode }) {
  const branches = useBranches();
  const currentBranch = useCurrentBranch();
  const appShellDataContext = useContext(GitHubAppShellDataContext);

  // self-heals a brand branch that vanished outside the app (deleted on
  // GitHub, or a fresh page load that never went through RedirectToBranch) -
  // see plan/brand.md §5/§16. No-ops for local mode and once in sync.
  useBrandGuard(props.config);

  if (
    appShellDataContext?.data?.repository?.refs?.pageInfo.hasNextPage ===
      false &&
    !branches.has(currentBranch)
  ) {
    // only reachable in github mode (GitHubAppShellDataContext is never
    // provided in local mode) - useBrandGuard is already recreating the
    // brand and will redirect shortly, so show a neutral loading state
    // rather than a dead-end error.
    return null;
  }
  return props.children;
}

export const AppShell = (props: {
  config: Config;
  children: ReactNode;
  currentBranch: string;
  basePath: string;
}) => {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const content = (
    <AppShellErrorContext.Consumer>
      {(error) =>
        error &&
        !error?.graphQLErrors.some(
          (err) => (err?.originalError as any)?.type === "NOT_FOUND",
        ) ? (
          <EmptyState
            icon={alertCircleIcon}
            title={stringFormatter.format("failedToLoadShell")}
            message={error.message}
          />
        ) : (
          props.children
        )
      }
    </AppShellErrorContext.Consumer>
  );

  const inner = (
    <ConfigContext.Provider value={props.config}>
      <AppStateContext.Provider value={{ basePath: props.basePath }}>
        <AiStatusProvider>
          <AiModelProvider>
            <AiConfigNotice />
            <SidebarProvider>
              <MainPanelLayout>
                <BranchNotFound config={props.config}>
                  {content}
                </BranchNotFound>
              </MainPanelLayout>
              <FileManagerHost />
            </SidebarProvider>
          </AiModelProvider>
        </AiStatusProvider>
      </AppStateContext.Provider>
    </ConfigContext.Provider>
  );

  if (isGitHubConfig(props.config)) {
    return (
      <GitHubAppShellProvider
        currentBranch={props.currentBranch}
        config={props.config}
      >
        {inner}
      </GitHubAppShellProvider>
    );
  }
  if (isLocalShapedConfig(props.config)) {
    return (
      <LocalAppShellProvider config={props.config}>
        {inner}
      </LocalAppShellProvider>
    );
  }
  return null;
};
