import { useEffect, useRef, useState } from "react";
import { DialogContainer } from "@keystar/ui/dialog";

import { useTree } from "../shell/data";
import { useConfig } from "../shell/context";
import { useRouter } from "../router";
import { fetchBlob } from "../useItemData";
import { getTreeNodeAtPath } from "../trees";
import {
  MediaLibraryLocalScope,
  MediaLibraryPick,
  registerMediaLibraryBytesResolver,
  registerMediaLibraryOpener,
  registerMediaLibraryUploader,
} from "../media-library/bridge";
import { MEDIA_LIBRARY_DIRECTORY } from "../media-library/constants";
import { useMediaLibraryUpload } from "../media-library/useMediaLibraryUpload";
import { useDirectoryChildren } from "./useDirectoryChildren";
import { FileManagerDialog } from "./FileManagerDialog";

// bytes for library files picked/uploaded this session, keyed by filename -
// a freshly uploaded/picked library file isn't in the tree yet (see
// useMediaLibraryUpload's note on not calling setTreeSha), so the editor's
// lazy `resolveMediaLibraryBytes` lookup can't find it via tree sha until the
// tree next refreshes; this cache lets it resolve immediately instead
const libraryBytesCache = new Map<string, Uint8Array>();

export function FileManagerHost() {
  const [request, setRequest] = useState<{
    accept: "image" | "any" | undefined;
    local: MediaLibraryLocalScope | undefined;
    selection: "single" | "multi";
    resolve: (picks: MediaLibraryPick[] | undefined) => void;
  } | null>(null);

  useEffect(() => {
    registerMediaLibraryOpener((options) => {
      return new Promise((resolve) => {
        setRequest({
          accept: options.accept,
          local: options.local,
          selection: options.selection,
          resolve,
        });
      });
    });
    return () => registerMediaLibraryOpener(null);
  }, []);

  const libraryEntries = useDirectoryChildren(MEDIA_LIBRARY_DIRECTORY);
  const upload = useMediaLibraryUpload();
  // tracks uploads made through the eager (drag & drop / paste) path within
  // this session, since the directory listing above only catches up after a
  // tree refetch
  const eagerlyUploadedPaths = useRef(new Set<string>());

  useEffect(() => {
    registerMediaLibraryUploader(async (content, filename) => {
      const existingPaths = new Set([
        ...libraryEntries.map((entry) => entry.path),
        ...eagerlyUploadedPaths.current,
      ]);
      const path = await upload(
        MEDIA_LIBRARY_DIRECTORY,
        content,
        filename,
        existingPaths,
      );
      const relativePath = path.replace(/^\/+/, "");
      eagerlyUploadedPaths.current.add(relativePath);
      libraryBytesCache.set(relativePath.split("/").pop()!, content);
      return { path, filename: relativePath.split("/").pop()! };
    });
    return () => registerMediaLibraryUploader(null);
  }, [libraryEntries, upload]);

  const config = useConfig();
  const { basePath } = useRouter();
  const tree = useTree().current;

  useEffect(() => {
    registerMediaLibraryBytesResolver(async (filename) => {
      const cached = libraryBytesCache.get(filename);
      if (cached) return cached;
      if (tree.kind !== "loaded") return undefined;
      const path = `${MEDIA_LIBRARY_DIRECTORY}/${filename}`;
      const sha = getTreeNodeAtPath(tree.data.tree, path)?.entry.sha;
      if (!sha) return undefined;
      return fetchBlob(config, sha, path, basePath);
    });
    return () => registerMediaLibraryBytesResolver(null);
  }, [tree, config, basePath]);

  const resolveAndClose = (picks: MediaLibraryPick[] | undefined) => {
    if (picks) {
      for (const pick of picks) {
        if (pick.source === "library") {
          libraryBytesCache.set(pick.filename, pick.content);
        }
      }
    }
    request?.resolve(picks);
    setRequest(null);
  };

  return (
    <DialogContainer onDismiss={() => resolveAndClose(undefined)}>
      {request && (
        <FileManagerDialog
          accept={request.accept}
          selection={request.selection}
          local={request.local}
          onPick={(picks) => resolveAndClose(picks)}
        />
      )}
    </DialogContainer>
  );
}
