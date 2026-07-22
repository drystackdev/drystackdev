import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ReactElement, useMemo } from "react";

import { folderIcon } from "@keystar/ui/icon/icons/folderIcon";
import { signpostIcon } from "@keystar/ui/icon/icons/signpostIcon";
import { usersIcon } from "@keystar/ui/icon/icons/usersIcon";
import { shieldIcon } from "@keystar/ui/icon/icons/shieldIcon";

import {
  Config,
  NAVIGATION_DIVIDER_KEY,
  REDIRECTS_SINGLETON_KEY,
} from "../config";

import l10nMessages from "./l10n";
import { useAppState, useConfig } from "./shell/context";
import { useChanged } from "./shell/data";
import { useDraftKeys } from "./persistence";
import { isR2Config } from "./storage-mode";
import { hasNativePermission, useNativeUser } from "./native-user";

type ItemData = {
  key: string;
  href: string;
  label: string;
  changed: number | boolean;
  entryCount?: number;
  // Only ever set for the 3 fixed System items below - a site's own
  // collections/singletons have no config knob for one (see useNavItems'
  // System section comment).
  icon?: ReactElement;
  children?: undefined;
  isDivider?: undefined;
};
export type ItemDivider = {
  key?: undefined;
  children?: undefined;
  isDivider: true;
};
export type Item = ItemData | ItemDivider;
export type ItemOrGroup =
  | Item
  | {
      key?: undefined;
      isDivider?: undefined;
      title: string;
      children: Item[];
    };

