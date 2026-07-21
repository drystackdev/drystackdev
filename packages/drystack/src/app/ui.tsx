import {
  ReactElement,
  ReactNode,
  useContext,
  useEffect,
  useState,
  Fragment,
} from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";

import { Button } from "@keystar/ui/button";
import { Icon } from "@keystar/ui/icon";
import { fileX2Icon } from "@keystar/ui/icon/icons/fileX2Icon";
import { githubIcon } from "@keystar/ui/icon/icons/githubIcon";
import { Flex } from "@keystar/ui/layout";
import { Text } from "@keystar/ui/typography";

import { Config, GitHubConfig } from "../config";
import { CollectionPage } from "./CollectionPage";
import { CreateItem } from "./create-item";
import { DashboardPage } from "./dashboard";
import { ItemPage } from "./ItemPage";
import Provider from "./provider";
import { AppShell } from "./shell";
import { PageBody, PageRoot } from "./shell/page";
import { EmptyState } from "./shell/empty-state";
import { SingletonPage } from "./SingletonPage";
import { FileManagerPage } from "./file-manager/FileManagerPage";
import { UsersPage } from "./users/UsersPage";
import { ProfilePage } from "./users/ProfilePage";
import { CreateUserPage, EditUserPage } from "./users/UserDetailForm";
import { CreatedGitHubApp } from "./onboarding/created-github-app";
import { DrystackSetup } from "./onboarding/setup";
import { RepoNotFound } from "./onboarding/repo-not-found";
import { AppSlugProvider } from "./onboarding/install-app";
import { useRouter, RouterProvider } from "./router";
import { isGitHubConfig, isLocalShapedConfig } from "./utils";
import {
  GitHubAppShellDataContext,
  GitHubAppShellDataProvider,
} from "./shell/data";
import { getAuth } from "./auth";
import { assertValidRepoConfig } from "./repo-config";
import { NotFoundBoundary, notFound } from "./not-found";
import { BrandProvider, useEnsureBrandAtRoot } from "./brand";
import l10nMessages from "./l10n";

function parseParamsWithoutBranch(params: string[]) {
  if (params.length === 0) {
    return {};
  }
  if (params.length === 1 && params[0] === "files") {
    return { page: "files" as const };
  }
  if (params.length === 1 && params[0] === "users") {
    return { page: "users" as const };
  }
  if (params.length === 2 && params[0] === "users" && params[1] === "create") {
    return { page: "users-create" as const };
  }
  if (params.length === 3 && params[0] === "users" && params[1] === "item") {
    return { page: "users-edit" as const, email: params[2] };
  }
  if (params.length === 1 && params[0] === "profile") {
    return { page: "profile" as const };
  }
  if (params.length === 2 && params[0] === "singleton") {
    return { singleton: params[1] };
  }
  if (params.length < 2 || params[0] !== "collection") return null;
  const collection = params[1];
  if (params.length === 2) {
    return { collection };
  }
  if (params.length === 3 && params[2] === "create") {
    return { collection, kind: "create" as const };
  }
  if (params.length === 4 && params[2] === "item") {
    const slug = params[3];
    return { collection, kind: "edit" as const, slug };
  }
  return null;
}

function RedirectToBranch(props: { config: GitHubConfig }) {
  const { basePath } = useRouter();
  const apiBasePath = `/api${basePath}`;
  const { data, error } = useContext(GitHubAppShellDataContext)!;

  // navigates to the editor's personal brand (creating it off the default
  // branch on first visit, or reusing it if one already exists) - see brand.ts
  useEnsureBrandAtRoot(props.config);

  useEffect(() => {
    if (error?.response?.status === 401) {
      window.location.href = `${apiBasePath}/github/login`;
    }
    if (
      (!data?.repository?.id &&
        (error?.graphQLErrors?.[0]?.originalError as any)?.type ===
          "NOT_FOUND") ||
      (error?.graphQLErrors?.[0]?.originalError as any)?.type === "FORBIDDEN"
    ) {
      window.location.href = `${apiBasePath}/github/repo-not-found`;
    }
  }, [data, error, props.config, apiBasePath]);
  return null;
}

