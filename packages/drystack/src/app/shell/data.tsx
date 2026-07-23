import { useRouter } from '../router';
import { Config } from '../../config';
import {
  useMemo,
  createContext,
  useContext,
  useCallback,
  ReactNode,
  useState,
} from 'react';
import { getSingletonPath } from '../path-utils';
import {
  treeEntriesToTreeNodes,
  TreeEntry,
  TreeNode,
  treeSha,
  getTreeNodeAtPath,
} from '../trees';
import { DataState, LOADING, mergeDataStates, useData } from '../useData';
import { getEntriesInCollectionWithTreeKey, MaybePromise } from '../utils';
import { LRUCache as LRU } from 'lru-cache';
import { isDemoConfig } from '../storage-mode';
import { getDemoTreeEntries } from '../demo-source';

export function fetchLocalTree(
  sha: string,
  basePath: string,
  config: Config
) {
  if (treeCache.has(sha)) {
    return treeCache.get(sha)!;
  }
  // Demo mode has no `/api/*/tree` route to call - the whole build is static
  // - so its "disk" is the prebuilt zip instead. See app/demo-source.ts.
  const promise = (
    isDemoConfig(config)
      ? getDemoTreeEntries()
      : fetch(`/api${basePath}/tree`, { headers: { 'no-cors': '1' } }).then(x =>
          x.json()
        )
  ).then(async (entries: TreeEntry[]) => hydrateTreeCacheWithEntries(entries));
  treeCache.set(sha, promise);
  return promise;
}

export function useSetTreeSha() {
  return useContext(SetTreeShaContext);
}

export const SetTreeShaContext = createContext<(sha: string) => void>(() => {
  throw new Error('SetTreeShaContext not set');
});

export function LocalAppShellProvider(props: {
  config: Config;
  children: ReactNode;
}) {
  const [currentTreeSha, setCurrentTreeSha] = useState<string>('initial');
  const { basePath } = useRouter();

  const tree = useData(
    useCallback(
      () => fetchLocalTree(currentTreeSha, basePath, props.config),
      [currentTreeSha, basePath, props.config]
    )
  );

  const allTreeData = useMemo(
    () => ({
      unscopedDefault: tree,
      scoped: {
        default: tree,
        current: tree,
        merged: mergeDataStates({ default: tree, current: tree }),
      },
    }),
    [tree]
  );
  const changedData = useMemo(() => {
    if (allTreeData.scoped.merged.kind !== 'loaded') {
      return {
        collections: new Map<
          string,
          {
            removed: Set<string>;
            added: Set<string>;
            changed: Set<string>;
            totalCount: number;
          }
        >(),
        singletons: new Set<string>(),
      };
    }
    return getChangedData(props.config, allTreeData.scoped.merged.data);
  }, [allTreeData, props.config]);

  return (
    <SetTreeShaContext.Provider value={setCurrentTreeSha}>
      <ChangedContext.Provider value={changedData}>
        <TreeContext.Provider value={allTreeData}>
          {props.children}
        </TreeContext.Provider>
      </ChangedContext.Provider>
    </SetTreeShaContext.Provider>
  );
}

const CurrentBranchContext = createContext<string>('');

export function useCurrentBranch() {
  return useContext(CurrentBranchContext);
}

type BranchInfo = {
  id: string;
  commitSha: string;
  treeSha: string;
  authorLogin: string | null;
};

const BranchesContext = createContext<Map<string, BranchInfo>>(new Map());

export function useBranches() {
  return useContext(BranchesContext);
}

export const ChangedContext = createContext<{
  collections: Map<
    string,
    {
      added: Set<string>;
      removed: Set<string>;
      changed: Set<string>;
      totalCount: number;
    }
  >;
  singletons: Set<string>;
}>({ collections: new Map(), singletons: new Set() });

type Filepath = string;

export type TreeData = {
  entries: Map<Filepath, TreeEntry>;
  tree: Map<string, TreeNode>;
};

type AllTreeData = {
  unscopedDefault: DataState<TreeData>;
  scoped: {
    current: DataState<TreeData>;
    default: DataState<TreeData>;
    merged: DataState<{
      current: TreeData;
      default: TreeData;
    }>;
  };
};

const TreeContext = createContext<AllTreeData>({
  unscopedDefault: { kind: 'loading', promise: LOADING },
  scoped: {
    current: { kind: 'loading', promise: LOADING },
    default: { kind: 'loading', promise: LOADING },
    merged: { kind: 'loading', promise: LOADING },
  },
});

export function useTree() {
  return useContext(TreeContext).scoped;
}

export function useCurrentUnscopedTree() {
  return useContext(TreeContext).unscopedDefault;
}

export function useChanged() {
  return useContext(ChangedContext);
}

export function useBaseCommit() {
  const branchInfo = useBranches();
  const currentBranch = useCurrentBranch();
  return branchInfo.get(currentBranch)?.commitSha ?? '';
}

const treeCache = new LRU<
  string,
  MaybePromise<{
    entries: Map<Filepath, TreeEntry>;
    tree: Map<string, TreeNode>;
  }>
>({
  max: 40,
});

export async function hydrateTreeCacheWithEntries(entries: TreeEntry[]) {
  const data = {
    entries: new Map(entries.map(entry => [entry.path, entry])),
    tree: treeEntriesToTreeNodes(entries),
  };
  const sha = await treeSha(data.tree);
  treeCache.set(sha, data);
  return data;
}

function getChangedData(
  config: Config,
  trees: { current: TreeData; default: TreeData }
) {
  return {
    collections: new Map(
      Object.keys(config.collections ?? {}).map(collection => {
        const currentBranch = new Map(
          getEntriesInCollectionWithTreeKey(
            config,
            collection,
            trees.current.tree
          ).map(x => [x.slug, x.key])
        );
        const defaultBranch = new Map(
          getEntriesInCollectionWithTreeKey(
            config,
            collection,
            trees.default.tree
          ).map(x => [x.slug, x.key])
        );

        const changed = new Set<string>();
        const added = new Set<string>();
        for (const [key, entry] of currentBranch) {
          const defaultBranchEntry = defaultBranch.get(key);
          if (defaultBranchEntry === undefined) {
            added.add(key);
            continue;
          }
          if (entry !== defaultBranchEntry) {
            changed.add(key);
          }
        }
        const removed = new Set(
          [...defaultBranch.keys()].filter(key => !currentBranch.has(key))
        );
        return [
          collection,
          { removed, added, changed, totalCount: currentBranch.size },
        ];
      })
    ),
    singletons: new Set(
      Object.keys(config.singletons ?? {}).filter(singleton => {
        const singletonPath = getSingletonPath(config, singleton);
        return (
          getTreeNodeAtPath(trees.current.tree, singletonPath)?.entry.sha !==
          getTreeNodeAtPath(trees.default.tree, singletonPath)?.entry.sha
        );
      })
    ),
  };
}
