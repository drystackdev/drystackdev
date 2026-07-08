import { useMemo } from 'react';
import { useTree } from '../shell/data';
import { getTreeNodeAtPath, TreeNode } from '../trees';

export type DirectoryChild = {
  name: string;
  path: string;
  type: 'blob' | 'tree';
  sha: string;
  // direct child count, only meaningful for `type: 'tree'`
  childCount?: number;
  // byte size, only meaningful for `type: 'blob'`
  size?: number;
};

function childrenOf(path: string, root: Map<string, TreeNode>) {
  if (path === '') return root;
  return getTreeNodeAtPath(root, path)?.children;
}

// direct (non-recursive) children of `path` — real folders and files, built
// from the tree already kept in memory (no extra server round-trip)
export function useDirectoryChildren(path: string): DirectoryChild[] {
  const tree = useTree().current;
  return useMemo(() => {
    if (tree.kind !== 'loaded') return [];
    const children = childrenOf(path, tree.data.tree);
    if (!children) return [];
    return [...children.values()]
      .map((node): DirectoryChild => ({
        name: node.entry.path.split('/').pop()!,
        path: node.entry.path,
        type: node.entry.type as 'blob' | 'tree',
        sha: node.entry.sha,
        childCount: node.children?.size,
        size: node.entry.size,
      }))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'tree' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  }, [tree, path]);
}
