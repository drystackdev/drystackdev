import { ReactNode, useEffect, useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";

import { fileX2Icon } from "@keystar/ui/icon/icons/fileX2Icon";
import { Text } from "@keystar/ui/typography";

import { Config } from "../config";
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
import { ProfilePage } from "./user-management/ProfilePage";
import { UsersPage } from "./user-management/UsersPage";
import { AddUserPage } from "./user-management/AddUserPage";
import { RolesPage } from "./user-management/RolesPage";
import { RolePermissionsPage } from "./user-management/RolePermissionsPage";
import { useRouter, RouterProvider } from "./router";
import { NotFoundBoundary, notFound } from "./not-found";
import l10nMessages from "./l10n";

function parseParamsWithoutBranch(params: string[]) {
  if (params.length === 0) {
    return {};
  }
  if (params.length === 1 && params[0] === "files") {
    return { page: "files" as const };
  }
  if (params.length === 1 && params[0] === "profile") {
    return { page: "profile" as const };
  }
  if (params.length === 1 && params[0] === "users") {
    return { page: "users" as const };
  }
  if (params.length === 2 && params[0] === "users" && params[1] === "add") {
    return { page: "users-add" as const };
  }
  if (params.length === 1 && params[0] === "roles") {
    return { page: "roles" as const };
  }
  if (
    params.length === 3 &&
    params[0] === "roles" &&
    params[2] === "permissions"
  ) {
    return { page: "role-permissions" as const, roleId: params[1] };
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

function PageInner({ config }: { config: Config }) {
  const { params, basePath } = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const parsedParams = parseParamsWithoutBranch(params);
  return (
    <AppShell config={config} currentBranch="" basePath={basePath}>
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
        ) : parsedParams.page === "profile" ? (
          <ProfilePage />
        ) : parsedParams.page === "users" ? (
          <UsersPage />
        ) : parsedParams.page === "users-add" ? (
          <AddUserPage />
        ) : parsedParams.page === "roles" ? (
          <RolesPage />
        ) : parsedParams.page === "role-permissions" ? (
          <RolePermissionsPage roleId={parsedParams.roleId} />
        ) : (
          <DashboardPage
            config={config as unknown as Config}
            basePath={basePath}
          />
        )}
      </NotFoundBoundary>
    </AppShell>
  );
}

function AlwaysNotFound(): never {
  notFound();
}

export function Drystack(props: { config: Config; basePath?: string }) {
  return (
    <ClientOnly>
      <RouterProvider basePath={props.basePath ?? "/drystack"}>
        <Provider config={props.config}>
          <PageInner config={props.config} />
        </Provider>
      </RouterProvider>
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
