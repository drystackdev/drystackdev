import { useLocalizedStringFormatter } from '@react-aria/i18n';

import {
  Config,
  NAVIGATION_DIVIDER_KEY,
  REDIRECTS_SINGLETON_KEY,
} from '../config';

import l10nMessages from './l10n';
import { useAppState, useConfig } from './shell/context';
import { useChanged } from './shell/data';

type ItemData = {
  key: string;
  href: string;
  label: string;
  changed: number | boolean;
  entryCount?: number;
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

  const collectionKeys = Object.keys(config.collections || {});
  // the redirects singleton is reserved/system-owned — it never joins the
  // site's own collections/singletons grouping (default or custom), see the
  // comment on REDIRECTS_SINGLETON_KEY in config.tsx
  const singletonKeys = Object.keys(config.singletons || {}).filter(
    key => key !== REDIRECTS_SINGLETON_KEY
  );
  const items = config.ui?.navigation || {
    ...(!!collectionKeys.length && {
      [stringFormatter.format('collections')]: collectionKeys,
    }),
    ...(!!singletonKeys.length && {
      [stringFormatter.format('singletons')]: singletonKeys,
    }),
  };
  const options = { basePath, changeMap, config };

  const itemOrGroups: ItemOrGroup[] = Array.isArray(items)
    ? items.map(key => populateItemData(key, options))
    : Object.entries(items).map(([section, keys]) => ({
        title: section,
        children: keys.map(key => populateItemData(key, options)),
      }));

  // File management is a system-owned route (works the same in local and
  // github storage, see SidebarNav's old comment) rather than a
  // collection/singleton, so it's built by hand instead of going through
  // populateItemData.
  const systemChildren: Item[] = [
    { key: 'files', href: `${basePath}/files`, label: 'File management', changed: false },
  ];
  if (config.singletons && REDIRECTS_SINGLETON_KEY in config.singletons) {
    systemChildren.push(populateItemData(REDIRECTS_SINGLETON_KEY, options));
  }
  itemOrGroups.push({
    title: stringFormatter.format('system'),
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
  }
): Item {
  let { basePath, changeMap, config } = options;

  // divider
  if (key === NAVIGATION_DIVIDER_KEY) {
    return { isDivider: true };
  }

  // collection
  if (config.collections && key in config.collections) {
    const href = `${basePath}/collection/${encodeURIComponent(key)}`;
    const changes = changeMap.collections.get(key);
    const changed = changes
      ? changes.changed.size + changes.added.size + changes.removed.size
      : 0;

    const label = config.collections[key].label;

    return { key, href, label, changed, entryCount: changes?.totalCount };
  }

  // singleton
  if (config.singletons && key in config.singletons) {
    const href = `${basePath}/singleton/${encodeURIComponent(key)}`;
    const changed = changeMap.singletons.has(key);
    const label = config.singletons[key].label;

    return { key, href, label, changed };
  }

  throw new Error(`Unknown navigation key: "${key}".`);
}
