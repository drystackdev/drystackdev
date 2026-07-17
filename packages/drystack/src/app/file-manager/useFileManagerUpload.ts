import { useCallback, useRef, useState } from "react";
import { base64Encode } from "#base64";
import { useRouter } from "../router";
import {
  hydrateTreeCacheWithEntries,
  useCurrentUnscopedTree,
} from "../shell/data";
import { useConfig } from "../shell/context";
import { useCommitFileChanges } from "../shell/useCommitFileChanges";
import { updateTreeWithChanges } from "../trees";
import { trackFreshUpload } from "../media-library/upload-session";

export type ConflictResolution = "skip" | "replace" | "rename";

export type PendingUpload = {
  file: File;
  content: Uint8Array;
  targetPath: string;
  conflict: boolean;
};

export type UploadConflictState = {
  files: PendingUpload[];
  // index (into `files`) of the conflicting file currently shown in the dialog
  index: number;
  remainingConflicts: number;
};

function renamedWithSuffix(targetPath: string) {
  const dotIndex = targetPath.lastIndexOf(".");
  const suffix = Math.random().toString(36).slice(2, 8);
  if (dotIndex === -1) return `${targetPath}-${suffix}`;
  return `${targetPath.slice(0, dotIndex)}-${suffix}${targetPath.slice(dotIndex)}`;
}

function nextConflictIndex(files: PendingUpload[], resolved: Set<File>) {
  return files.findIndex((f) => f.conflict && !resolved.has(f.file));
}

// Uploads N files to `directory` in one request. Files whose target path
// already exists surface a conflict dialog (skip/replace/rename, optionally
// applied to every remaining conflict) before anything is sent - only after
// every conflict is resolved does this POST once to `/update`.
export function useFileManagerUpload() {
  const { basePath } = useRouter();
  const config = useConfig();
  const unscopedTreeData = useCurrentUnscopedTree();
  const commitFileChanges = useCommitFileChanges();
  const [pending, setPending] = useState<UploadConflictState | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const resolutionsRef = useRef(new Map<File, ConflictResolution>());
  const filesRef = useRef<PendingUpload[]>([]);

  const commit = useCallback(
    async (files: PendingUpload[]) => {
      const uploaded: { path: string; content: Uint8Array }[] = [];
      // paths that didn't overwrite a pre-existing file - candidates for
      // save-time cleanup if the entry ends up not referencing them (see
      // trackFreshUpload). A conflict resolved as 'replace' overwrote a file
      // that already existed before this session, so it's excluded.
      const freshPaths: string[] = [];
      const additions = files
        .map((f) => {
          const resolution = f.conflict
            ? (resolutionsRef.current.get(f.file) ?? "skip")
            : "replace";
          if (resolution === "skip") return null;
          const path =
            resolution === "rename"
              ? renamedWithSuffix(f.targetPath)
              : f.targetPath;
          uploaded.push({ path, content: f.content });
          if (!f.conflict || resolution === "rename") {
            freshPaths.push(path);
          }
          return { path, contents: base64Encode(f.content) };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null);

      setIsUploading(true);
      try {
        if (additions.length === 0) return undefined;
        if (config.storage.kind === "github") {
          const unscopedTree =
            unscopedTreeData.kind === "loaded"
              ? unscopedTreeData.data.tree
              : undefined;
          if (!unscopedTree) throw new Error("Tree not loaded");
          const githubAdditions = uploaded.map((u) => ({
            path: u.path,
            contents: u.content,
          }));
          const updatedTree = await updateTreeWithChanges(unscopedTree, {
            additions: githubAdditions,
            deletions: [],
          });
          const result = await commitFileChanges({
            message: `Upload files`,
            additions: githubAdditions,
            deletions: [],
          });
          if (result.kind === "needs-fork") {
            throw new Error(
              "This repository requires a fork to make changes - use the entry editor to request one first.",
            );
          }
          if (result.kind === "error") throw result.error;
          const tree = await hydrateTreeCacheWithEntries(updatedTree.entries);
          // No setTreeSha in github mode: there's no SetTreeShaContext
          // provider there so it would throw (which previously left the New
          // Folder dialog stuck open). The tree refreshes from the commit
          // result via urql's normalized cache, same as useUpsertItem's save.
          freshPaths.forEach(trackFreshUpload);
          return { ...tree, uploaded };
        }
        const res = await fetch(`/api${basePath}/update`, {
          method: "POST",
          headers: { "Content-Type": "application/json", "no-cors": "1" },
          body: JSON.stringify({ additions, deletions: [] }),
        });
        if (!res.ok) throw new Error(await res.text());
        const newTree = await res.json();
        const tree = await hydrateTreeCacheWithEntries(newTree);
        freshPaths.forEach(trackFreshUpload);
        return { ...tree, uploaded };
      } finally {
        setIsUploading(false);
        resolutionsRef.current = new Map();
        filesRef.current = [];
      }
    },
    [basePath, config, unscopedTreeData, commitFileChanges],
  );

  const startUpload = useCallback(
    async (
      fileList: FileList | File[],
      directory: string,
      existingPaths: ReadonlySet<string>,
    ) => {
      const files = Array.from(fileList);
      const candidates: PendingUpload[] = await Promise.all(
        files.map(async (file) => {
          const content = new Uint8Array(await file.arrayBuffer());
          const targetPath = `${directory}/${file.name}`;
          return {
            file,
            content,
            targetPath,
            conflict: existingPaths.has(targetPath),
          };
        }),
      );
      resolutionsRef.current = new Map();
      filesRef.current = candidates;
      const firstConflict = nextConflictIndex(candidates, new Set());
      if (firstConflict === -1) {
        return commit(candidates);
      }
      setPending({
        files: candidates,
        index: firstConflict,
        remainingConflicts: candidates.filter((f) => f.conflict).length,
      });
      return undefined;
    },
    [commit],
  );

  const resolveCurrent = useCallback(
    async (resolution: ConflictResolution, applyToAllRemaining: boolean) => {
      const files = filesRef.current;
      if (!pending) return undefined;
      const current = files[pending.index];
      const resolved = new Set(resolutionsRef.current.keys());
      if (applyToAllRemaining) {
        for (const f of files) {
          if (f.conflict && !resolved.has(f.file)) {
            resolutionsRef.current.set(f.file, resolution);
          }
        }
      } else {
        resolutionsRef.current.set(current.file, resolution);
      }
      const stillResolved = new Set(resolutionsRef.current.keys());
      const next = nextConflictIndex(files, stillResolved);
      if (next === -1) {
        setPending(null);
        return commit(files);
      }
      setPending({
        files,
        index: next,
        remainingConflicts: files.filter(
          (f) => f.conflict && !stillResolved.has(f.file),
        ).length,
      });
      return undefined;
    },
    [pending, commit],
  );

  const abortUpload = useCallback(() => {
    setPending(null);
    resolutionsRef.current = new Map();
    filesRef.current = [];
  }, []);

  return {
    startUpload,
    pendingConflict: pending,
    resolveCurrent,
    abortUpload,
    isUploading,
  };
}