function PageInner({ config }: { config: Config }) {
  const { params, basePath: rootPath } = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  let branch = null,
    parsedParams,
    basePath: string;
  let wrapper: (element: ReactElement) => ReactElement = (x) => x;
  if (isGitHubConfig(config)) {
    wrapper = (element) => (
      <AuthWrapper config={config}>
        <GitHubAppShellDataProvider config={config}>
          {/* stable position across the RedirectToBranch <-> AppShell swap
          below, so the brand created/adopted in one persists into the other */}
          <BrandProvider>{element}</BrandProvider>
        </GitHubAppShellDataProvider>
      </AuthWrapper>
    );
    if (params.length === 0) {
      return wrapper(<RedirectToBranch config={config} />);
    }
    if (params.length === 1 && isGitHubConfig(config)) {
      if (params[0] === "setup") return <DrystackSetup config={config} />;
      if (params[0] === "repo-not-found") {
        return <RepoNotFound config={config} />;
      }
      if (params[0] === "created-github-app") {
        return <CreatedGitHubApp config={config} />;
      }
    }
    if (params[0] !== "branch" || params.length < 2) {
      return <Text>{stringFormatter.format("notFoundLabel")}</Text>;
    }
    branch = params[1];
    basePath = `${rootPath}/branch/${encodeURIComponent(branch)}`;
    parsedParams = parseParamsWithoutBranch(params.slice(2));
  } else {
    parsedParams = parseParamsWithoutBranch(params);
    basePath = rootPath;
  }
  return wrapper(
    <AppShell config={config} currentBranch={branch || ""} basePath={basePath}>
      <NotFoundBoundary
        fallback={
          <PageRoot>
            <PageBody>
              <EmptyState
                icon={fileX2Icon}
                title={stringFormatter.format("notFoundLabel")}
                message={stringFormatter.format("pageNotFoundMessage")}
              />
            </PageBody>
          </PageRoot>
        }
      >
        {parsedParams === null ? (
          <AlwaysNotFound />
        ) : parsedParams.collection ? (
          parsedParams.kind === "create" ? (
            <CreateItem
              key={parsedParams.collection}
              collection={parsedParams.collection}
              config={config}
              basePath={basePath}
            />
          ) : parsedParams.kind === "edit" ? (
            <ItemPage
              key={parsedParams.collection}
              collection={parsedParams.collection}
              basePath={basePath}
              config={config}
              itemSlug={parsedParams.slug}
            />
          ) : (
            <CollectionPage
              key={parsedParams.collection}
              basePath={basePath}
              collection={parsedParams.collection}
              config={config as unknown as Config}
            />
          )
        ) : parsedParams.singleton ? (
          <SingletonPage
            key={parsedParams.singleton}
            config={config as unknown as Config}
            singleton={parsedParams.singleton}
          />
        ) : parsedParams.page === "files" ? (
          <FileManagerPage />
        ) : parsedParams.page === "users" ? (
          <UsersPage />
        ) : parsedParams.page === "users-create" ? (
          <CreateUserPage />
        ) : parsedParams.page === "users-edit" ? (
          <EditUserPage key={parsedParams.email} email={parsedParams.email} />
        ) : parsedParams.page === "profile" ? (
          <ProfilePage />
        ) : (
          <DashboardPage
            config={config as unknown as Config}
            basePath={basePath}
          />
        )}
      </NotFoundBoundary>
    </AppShell>,
  );
}

function AlwaysNotFound(): never {
  notFound();
}

function AuthWrapper(props: { config: GitHubConfig; children: ReactElement }) {
  const [state, setState] = useState<"unknown" | "valid" | "explicit-auth">(
    "unknown",
  );
  const router = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  useEffect(() => {
    getAuth(props.config, router.basePath).then((auth) => {
      if (auth) {
        setState("valid");
        return;
      }
      setState("explicit-auth");
    });
  }, [props.config, router.basePath]);
  if (state === "valid") {
    return props.children;
  }
  if (state === "explicit-auth") {
    return (
      <Flex justifyContent="center" alignItems="center" height="100vh">
        <Button
          href={`/api${router.basePath}/github/login${
            router.params.length
              ? `?${new URLSearchParams({
                  from: router.params.map(encodeURIComponent).join("/"),
                })}`
              : ""
          }`}
          // even though we'll never be in an iframe, so this isn't really distinct from _self
          // it makes react-aria avoid using client-side routing which we need here
          target="_top"
        >
          <Icon src={githubIcon} />
          <Text>{stringFormatter.format("loginWithGithubAction")}</Text>
        </Button>
      </Flex>
    );
  }
  return null;
}

/**
 * Use loopback instead of localhost to follow OAuth best practices.
 * Learn more: https://datatracker.ietf.org/doc/html/rfc8252#section-8.3
 */
function RedirectToLoopback(props: { children: ReactNode }) {
  useEffect(() => {
    if (window.location.hostname === "localhost") {
      window.location.href = window.location.href.replace(
        "localhost",
        "127.0.0.1",
      );
    }
  }, []);
  if (window.location.hostname === "localhost") {
    return null;
  }
  return props.children;
}

export function Drystack(props: {
  config: Config;
  appSlug?: { envName: string; value: string | undefined };
  basePath?: string;
}) {
  if (props.config.storage.kind === "github") {
    assertValidRepoConfig(props.config.storage.repo);
  }

  // The loopback redirect is only needed if the storage uses OAuth callbacks.
  const Wrapper = isLocalShapedConfig(props.config)
    ? Fragment
    : RedirectToLoopback;

  return (
    <ClientOnly>
      <Wrapper>
        <AppSlugProvider value={props.appSlug}>
          <RouterProvider basePath={props.basePath ?? "/drystack"}>
            <Provider config={props.config}>
              <PageInner config={props.config} />
            </Provider>
          </RouterProvider>
        </AppSlugProvider>
      </Wrapper>
    </ClientOnly>
  );
}

function ClientOnly(props: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  if (!mounted) return null;
  return props.children;
}
