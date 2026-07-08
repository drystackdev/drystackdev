import { useEffect, useState } from 'react';
import { useConfig } from '../shell/context';
import { useBaseCommit, useRepoInfo, useTree } from '../shell/data';
import { useRouter } from '../router';
import { fetchBlob } from '../useItemData';
import { getTreeNodeAtPath } from '../trees';

// `sessionContent` lets a caller that already has the bytes in hand (e.g. a
// file just uploaded/picked this session, not yet reflected in the tree)
// skip the tree/sha lookup entirely and preview them immediately.
export function useMediaLibraryPreviewURL(
  path: string | null,
  sessionContent?: Uint8Array | null
) {
  const config = useConfig();
  const baseCommit = useBaseCommit();
  const repoInfo = useRepoInfo();
  const { basePath } = useRouter();
  const tree = useTree().current;
  const relativePath = path?.replace(/^\/+/, '');
  const sha =
    relativePath && tree.kind === 'loaded'
      ? getTreeNodeAtPath(tree.data.tree, relativePath)?.entry.sha
      : undefined;

  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (sessionContent) {
      const createdUrl = URL.createObjectURL(new Blob([sessionContent]));
      setObjectUrl(createdUrl);
      return () => URL.revokeObjectURL(createdUrl);
    }
    if (!relativePath || !sha) {
      setObjectUrl(null);
      return;
    }
    let cancelled = false;
    let createdUrl: string | null = null;
    Promise.resolve(
      fetchBlob(config, sha, relativePath, baseCommit, repoInfo, basePath)
    ).then(bytes => {
      if (cancelled) return;
      createdUrl = URL.createObjectURL(new Blob([bytes]));
      setObjectUrl(createdUrl);
    });
    return () => {
      cancelled = true;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relativePath, sha, basePath, sessionContent]);

  return objectUrl;
}
