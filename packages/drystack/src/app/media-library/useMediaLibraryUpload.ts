import { useCallback } from "react";
import { base64Encode } from "#base64";
import { useRouter } from "../router";
import {
  hydrateTreeCacheWithEntries,
  useCurrentUnscopedTree,
} from "../shell/data";
import { useConfig } from "../shell/context";
import { useCommitFileChanges } from "../shell/useCommitFileChanges";
import { TreeEntry, updateTreeWithChanges } from "../trees";
import { trackFreshUpload } from "./upload-session";

function uniquePath(
  directory: string,
  filename: string,
  existing: ReadonlySet<string>,
) {
  const dotIndex = filename.lastIndexOf(".");
  const base = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
  const extension = dotIndex === -1 ? "" : filename.slice(dotIndex);
  let candidate = `${directory}/${filename}`;
  let i = 1;
  while (existing.has(candidate)) {
    candidate = `${directory}/${base}-${i}${extension}`;
    i++;
  }
  return candidate;
}

// Note: this intentionally does NOT call `setTreeSha`. Doing so would update
// the app-wide tree state, which the currently open entry form treats as an
// "external change" and resets its unsaved edits to match (see
// `localTreeKey` handling in ItemPage/SingletonPage). An upload triggered
// from within this same form shouldn't blow away what the user is editing.
// The uploaded file is already durably written to disk; the tree will catch
// up next time it's naturally refreshed (e.g. after Save).
export function useMediaLibraryUpload() {
  const { basePath } = useRouter();
  const config = useConfig();
  const unscopedTreeData = useCurrentUnscopedTree();
  const commitFileChanges = useCommitFileChanges();

  return useCallback(
    async (
      directory: string,
      content: Uint8Array,
      filename: string,
      existingPaths: ReadonlySet<string>,
    ): Promise<string> => {
      const path = uniquePath(directory, filename, existingPaths);
      if (config.storage.kind === "github") {
        const unscopedTree =
          unscopedTreeData.kind === "loaded"
            ? unscopedTreeData.data.tree
            : undefined;
        if (!unscopedTree) throw new Error("Tree not loaded");
        const additions = [{ path, contents: content }];
        const updatedTree = await updateTreeWithChanges(unscopedTree, {
          additions,
          deletions: [],
        });
        const result = await commitFileChanges({
          message: `Upload ${filename}`,
          additions,
          deletions: [],
        });
        if (result.kind === "needs-fork") {
          throw new Error(
            "This repository requires a fork to make changes - use the entry editor to request one first.",
          );
        }
        if (result.kind === "error") throw result.error;
        // Note: this intentionally does NOT call `setTreeSha` - see comment above.
        await hydrateTreeCacheWithEntries(updatedTree.entries);
        trackFreshUpload(path);
        return `/${path}`;
      }
      const res = await fetch(`/api${basePath}/update`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "no-cors": "1",
        },
        body: JSON.stringify({
          additions: [{ path, contents: base64Encode(content) }],
          deletions: [],
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const newTree: TreeEntry[] = await res.json();
      await hydrateTreeCacheWithEntries(newTree);
      // `uniquePath` above always picks a non-colliding path, so this write
      // never overwrites something pre-existing - always fresh.
      trackFreshUpload(path);
      return `/${path}`;
    },
    [basePath, config, unscopedTreeData, commitFileChanges],
  );
}
