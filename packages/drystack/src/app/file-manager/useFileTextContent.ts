import { useEffect, useState } from "react";
import { useConfig } from "../shell/context";
import { useBaseCommit, useRepoInfo, useTree } from "../shell/data";
import { useRouter } from "../router";
import { fetchBlob } from "../useItemData";
import { getTreeNodeAtPath } from "../trees";

const textDecoder = new TextDecoder();

// decoded UTF-8 text content of a real tree path - same data source as
// `useMediaLibraryPreviewURL`, but returns text instead of an object URL
export function useFileTextContent(path: string | null) {
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

  const [text, setText] = useState<string | null>(null);

  useEffect(() => {
    if (!relativePath || !sha) {
      setText(null);
      return;
    }
    let cancelled = false;
    Promise.resolve(
      fetchBlob(config, sha, relativePath, baseCommit, repoInfo, basePath),
    )
      .then((bytes) => {
        if (cancelled) return;
        setText(textDecoder.decode(bytes));
      })
      .catch(() => {
        // leave text null - caller keeps showing its existing empty state
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relativePath, sha, basePath]);

  return text;
}
