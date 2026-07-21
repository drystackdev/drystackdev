import { useCallback } from "react";
import { base64Encode } from "#base64";
import { useConfig } from "../shell/context";
import {
  useBaseCommit,
  useRepoInfo,
  useTree,
  useCurrentUnscopedTree,
  hydrateTreeCacheWithEntries,
} from "../shell/data";
import { useRouter } from "../router";
import { fetchBlob } from "../useItemData";
import { getTreeNodeAtPath, updateTreeWithChanges, TreeEntry } from "../trees";
import { useCommitFileChanges } from "../shell/useCommitFileChanges";
import { TRASH_DIRECTORY } from "./constants";
import { isDemoConfig } from "../storage-mode";
import { blockWriteInDemo } from "../demo-guard";
import { redirectToNativeLoginIfUnauthorized } from "../auth";

export function trashedPathFor(path: string) {
  return `${TRASH_DIRECTORY}/${path}`;
}

export function originalPathFor(trashedPath: string) {
  return trashedPath.slice(TRASH_DIRECTORY.length + 1);
}

export function isTrashedPath(path: string) {
  return path === TRASH_DIRECTORY || path.startsWith(`${TRASH_DIRECTORY}/`);
}

// every blob whose path lives under `dir` (not including `dir` itself)
export function descendantBlobPaths(
  entries: ReadonlyMap<string, TreeEntry>,
  dir: string,
): TreeEntry[] {
  const prefix = `${dir}/`;
  return [...entries.values()].filter(
    (entry) => entry.type === "blob" && entry.path.startsWith(prefix),
  );
}

async function postUpdate(
  basePath: string,
  additions: { path: string; contents: string }[],
  deletions: { path: string }[],
) {
  const res = await fetch(`/api${basePath}/update`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "no-cors": "1",
    },
    body: JSON.stringify({ additions, deletions }),
  });
  if (!res.ok) {
    redirectToNativeLoginIfUnauthorized(res.status);
    throw new Error(await res.text());
  }
  const newTree = await res.json();
  return hydrateTreeCacheWithEntries(newTree);
}

// Trash/restore are emulated as a single call that both writes the bytes at
// the new location (`additions`) and removes the old path (`deletions`) -
// there's no dedicated move/rename endpoint. Local storage does this via the
// `/update` REST route; github storage commits the same change straight to
// the branch via `useCommitFileChanges`, mirroring how uploads commit (see
// useFileManagerUpload.ts).
export function useTrash() {
  const config = useConfig();
  const baseCommit = useBaseCommit();
  const repoInfo = useRepoInfo();
  const { basePath } = useRouter();
  const tree = useTree().current;
  const unscopedTreeData = useCurrentUnscopedTree();
  const commitFileChanges = useCommitFileChanges();
  const isGitHub = config.storage.kind === "github";

  const commitToGitHub = useCallback(
    async (
      message: string,
      additions: { path: string; contents: Uint8Array }[],
      deletions: readonly string[],
    ) => {
      const unscopedTree =
        unscopedTreeData.kind === "loaded"
          ? unscopedTreeData.data.tree
          : undefined;
      if (!unscopedTree) throw new Error("Tree not loaded");
      const updatedTree = await updateTreeWithChanges(unscopedTree, {
        additions,
        deletions: [...deletions],
      });
      const result = await commitFileChanges({
        message,
        additions,
        deletions: deletions.map((path) => ({ path })),
      });
      if (result.kind === "needs-fork") {
        throw new Error(
          "This repository requires a fork to make changes - use the entry editor to request one first.",
        );
      }
      if (result.kind === "error") throw result.error;
      const hydrated = await hydrateTreeCacheWithEntries(updatedTree.entries);
      // No setTreeSha in github mode: there's no SetTreeShaContext
      // provider there so it would throw. The tree refreshes from the commit
      // result via urql's normalized cache, same as useUpsertItem's save path.
      return hydrated;
    },
    [unscopedTreeData, commitFileChanges],
  );

  // a directory-shaped path may be selected (e.g. a whole trashed folder) -
  // github deletions must name individual blobs, so expand any folder entry
  // to its descendant files first (mirrors FileManagerRoot's expandFolders)
  const expandToBlobPaths = useCallback(
    (paths: readonly string[]) => {
      if (tree.kind !== "loaded") return paths;
      return paths.flatMap((path) => {
        const node = getTreeNodeAtPath(tree.data.tree, path);
        if (node?.entry.type === "tree") {
          return descendantBlobPaths(tree.data.entries, path).map(
            (e) => e.path,
          );
        }
        return [path];
      });
    },
    [tree],
  );

  const movePaths = useCallback(
    async (paths: readonly string[], transform: (path: string) => string) => {
      if (isDemoConfig(config)) {
        blockWriteInDemo();
        return undefined;
      }
      if (tree.kind !== "loaded" || paths.length === 0) return undefined;
      const files = await Promise.all(
        paths.map(async (path) => {
          const sha = getTreeNodeAtPath(tree.data.tree, path)?.entry.sha;
          if (!sha) return null;
          const contents = await fetchBlob(
            config,
            sha,
            path,
            baseCommit,
            repoInfo,
            basePath,
          );
          return { path, newPath: transform(path), contents };
        }),
      );
      const valid = files.filter((x): x is NonNullable<typeof x> => x !== null);
      if (valid.length === 0) return undefined;
      if (isGitHub) {
        return commitToGitHub(
          "Move files",
          valid.map((f) => ({ path: f.newPath, contents: f.contents })),
          valid.map((f) => f.path),
        );
      }
      return postUpdate(
        basePath,
        valid.map((f) => ({
          path: f.newPath,
          contents: base64Encode(f.contents),
        })),
        valid.map((f) => ({ path: f.path })),
      );
    },
    [tree, config, baseCommit, repoInfo, basePath, isGitHub, commitToGitHub],
  );

  const trashPaths = useCallback(
    (paths: readonly string[]) => movePaths(paths, trashedPathFor),
    [movePaths],
  );

  const restorePaths = useCallback(
    (paths: readonly string[]) => movePaths(paths, originalPathFor),
    [movePaths],
  );

  const permanentlyDelete = useCallback(
    (paths: readonly string[]) => {
      if (isDemoConfig(config)) {
        blockWriteInDemo();
        return undefined;
      }
      if (isGitHub) {
        return commitToGitHub("Delete files", [], expandToBlobPaths(paths));
      }
      // a directory-shaped path here removes everything under it in one go
      // (server's fs.rm is called with recursive:true)
      return postUpdate(
        basePath,
        [],
        paths.map((path) => ({ path })),
      );
    },
    [config, basePath, isGitHub, commitToGitHub, expandToBlobPaths],
  );

  return { trashPaths, restorePaths, permanentlyDelete };
}
