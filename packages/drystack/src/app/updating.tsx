import { assert } from "emery";
import { useState } from "react";

import { ComponentSchema, fields } from "../form/api";
import { dump, load } from "js-yaml";
import {
  hydrateTreeCacheWithEntries,
  useCurrentUnscopedTree,
  useSetTreeSha,
} from "./shell/data";
import { fetchBlob, hydrateBlobCache } from "./useItemData";
import { redirectToNativeLoginIfUnauthorized } from "./auth";
import { useConfig } from "./shell/context";
import { trashedPathFor } from "./file-manager/useTrash";
import { FormatInfo, getEntryDataFilepath } from "./path-utils";
import {
  getTreeNodeAtPath,
  TreeEntry,
  TreeNode,
  treeSha,
  updateTreeWithChanges,
} from "./trees";
import {
  appendRedirect,
  parseRedirectEntries,
  REDIRECTS_FILE_PATH,
} from "./redirects";
import { Config } from "..";
import { serializeProps } from "../form/serialize-props";
import { useRouter } from "./router";
import { isDemoConfig } from "./storage-mode";
import { blockWriteInDemo } from "./demo-guard";
import { base64Encode } from "#base64";
import { useEntryUploadSession } from "./media-library/upload-session";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const frontmatterSplit = textEncoder.encode("---\n");

function combineFrontmatterAndContents(
  frontmatter: Uint8Array,
  contents: Uint8Array,
) {
  const array = new Uint8Array(
    frontmatter.byteLength +
      contents.byteLength +
      frontmatterSplit.byteLength * 2,
  );
  array.set(frontmatterSplit);
  array.set(frontmatter, frontmatterSplit.byteLength);
  array.set(
    frontmatterSplit,
    frontmatterSplit.byteLength + frontmatter.byteLength,
  );
  array.set(contents, frontmatterSplit.byteLength * 2 + frontmatter.byteLength);
  return array;
}

export function serializeEntryToFiles(args: {
  basePath: string;
  schema: Record<string, ComponentSchema>;
  format: FormatInfo;
  state: unknown;
  slug: { value: string; field: string } | undefined;
}) {
  let { value: stateWithExtraFilesRemoved, extraFiles } = serializeProps(
    args.state,
    fields.object(args.schema),
    args.slug?.field,
    args.slug?.value,
    true,
    // Where this entry's parent-less extra files (incl. a content field's
    // assets/) land - basePath is already the full entry dir (slug included),
    // matching how those files are written below, so fields.content can emit
    // public image srcs that resolve on the live site.
    args.basePath,
  );
  let dataContent = textEncoder.encode(dump(stateWithExtraFilesRemoved));

  if (args.format.contentField) {
    const filename = `${args.format.contentField.path.join("/")}${
      args.format.contentField.contentExtension
    }`;
    let contents: undefined | Uint8Array;
    extraFiles = extraFiles.filter((x) => {
      if (x.path !== filename) return true;
      contents = x.contents;
      return false;
    });
    assert(contents !== undefined, "Expected content field to be present");
    dataContent = combineFrontmatterAndContents(dataContent, contents);
  }

  return [
    {
      path: getEntryDataFilepath(args.basePath, args.format),
      contents: dataContent,
    },
    ...extraFiles.map((file) => ({
      path: `${
        file.parent
          ? args.slug
            ? `${file.parent}/${args.slug.value}`
            : file.parent
          : args.basePath
      }/${file.path}`,
      contents: file.contents,
    })),
  ];
}

// Read the current redirect table from the tree, add `redirect`, and return the
// serialized `redirects/index.yaml` addition. Shared by item save (rename) and
// delete so the 301 lands in the *same* `/update` call as the change that
// killed the old URL - no drift if the commit fails.
async function buildRedirectAddition(args: {
  config: Config;
  unscopedTree: Map<string, TreeNode>;
  redirect: { from: string; to: string };
  rootPath: string;
}): Promise<{ path: string; contents: Uint8Array }> {
  const path = REDIRECTS_FILE_PATH;
  let entries = parseRedirectEntries(null);
  const existing = getTreeNodeAtPath(args.unscopedTree, path);
  if (existing?.entry.type === "blob" && existing.entry.sha) {
    const bytes = await fetchBlob(
      args.config,
      existing.entry.sha,
      path,
      args.rootPath,
    );
    entries = parseRedirectEntries(load(textDecoder.decode(bytes)));
  }
  const nextEntries = appendRedirect(entries, args.redirect);
  const contents = textEncoder.encode(dump({ entries: nextEntries }));
  return { path, contents };
}

