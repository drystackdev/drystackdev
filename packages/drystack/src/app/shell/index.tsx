import { ReactNode } from "react";

import { Config } from "../../config";

import { isR2Config } from "../utils";

import { AppStateContext, ConfigContext } from "./context";
import { LocalAppShellProvider } from "./data";
import { NativeUserProvider } from "../native-user";
import { SidebarProvider } from "./sidebar";
import { MainPanelLayout } from "./panels";
import { FileManagerHost } from "../file-manager/FileManagerHost";
import { ContentRefPickerHost } from "../content-ref/ContentRefPickerHost";
import { AiModelProvider } from "../ai/useAiModels";
import { AiStatusProvider } from "../ai/useAiStatus";
import { AiConfigNotice } from "../ai/AiConfigNotice";

export const AppShell = (props: {
  config: Config;
  children: ReactNode;
  currentBranch: string;
  basePath: string;
}) => {
  const inner = (
    <ConfigContext.Provider value={props.config}>
      <AppStateContext.Provider value={{ basePath: props.basePath }}>
        <AiStatusProvider>
          <AiModelProvider>
            <AiConfigNotice />
            <SidebarProvider>
              <MainPanelLayout>{props.children}</MainPanelLayout>
              <FileManagerHost />
              <ContentRefPickerHost />
            </SidebarProvider>
          </AiModelProvider>
        </AiStatusProvider>
      </AppStateContext.Provider>
    </ConfigContext.Provider>
  );

  const provider = (
    <LocalAppShellProvider config={props.config}>
      {inner}
    </LocalAppShellProvider>
  );
  // r2 is the one storage kind with a real signed-in identity - see
  // native-user.tsx.
  return isR2Config(props.config) ? (
    <NativeUserProvider config={props.config}>{provider}</NativeUserProvider>
  ) : (
    provider
  );
};
