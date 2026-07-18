import { useEffect, useState } from "react";
import { useConfig } from "../shell/context";
import { useBaseCommit, useRepoInfo, useTree } from "../shell/data";
import { useRouter } from "../router";
import { fetchBlob } from "../useItemData";
import { getTreeNodeAtPath } from "../trees";
import {
  acquireExistingObjectURL,
  acquireObjectURL,
  getThumbnailBytes,
  releaseObjectURL,
  thumbnailKey,
} from "./image-preview-cache";

// `sessionContent` lets a caller that already has the bytes in hand (e.g. a
// file just uploaded/picked this session, not yet reflected in the tree)
// skip the tree/sha lookup entirely and preview them immediately.
// `enabled` (default true) lets a caller rendering many instances at once
// (e.g. a File Manager grid) defer the fetch until the item is actually
// worth loading - see `useInView`.
// `thumbnail` (default false) returns a downscaled preview instead of the
// full-resolution blob - right for grid/filmstrip cells, wrong for the
// zoomable full-size overlay. See `image-preview-cache.ts`.
export function useMediaLibraryPreviewURL(
  path: string | null,
  sessionContent?: Uint8Array | null,
  enabled = true,
  thumbnail = false,
) {
  const config = useConfig();
  const baseCommit = useBaseCommit();
  const repoInfo = useRepoInfo();
  const { basePath } = useRouter();
  const tree = useTree().current;
  const relativePath = path?.replace(/^\/+/, "");
  const sha =
    relativePath && tree.kind === "loaded"
      ? getTreeNodeAtPath(tree.data.tree, relativePath)?.entry.sha
      : undefined;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    // Freshly uploaded/picked bytes have no stable sha to key the shared cache
    // on - keep the direct create/revoke path (these are few in number).
    if (sessionContent) {
      const createdUrl = URL.createObjectURL(
        new Blob([sessionContent as Uint8Array<ArrayBuffer>]),
      );
      setObjectUrl(createdUrl);
      return () => URL.revokeObjectURL(createdUrl);
    }
    if (!relativePath || !sha || !enabled) {
      setObjectUrl(null);
      return;
    }

    const cacheKey = thumbnail ? thumbnailKey(sha) : sha;

    // Reuse an already-built object URL (including idle ones) without touching
    // the network or re-encoding a thumbnail.
    const existing = acquireExistingObjectURL(cacheKey);
    if (existing) {
      setObjectUrl(existing);
      return () => releaseObjectURL(cacheKey);
    }

    let cancelled = false;
    let acquiredKey: string | null = null;
    Promise.resolve(
      fetchBlob(config, sha, relativePath, baseCommit, repoInfo, basePath),
    )
      .then((bytes) => (thumbnail ? getThumbnailBytes(sha, bytes) : bytes))
      .then((bytes) => {
        if (cancelled) return;
        acquiredKey = cacheKey;
        setObjectUrl(acquireObjectURL(cacheKey, bytes));
      })
      .catch(() => {
        // leave objectUrl null - caller falls back to a file-type icon
      });
    return () => {
      cancelled = true;
      if (acquiredKey) releaseObjectURL(acquiredKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relativePath, sha, basePath, sessionContent, enabled, thumbnail]);

  return objectUrl;
}

// Warms the blob cache (memory + IndexedDB) for a set of paths without
// building object URLs - used to prefetch an overlay's neighbouring images so
// left/right navigation is instant. Safe to call with nulls/empties.
export function useMediaLibraryPrefetch(paths: (string | null | undefined)[]) {
  const config = useConfig();
  const baseCommit = useBaseCommit();
  const repoInfo = useRepoInfo();
  const { basePath } = useRouter();
  const tree = useTree().current;
  const cacheKey = paths.filter(Boolean).join("\n");

  useEffect(() => {
    if (tree.kind !== "loaded") return;
    for (const p of paths) {
      if (!p) continue;
      const rel = p.replace(/^\/+/, "");
      const sha = getTreeNodeAtPath(tree.data.tree, rel)?.entry.sha;
      if (!sha) continue;
      // fire-and-forget; fetchBlob dedupes and shares the concurrency queue
      Promise.resolve(
        fetchBlob(config, sha, rel, baseCommit, repoInfo, basePath),
      ).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, tree, basePath]);
}