// stamps `fields.timestamp()` values into entry state right before it's
// serialized for a real save (useUpsertItem below) - deliberately NOT done
// inside the field's own serialize(), since serializeEntryToFiles/
// serializeProps also run for draft autosave and useHasChanged's
// change-detection diff, where a self-updating `now` would make the form
// always look dirty.
function stampTimestamps(
  schema: Record<string, ComponentSchema>,
  state: unknown,
): unknown {
  if (typeof state !== "object" || state === null || Array.isArray(state)) {
    return state;
  }
  const nowIso = new Date().toISOString();
  const src = state as Record<string, unknown>;
  let next = src;
  for (const [key, field] of Object.entries(schema)) {
    if (
      field.kind !== "form" ||
      field.formKind !== undefined ||
      !field.timestamp
    )
      continue;
    const current = src[key];
    const isEmpty = current == null || current === "";
    if (field.timestamp === "updated" || isEmpty) {
      if (next === src) next = { ...src };
      next[key] = nowIso;
    }
  }
  return next;
}

export function useUpsertItem(args: {
  state: unknown;
  initialFiles: string[] | undefined;
  schema: Record<string, ComponentSchema>;
  config: Config;
  format: FormatInfo;
  currentLocalTreeKey: string | undefined;
  basePath: string;
  slug: { value: string; field: string } | undefined;
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "updated"; commitOid?: string }
    | { kind: "loading" }
    | { kind: "error"; error: Error }
  >({
    kind: "idle",
  });
  const setTreeSha = useSetTreeSha();
  const unscopedTreeData = useCurrentUnscopedTree();
  const { basePath: rootPath } = useRouter();
  const uploadSession = useEntryUploadSession(args.basePath);

  return [
    state,
    async (override?: {
      sha?: string;
      branch?: string;
      redirect?: { from: string; to: string };
    }): Promise<boolean> => {
      if (isDemoConfig(args.config)) {
        blockWriteInDemo();
        return false;
      }
      try {
        const unscopedTree =
          unscopedTreeData.kind === "loaded"
            ? unscopedTreeData.data.tree
            : undefined;
        if (!unscopedTree) return false;
        setState({ kind: "loading" });

        let additions = serializeEntryToFiles({
          basePath: args.basePath,
          schema: args.schema,
          format: args.format,
          state: stampTimestamps(args.schema, args.state),
          slug: args.slug,
        });

        const additionPathToSha = new Map(
          await Promise.all(
            additions.map(
              async (addition) =>
                [
                  addition.path,
                  await hydrateBlobCache(addition.contents),
                ] as const,
            ),
          ),
        );

        const filesToDelete = new Set(args.initialFiles);
        for (const file of additions) {
          filesToDelete.delete(file.path);
        }

        // sweep uploads made this session (via the media library dialog,
        // for a cover/collection image or a content image) that never made
        // it into the final saved state - e.g. the user picked a different
        // image afterwards, or deleted the content node before saving. A
        // tracked path counts as still referenced if it's one of this
        // save's own additions (an entry-local *embedded* content image
        // that's still in the doc becomes its own addition - see
        // serializeProps's `formKind === 'content'` handling) or appears as
        // a literal substring of the serialized output (image/images/
        // file/files field values, and content's *library*-referenced
        // image `src`s, are always written with a leading '/' - see
        // FileManagerRoot.resolvePicks and html/serialize.ts's image case).
        const trackedPaths = uploadSession.paths();
        if (trackedPaths.length) {
          const additionPaths = new Set(additions.map((a) => a.path));
          const combinedText = additions
            .map((a) => textDecoder.decode(a.contents))
            .join("\n");
          for (const path of trackedPaths) {
            if (
              !additionPaths.has(path) &&
              !combinedText.includes(`/${path}`)
            ) {
              filesToDelete.add(path);
            }
          }
        }

        additions = additions.filter((addition) => {
          const sha = additionPathToSha.get(addition.path)!;
          const existing = getTreeNodeAtPath(unscopedTree, addition.path);
          return existing?.entry.sha !== sha;
        });

        // Rename with a requested redirect: fold `from → to` into
        // redirects/index.yaml in this same `/update` call, so the 301
        // table never drifts out of sync with the rename that created it.
        // Added after the unchanged-blob filter above (which it deliberately
        // bypasses) since it's always a real content change when requested.
        if (override?.redirect) {
          additions.push(
            await buildRedirectAddition({
              config: args.config,
              unscopedTree,
              redirect: override.redirect,
              rootPath,
            }),
          );
        }

        const deletions: { path: string }[] = [...filesToDelete].map(
          (path) => ({
            path,
          }),
        );
        const updatedTree = await updateTreeWithChanges(unscopedTree, {
          additions,
          deletions: [...filesToDelete],
        });
        await hydrateTreeCacheWithEntries(updatedTree.entries);
        const res = await fetch(`/api${rootPath}/update`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "no-cors": "1",
          },
          body: JSON.stringify({
            additions: additions.map((addition) => ({
              ...addition,
              contents: base64Encode(addition.contents),
            })),
            deletions,
          }),
        });
        if (!res.ok) {
          redirectToNativeLoginIfUnauthorized(res.status);
          throw new Error(await res.text());
        }
        const newTree: TreeEntry[] = await res.json();
        const { tree } = await hydrateTreeCacheWithEntries(newTree);
        setTreeSha(await treeSha(tree));
        uploadSession.clear();
        setState({ kind: "updated" });
        return true;
      } catch (err) {
        setState({ kind: "error", error: err as Error });
        return false;
      }
    },
    () => {
      setState({ kind: "idle" });
    },
  ] as const;
}

