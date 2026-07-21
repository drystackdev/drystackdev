import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ReactElement, useMemo } from "react";

import { folderIcon } from "@keystar/ui/icon/icons/folderIcon";
import { signpostIcon } from "@keystar/ui/icon/icons/signpostIcon";

import {
  Config,
  NAVIGATION_DIVIDER_KEY,
  REDIRECTS_SINGLETON_KEY,
} from "../config";

import l10nMessages from "./l10n";
import { useAppState, useConfig } from "./shell/context";
import { useChanged } from "./shell/data";
import { useDraftKeys } from "./persistence";

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

  const itemOrGroups: ItemOrGroup[] = Array.isArray(items)
    ? items.map((key) => populateItemData(key, options))
    : Object.entries(items).map(([section, keys]) => ({
        title: section,
        children: keys.map((key) => populateItemData(key, options)),
      }));

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
