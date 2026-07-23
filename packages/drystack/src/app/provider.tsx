import {
  ClientSideOnlyDocumentElement,
  KeystarProvider,
} from "@keystar/ui/core";
import { injectGlobal } from "@keystar/ui/style";
import { Toaster } from "@keystar/ui/toast";
import { useMemo, type JSX } from "react";
import {
  Provider as UrqlProvider,
  createClient,
  fetchExchange,
  Client,
} from "urql";
import { cacheExchange } from "@urql/exchange-graphcache";
import { persistedExchange } from "@urql/exchange-persisted";

import { Config } from "../config";
import { ThemeProvider, useTheme } from "./shell/theme";
import { useRouter } from "./router";

// Nothing issues a real GraphQL query anymore (all reads/writes go through
// the REST /api/*/tree,blob,update endpoints) - this client exists only
// because `<KeystarProvider>`'s descendants expect a urql context to be
// present. `url` just needs to be *some* non-empty string (urql's Client
// throws synchronously if it's falsy), never a real endpoint.
export function createUrqlClient(_config: Config, _basePath: string): Client {
  return createClient({
    url: "about:blank",
    requestPolicy: "cache-and-network",
    exchanges: [
      cacheExchange({}),
      persistedExchange({
        enableForMutation: true,
        enforcePersistedQueries: true,
      }),
      fetchExchange,
    ],
  });
}

export default function Provider({
  children,
  config,
}: {
  children: JSX.Element;
  config: Config;
}) {
  // The admin shell fills the viewport and manages its own internal scrolling,
  // so lock body scroll. This MUST be scoped to the component (not a module-load
  // side effect): the Astro visual editor bundle transitively imports this
  // module on public pages, and a top-level injectGlobal would lock scroll on
  // the live site even though this Provider never mounts there. emotion dedupes
  // the insertion, so calling it during render is cheap and applies before paint.
  injectGlobal({ body: { overflow: "hidden" } });

  const themeContext = useTheme();
  const { push: navigate, basePath } = useRouter();
  const keystarRouter = useMemo(() => ({ navigate }), [navigate]);

  return (
    <ThemeProvider value={themeContext}>
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <KeystarProvider
        locale={config.locale || "en-US"}
        colorScheme={themeContext.theme}
        router={keystarRouter}
      >
        <ClientSideOnlyDocumentElement bodyBackground="surface" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
        <UrqlProvider
          value={useMemo(
            () => createUrqlClient(config, basePath),
            [config, basePath],
          )}
        >
          {children}
        </UrqlProvider>
        <Toaster />
      </KeystarProvider>
    </ThemeProvider>
  );
}