export function useDeleteItem(args: {
  basePath: string;
  initialFiles: string[];
  storage: Config["storage"];
}) {
  const [state, setState] = useState<
    | { kind: "idle" }
    | { kind: "updated" }
    | { kind: "loading" }
    | { kind: "error"; error: Error }
  >({
    kind: "idle",
  });
  const setTreeSha = useSetTreeSha();
  const unscopedTreeData = useCurrentUnscopedTree();
  const { basePath: rootPath } = useRouter();
  const config = useConfig();

  return [
    state,
    async (opts?: { redirect?: { from: string; to: string } }) => {
      if (isDemoConfig(config)) {
        blockWriteInDemo();
        return false;
      }
      try {
        const unscopedTree =
          unscopedTreeData.kind === "loaded"
            ? unscopedTreeData.data.tree
            : undefined;
        if (!unscopedTree) return false;
        setState({ kind: "loading" });
        // everything the schema knows about, plus every other file that
        // happens to live under this entry's own directory (e.g. orphaned
        // local-media uploads the schema never referenced) - deleting an
        // entry should take its whole folder with it
        const entryDirPrefix = `${args.basePath}/`;
        const cascadeDeletions =
          unscopedTreeData.kind === "loaded"
            ? [...unscopedTreeData.data.entries.values()]
                .filter(
                  (entry) =>
                    entry.type === "blob" &&
                    entry.path.startsWith(entryDirPrefix),
                )
                .map((entry) => entry.path)
            : [];
        const deletions = [
          ...new Set([...args.initialFiles, ...cascadeDeletions]),
        ];
        // deleting an entry the user wants redirected: fold it into
        // redirects/index.yaml in this same `/update` call, exactly like
        // the rename path in useUpsertItem above.
        const redirectAddition = opts?.redirect
          ? await buildRedirectAddition({
              config,
              unscopedTree,
              redirect: opts.redirect,
              rootPath,
            })
          : undefined;
        const updatedTree = await updateTreeWithChanges(unscopedTree, {
          additions: redirectAddition ? [redirectAddition] : [],
          deletions,
        });
        await hydrateTreeCacheWithEntries(updatedTree.entries);
        // move the whole entry into the trash instead of deleting it
        // outright, so it can be restored from the File Manager - emulated
        // as one request that both rewrites the bytes at their
        // `.deleted/...` path and removes the originals
        const additions = (
          await Promise.all(
            deletions.map(async (path) => {
              const sha = getTreeNodeAtPath(unscopedTree, path)?.entry.sha;
              if (!sha) return null;
              const contents = await fetchBlob(config, sha, path, rootPath);
              return {
                path: trashedPathFor(path),
                contents: base64Encode(contents),
              };
            }),
          )
        ).filter((x): x is NonNullable<typeof x> => x !== null);
        if (redirectAddition) {
          additions.push({
            path: redirectAddition.path,
            contents: base64Encode(redirectAddition.contents),
          });
        }
        const res = await fetch(`/api${rootPath}/update`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "no-cors": "1",
          },
          body: JSON.stringify({
            additions,
            deletions: deletions.map((path) => ({ path })),
          }),
        });
        if (!res.ok) {
          redirectToNativeLoginIfUnauthorized(res.status);
          throw new Error(await res.text());
        }
        const newTree: TreeEntry[] = await res.json();
        const { tree } = await hydrateTreeCacheWithEntries(newTree);
        setTreeSha(await treeSha(tree));
        setState({ kind: "updated" });
        return true;
      } catch (err) {
        setState({ kind: "error", error: err as Error });
      }
    },
    () => {
      setState({ kind: "idle" });
    },
  ] as const;
}