export function useNavItems(): ItemOrGroup[] {
  let { basePath } = useAppState();
  let config = useConfig();
  let stringFormatter = useLocalizedStringFormatter(l10nMessages);
  let changeMap = useChanged();
  let draftKeys = useDraftKeys();
  let draftsByCollection = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const key of draftKeys) {
      if (key[0] !== "collection") continue;
      const [, collection, slug] = key;
      if (!map.has(collection)) map.set(collection, new Set());
      map.get(collection)!.add(slug);
    }
    return map;
  }, [draftKeys]);
  let draftSingletons = useMemo(
    () =>
      new Set(
        draftKeys.flatMap((key) => (key[0] === "singleton" ? [key[1]] : [])),
      ),
    [draftKeys],
  );

  const collectionKeys = Object.keys(config.collections || {});
  // the redirects singleton is reserved/system-owned - it never joins the
  // site's own collections/singletons grouping (default or custom), see the
  // comment on REDIRECTS_SINGLETON_KEY in config.tsx
  const singletonKeys = Object.keys(config.singletons || {}).filter(
    (key) => key !== REDIRECTS_SINGLETON_KEY,
  );
  const items = config.ui?.navigation || {
    ...(!!collectionKeys.length && {
      [stringFormatter.format("collections")]: collectionKeys,
    }),
    ...(!!singletonKeys.length && {
      [stringFormatter.format("singletons")]: singletonKeys,
    }),
  };
  const options = {
    basePath,
    changeMap,
    config,
    draftsByCollection,
    draftSingletons,
  };

  // r2 mode only (plan/user-managent.md mục 6): a collection/singleton whose
  // role(s) lack `view` doesn't show up in nav at all - not just "click
  // through and get blocked". Applied uniformly whether the site uses the
  // default collections/singletons grouping above or its own
  // `config.ui.navigation` (custom groups can name collection/singleton keys
  // too). This is UX only, mirroring but not replacing the real 403 the
  // server already enforces on tree/blob (api-r2.ts) for the same case -
  // someone could still hit the URL directly and get denied there. While the
  // one-shot `auth/me` fetch is still in flight (`nativeUser === undefined`),
  // everything stays visible rather than flashing empty - it's corrected
  // within one round-trip, and the page itself is already gated server-side
  // before the shell ever renders.
  const nativeUser = useNativeUser();
  const filterByViewPermission = isR2Config(config) && nativeUser != null;
  const keyIsViewable = (key: string) => {
    if (!filterByViewPermission) return true;
    if (config.collections && key in config.collections) {
      return hasNativePermission(nativeUser, `collection:${key}.view`);
    }
    if (config.singletons && key in config.singletons) {
      return hasNativePermission(nativeUser, `singleton:${key}.view`);
    }
    return true;
  };

  const itemOrGroups: ItemOrGroup[] = Array.isArray(items)
    ? items
        .filter(keyIsViewable)
        .map((key) => populateItemData(key, options))
    : Object.entries(items)
        .map(([section, keys]) => ({
          title: section,
          children: keys
            .filter(keyIsViewable)
            .map((key) => populateItemData(key, options)),
        }))
        .filter((group) => group.children.length > 0);

  // File management is a system-owned route (works the same in local and
  // github storage, see SidebarNav's old comment) rather than a
  // collection/singleton, so it's built by hand instead of going through
  // populateItemData.
  const systemChildren: Item[] = [
    {
      key: "files",
      href: `${basePath}/files`,
      label: stringFormatter.format("fileManagement"),
      changed: false,
      icon: folderIcon,
    },
  ];
  if (config.singletons && REDIRECTS_SINGLETON_KEY in config.singletons) {
    const redirectsItem = populateItemData(REDIRECTS_SINGLETON_KEY, options);
    systemChildren.push(
      redirectsItem.isDivider
        ? redirectsItem
        : { ...redirectsItem, icon: signpostIcon }
    );
  }
  // User/Role management (plan/user-managent.md mục 0/6): r2-only, and only
  // for a session with fullAccess (SuperAdmin/Admin) - a bare Editor-shaped
  // role has no business here. `nativeUser == null` covers both "still
  // loading" and "not r2 mode at all" (no NativeUserProvider mounted then),
  // so both stay hidden until proven otherwise rather than flashing on.
  if (isR2Config(config) && nativeUser?.fullAccess) {
    systemChildren.push(
      {
        key: "users",
        href: `${basePath}/users`,
        label: stringFormatter.format("userManagementNavItem"),
        changed: false,
        icon: usersIcon,
      },
      {
        key: "roles",
        href: `${basePath}/roles`,
        label: stringFormatter.format("roleManagementNavItem"),
        changed: false,
        icon: shieldIcon,
      },
    );
  }
  itemOrGroups.push({
    title: stringFormatter.format("system"),
    children: systemChildren,
  });

  return itemOrGroups;
}

function populateItemData(
  key: string,
  options: {
    basePath: string;
    changeMap: ReturnType<typeof useChanged>;
    config: Config;
    draftsByCollection: Map<string, Set<string>>;
    draftSingletons: Set<string>;
  },
): Item {
  let { basePath, changeMap, config, draftsByCollection, draftSingletons } =
    options;

  // divider
  if (key === NAVIGATION_DIVIDER_KEY) {
    return { isDivider: true };
  }

  // collection
  if (config.collections && key in config.collections) {
    const href = `${basePath}/collection/${encodeURIComponent(key)}`;
    const changes = changeMap.collections.get(key);
    const changedSlugs = new Set([
      ...(changes ? changes.changed : []),
      ...(changes ? changes.added : []),
      ...(changes ? changes.removed : []),
      ...(draftsByCollection.get(key) ?? []),
    ]);
    const changed = changedSlugs.size;

    const label = config.collections[key].label;

    return { key, href, label, changed, entryCount: changes?.totalCount };
  }

  // singleton
  if (config.singletons && key in config.singletons) {
    const href = `${basePath}/singleton/${encodeURIComponent(key)}`;
    const changed = changeMap.singletons.has(key) || draftSingletons.has(key);
    const label = config.singletons[key].label;

    return { key, href, label, changed };
  }

  throw new Error(`Unknown navigation key: "${key}".`);
}
