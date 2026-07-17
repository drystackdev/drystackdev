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
import { authExchange } from "@urql/exchange-auth";
import { getAuth, getSyncAuth } from "./auth";
import { GitHubAppShellQuery } from "./shell/data";
import { persistedExchange } from "@urql/exchange-persisted";
import { relayPagination } from "@urql/exchange-graphcache/extras";

import { Config } from "../config";
import { ThemeProvider, useTheme } from "./shell/theme";
import { parseRepoConfig } from "./repo-config";
import { useRouter } from "./router";

export function createUrqlClient(config: Config, basePath: string): Client {
  const repo =
    config.storage.kind === "github"
      ? parseRepoConfig(config.storage.repo)
      : { owner: "repo-owner", name: "repo-name" };
  return createClient({
    // urql's Client throws synchronously if `url` is falsy - local mode never
    // actually issues a GraphQL request (all local reads/writes go through
    // the REST /api/*/tree,blob,update endpoints), so this just needs to be
    // *some* non-empty string, not a real GraphQL endpoint.
    url:
      config.storage.kind === "github"
        ? "https://api.github.com/graphql"
        : "about:blank",
    requestPolicy: "cache-and-network",
    exchanges: [
      authExchange(async (utils) => {
        let authState = await getAuth(config, basePath);
        return {
          addAuthToOperation(operation) {
            authState = getSyncAuth(config);
            if (!authState) {
              return operation;
            }
            return utils.appendHeaders(operation, {
              Authorization: `Bearer ${authState.accessToken}`,
            });
          },
          didAuthError() {
            return false;
          },
          willAuthError(operation) {
            authState = getSyncAuth(config);
            if (
              "definitions" in operation.query &&
              operation.query.definitions[0]?.kind === "OperationDefinition" &&
              operation.query.definitions[0]?.name?.value.includes(
                "AppShell",
              ) &&
              !authState
            ) {
              if (config.storage.kind === "github") {
                window.location.href = `/api${basePath}/github/login`;
              }
              return true;
            }
            if (!authState) {
              return true;
            }
            return false;
          },
          async refreshAuth() {
            authState = await getAuth(config, basePath);
          },
        };
      }),
      cacheExchange({
        resolvers: {
          Repository: {
            refs: relayPagination(),
          },
        },
        updates: {
          Mutation: {
            createRef(result, args, cache, _info) {
              cache.updateQuery(
                {
                  query: GitHubAppShellQuery,
                  variables: repo,
                },
                (data) => {
                  if (
                    data?.repository?.refs?.nodes &&
                    result.createRef &&
                    typeof result.createRef === "object" &&
                    "ref" in result.createRef
                  ) {
                    return {
                      ...data,
                      repository: {
                        ...data.repository,
                        refs: {
                          ...data.repository.refs,
                          nodes: [
                            ...data.repository.refs.nodes,
                            result.createRef.ref,
                          ],
                        },
                      },
                    };
                  }
                  return data;
                },
              );
            },
            deleteRef(result, args, cache, _info) {
              cache.updateQuery(
                {
                  query: GitHubAppShellQuery,
                  variables: repo,
                },
                (data) => {
                  if (
                    data?.repository?.refs?.nodes &&
                    result.deleteRef &&
                    typeof result.deleteRef === "object" &&
                    "__typename" in result.deleteRef &&
                    typeof args.input === "object" &&
                    args.input !== null &&
                    "refId" in args.input &&
                    typeof args.input.refId === "string"
                  ) {
                    const refId = args.input.refId;
                    return {
                      ...data,
                      repository: {
                        ...data.repository,
                        refs: {
                          ...data.repository.refs,
                          nodes: data.repository.refs.nodes.filter(
                            (x) => x?.id !== refId,
                          ),
                        },
                      },
                    };
                  }
                  return data;
                },
              );
            },
          },
        },
      }),
      ...(config.storage.kind === "github"
        ? []
        : [
            persistedExchange({
              enableForMutation: true,
              enforcePersistedQueries: true,
            }),
          ]),
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
