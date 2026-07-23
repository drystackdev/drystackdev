import { isDefined } from 'emery';

import { Config } from '../config';
import { ComponentSchema } from '..';
import {
  getCollectionFormat,
  getCollectionItemPath,
  getCollectionItemSlugSuffix,
  getCollectionPath,
  getDataFileExtension,
  getSlugGlobForCollection,
} from './path-utils';
import { collectDirectoriesUsedInSchema, getTreeKey } from './tree-key';
import { getTreeNodeAtPath, TreeNode } from './trees';
import { object } from '../form/fields/object';
import { useEffect } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { showDraftRestoredToast } from './persistence';
import { useEffectEvent } from '@react-aria/utils';
import l10nMessages from './l10n';

export * from './path-utils';

export function getCollection(config: Config, collection: string) {
  return config.collections![collection];
}

export function arrayOf<T>(arr: readonly (T | null)[]): T[] {
  return arr.filter(isDefined);
}
export function keyedEntries<T extends Record<string, any>>(
  obj: T
): ({ key: string } & T[keyof T])[] {
  return Object.entries(obj).map(([key, value]) => ({ key, ...value }));
}

export type MaybePromise<T> = T | Promise<T>;

export * from './storage-mode';

export function getSlugFromState(
  collectionConfig: {
    slugField: string;
    schema: Record<string, ComponentSchema>;
  },
  state: Record<string, unknown>
) {
  const value = state[collectionConfig.slugField];
  const field = collectionConfig.schema[collectionConfig.slugField];
  if (field.kind !== 'form' || field.formKind !== 'slug') {
    throw new Error(`slugField is not a slug field`);
  }
  return field.serializeWithSlug(value).slug;
}

export function getEntriesInCollectionWithTreeKey(
  config: Config,
  collection: string,
  rootTree: Map<string, TreeNode>
): { key: string; slug: string; sha: string }[] {
  const collectionConfig = config.collections![collection];
  const schema = object(collectionConfig.schema);
  const formatInfo = getCollectionFormat(config, collection);
  const extension = getDataFileExtension(formatInfo);
  const glob = getSlugGlobForCollection(config, collection);
  const collectionPath = getCollectionPath(config, collection);
  const directory: Map<string, TreeNode> =
    getTreeNodeAtPath(rootTree, collectionPath)?.children ?? new Map();
  const entries: { key: string; slug: string; sha: string }[] = [];
  const directoriesUsedInSchema = [...collectDirectoriesUsedInSchema(schema)];
  const suffix = getCollectionItemSlugSuffix(config, collection);
  const possibleEntries = new Map(directory);
  if (glob === '**') {
    const handleDirectory = (dir: Map<string, TreeNode>, prefix: string) => {
      for (const [key, entry] of dir) {
        if (entry.children) {
          possibleEntries.set(`${prefix}${key}`, entry);
          handleDirectory(entry.children, `${prefix}${key}/`);
        } else {
          possibleEntries.set(`${prefix}${key}`, entry);
        }
      }
    };
    handleDirectory(directory, '');
  }
  for (const [key, entry] of possibleEntries) {
    if (formatInfo.dataLocation === 'index') {
      const actualEntry = getTreeNodeAtPath(
        rootTree,
        getCollectionItemPath(config, collection, key)
      );
      if (!actualEntry?.children?.has('index' + extension)) continue;
      entries.push({
        key: getTreeKey(
          [
            actualEntry.entry.path,
            ...directoriesUsedInSchema.map(x => `${x}/${key}`),
          ],
          rootTree
        ),
        slug: key,
        sha: actualEntry.children.get('index' + extension)!.entry.sha,
      });
    } else {
      if (suffix) {
        const newEntry = getTreeNodeAtPath(
          rootTree,
          getCollectionItemPath(config, collection, key) + extension
        );
        if (!newEntry || newEntry.children) continue;
        entries.push({
          key: getTreeKey(
            [
              entry.entry.path,
              getCollectionItemPath(config, collection, key),
              ...directoriesUsedInSchema.map(x => `${x}/${key}`),
            ],
            rootTree
          ),
          slug: key,
          sha: newEntry.entry.sha,
        });
      }
      if (entry.children || !key.endsWith(extension)) continue;
      const slug = key.slice(0, -extension.length);
      entries.push({
        key: getTreeKey(
          [
            entry.entry.path,
            getCollectionItemPath(config, collection, slug),
            ...directoriesUsedInSchema.map(x => `${x}/${slug}`),
          ],
          rootTree
        ),
        slug,
        sha: entry.entry.sha,
      });
    }
  }
  return entries;
}

export function useShowRestoredDraftMessage(
  draft:
    | {
        state: Record<string, unknown>;
        savedAt: Date;
        treeKey?: string | undefined;
      }
    | undefined,
  state: Record<string, unknown>,
  localTreeKey: string | undefined
) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const show = useEffectEvent(() => {
    if (draft && state === draft.state) {
      showDraftRestoredToast(
        draft.savedAt,
        localTreeKey !== draft.treeKey,
        stringFormatter,
      );
    }
  });
  useEffect(() => {
    if (draft) {
      show();
    }
  }, [draft, show]);
}
