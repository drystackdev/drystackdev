import { gql } from '@ts-gql/tag/no-transform';
import { assert } from 'emery';
import { useContext, useState } from 'react';

import { ComponentSchema, fields } from '../form/api';
import { dump, load } from 'js-yaml';
import { useMutation } from 'urql';
import {
  fetchGitHubTreeData,
  hydrateTreeCacheWithEntries,
  useBaseCommit,
  useCurrentBranch,
  useCurrentUnscopedTree,
  useRepoInfo,
  useSetTreeSha,
} from './shell/data';
import { fetchBlob, hydrateBlobCache } from './useItemData';
import { useConfig } from './shell/context';
import { trashedPathFor } from './file-manager/useTrash';
import { createCommitMutation } from './shell/useCommitFileChanges';
import { FormatInfo, getEntryDataFilepath, getPathPrefix } from './path-utils';
import {
  getTreeNodeAtPath,
  TreeEntry,
  TreeNode,
  treeSha,
  updateTreeWithChanges,
} from './trees';
import {
  appendRedirect,
  parseRedirectEntries,
  REDIRECTS_FILE_PATH,
} from './redirects';
import { Config } from '..';
import { getDirectoriesForTreeKey, getTreeKey } from './tree-key';
import { AppSlugContext } from './onboarding/install-app';
import { createUrqlClient } from './provider';
import { serializeProps } from '../form/serialize-props';
import { scopeEntriesWithPathPrefix } from './shell/path-prefix';
import { useRouter } from './router';
import { base64Encode } from '#base64';
import { useEntryUploadSession } from './media-library/upload-session';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

const frontmatterSplit = textEncoder.encode('---\n');

function combineFrontmatterAndContents(
  frontmatter: Uint8Array,
  contents: Uint8Array
) {
  const array = new Uint8Array(
    frontmatter.byteLength +
      contents.byteLength +
      frontmatterSplit.byteLength * 2
  );
  array.set(frontmatterSplit);
  array.set(frontmatter, frontmatterSplit.byteLength);
  array.set(
    frontmatterSplit,
    frontmatterSplit.byteLength + frontmatter.byteLength
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
    true
  );
  let dataContent = textEncoder.encode(dump(stateWithExtraFilesRemoved));

  if (args.format.contentField) {
    const filename = `${args.format.contentField.path.join('/')}${
      args.format.contentField.contentExtension
    }`;
    let contents: undefined | Uint8Array;
    extraFiles = extraFiles.filter(x => {
      if (x.path !== filename) return true;
      contents = x.contents;
      return false;
    });
    assert(contents !== undefined, 'Expected content field to be present');
    dataContent = combineFrontmatterAndContents(dataContent, contents);
  }

  return [
    {
      path: getEntryDataFilepath(args.basePath, args.format),
      contents: dataContent,
    },
    ...extraFiles.map(file => ({
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
// serialized `redirects/index.yaml` addition (path already prefixed). Shared by
// item save (rename) and delete so the 301 lands in the *same* commit / `/update`
// call as the change that killed the old URL — no drift if the commit fails.
// Works for both storage kinds via the existing `fetchBlob` path.
async function buildRedirectAddition(args: {
  config: Config;
  unscopedTree: Map<string, TreeNode>;
  pathPrefix: string;
  redirect: { from: string; to: string };
  baseCommit: string;
  repoInfo: { owner: string; name: string; isPrivate: boolean } | null;
  rootPath: string;
}): Promise<{ path: string; contents: Uint8Array }> {
  const path = args.pathPrefix + REDIRECTS_FILE_PATH;
  let entries = parseRedirectEntries(null);
  const existing = getTreeNodeAtPath(args.unscopedTree, path);
  if (existing?.entry.type === 'blob' && existing.entry.sha) {
    const bytes = await fetchBlob(
      args.config,
      existing.entry.sha,
      path,
      args.baseCommit,
      args.repoInfo,
      args.rootPath
    );
    entries = parseRedirectEntries(load(textDecoder.decode(bytes)));
  }
  const nextEntries = appendRedirect(entries, args.redirect);
  const contents = textEncoder.encode(dump({ entries: nextEntries }));
  return { path, contents };
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
    | { kind: 'idle' }
    | { kind: 'updated'; commitOid?: string }
    | { kind: 'loading' }
    | { kind: 'needs-fork' }
    | { kind: 'error'; error: Error }
    | { kind: 'needs-new-branch'; reason: string }
  >({
    kind: 'idle',
  });
  const baseCommit = useBaseCommit();
  const currentBranch = useCurrentBranch();
  const setTreeSha = useSetTreeSha();
  const [, mutate] = useMutation(createCommitMutation);
  const repoInfo = useRepoInfo();
  const appSlug = useContext(AppSlugContext);
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
      try {
        const unscopedTree =
          unscopedTreeData.kind === 'loaded'
            ? unscopedTreeData.data.tree
            : undefined;
        if (!unscopedTree) return false;
        if (
          args.config.storage.kind === 'github' &&
          repoInfo &&
          !repoInfo.hasWritePermission &&
          appSlug?.value
        ) {
          setState({ kind: 'needs-fork' });
          return false;
        }
        setState({ kind: 'loading' });

        const pathPrefix = getPathPrefix(args.config.storage) ?? '';
        let additions = serializeEntryToFiles({
          basePath: args.basePath,
          schema: args.schema,
          format: args.format,
          state: args.state,
          slug: args.slug,
        }).map(addition => ({
          ...addition,
          path: pathPrefix + addition.path,
        }));

        const additionPathToSha = new Map(
          await Promise.all(
            additions.map(
              async addition =>
                [
                  addition.path,
                  await hydrateBlobCache(addition.contents),
                ] as const
            )
          )
        );

        const filesToDelete = new Set(
          args.initialFiles?.map(x => pathPrefix + x)
        );
        for (const file of additions) {
          filesToDelete.delete(file.path);
        }

        // sweep uploads made this session (via the media library dialog,
        // for a cover/collection image or a content image) that never made
        // it into the final saved state — e.g. the user picked a different
        // image afterwards, or deleted the content node before saving. A
        // tracked path counts as still referenced if it's one of this
        // save's own additions (an entry-local *embedded* content image
        // that's still in the doc becomes its own addition — see
        // serializeProps's `formKind === 'content'` handling) or appears as
        // a literal substring of the serialized output (image/images/
        // file/files field values, and content's *library*-referenced
        // image `src`s, are always written with a leading '/' — see
        // FileManagerRoot.resolvePicks and html/serialize.ts's image case).
        const trackedPaths = uploadSession.paths();
        if (trackedPaths.length) {
          const additionPaths = new Set(additions.map(a => a.path));
          const combinedText = additions
            .map(a => textDecoder.decode(a.contents))
            .join('\n');
          for (const path of trackedPaths) {
            const prefixed = pathPrefix + path;
            if (!additionPaths.has(prefixed) && !combinedText.includes(`/${path}`)) {
              filesToDelete.add(prefixed);
            }
          }
        }

        additions = additions.filter(addition => {
          const sha = additionPathToSha.get(addition.path)!;
          const existing = getTreeNodeAtPath(unscopedTree, addition.path);
          return existing?.entry.sha !== sha;
        });

        // Rename with a requested redirect: fold `from → to` into
        // redirects/index.yaml in this same commit/`/update` call, so the
        // 301 table never drifts out of sync with the rename that created it.
        // Added after the unchanged-blob filter above (which it deliberately
        // bypasses) since it's always a real content change when requested.
        if (override?.redirect) {
          additions.push(
            await buildRedirectAddition({
              config: args.config,
              unscopedTree,
              pathPrefix,
              redirect: override.redirect,
              baseCommit: override?.sha ?? baseCommit,
              repoInfo,
              rootPath,
            })
          );
        }

        const deletions: { path: string }[] = [...filesToDelete].map(path => ({
          path,
        }));
        const updatedTree = await updateTreeWithChanges(unscopedTree, {
          additions,
          deletions: [...filesToDelete],
        });
        await hydrateTreeCacheWithEntries(updatedTree.entries);
        if (args.config.storage.kind === 'github') {
          if (!repoInfo) {
            throw new Error('Repo info not loaded');
          }
          const branch = {
            branchName: override?.branch ?? currentBranch,
            repositoryNameWithOwner: `${repoInfo.owner}/${repoInfo.name}`,
          };
          const runMutation = (expectedHeadOid: string) =>
            mutate({
              input: {
                branch,
                expectedHeadOid,
                message: { headline: `Update ${args.basePath}` },
                fileChanges: {
                  additions: additions.map(addition => ({
                    ...addition,
                    contents: base64Encode(addition.contents),
                  })),
                  deletions,
                },
              },
            });
          let result = await runMutation(override?.sha ?? baseCommit);
          const gqlError = result.error?.graphQLErrors[0]?.originalError;
          if (gqlError && 'type' in gqlError) {
            if (gqlError.type === 'BRANCH_PROTECTION_RULE_VIOLATION') {
              setState({
                kind: 'needs-new-branch',
                reason:
                  'Changes must be made via pull request to this branch. Create a new branch to save changes.',
              });
              return false;
            }
            if (gqlError.type === 'STALE_DATA') {
              // we don't want this to go into the cache yet
              // so we create a new client just for this
              const refData = await createUrqlClient(args.config, rootPath)
                .query(FetchRef, {
                  owner: repoInfo.owner,
                  name: repoInfo.name,
                  ref: `refs/heads/${currentBranch}`,
                })
                .toPromise();
              if (!refData.data?.repository?.ref?.target) {
                throw new Error('Branch not found');
              }

              const tree = scopeEntriesWithPathPrefix(
                await fetchGitHubTreeData(
                  refData.data.repository.ref.target.oid,
                  args.config,
                  rootPath
                ),
                args.config
              );
              const treeKey = getTreeKey(
                getDirectoriesForTreeKey(
                  fields.object(args.schema),
                  args.basePath,
                  args.slug?.value,
                  args.format
                ),
                tree.tree
              );
              if (treeKey === args.currentLocalTreeKey) {
                result = await runMutation(
                  refData.data.repository.ref.target.oid
                );
              } else {
                setState({
                  kind: 'needs-new-branch',
                  reason:
                    'This entry has been updated since it was opened. Create a new branch to save changes.',
                });
                return false;
              }
            }
          }

          if (
            result.error?.graphQLErrors.some(
              err =>
                'type' in err &&
                err.type === 'FORBIDDEN' &&
                err.message === 'Resource not accessible by integration'
            )
          ) {
            throw new Error(
              `The GitHub App is unable to commit to the repository. Please ensure that the drystack GitHub App is installed in the GitHub repository ${repoInfo.owner}/${repoInfo.name}`
            );
          }

          if (result.error) {
            throw result.error;
          }
          const target = result.data?.createCommitOnBranch?.ref?.target;
          if (target) {
            uploadSession.clear();
            setState({ kind: 'updated', commitOid: target.oid });
            return true;
          }
          throw new Error('Failed to update');
        } else {
          const res = await fetch(`/api${rootPath}/update`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'no-cors': '1',
            },
            body: JSON.stringify({
              additions: additions.map(addition => ({
                ...addition,
                contents: base64Encode(addition.contents),
              })),
              deletions,
            }),
          });
          if (!res.ok) {
            throw new Error(await res.text());
          }
          const newTree: TreeEntry[] = await res.json();
          const { tree } = await hydrateTreeCacheWithEntries(newTree);
          setTreeSha(await treeSha(tree));
          uploadSession.clear();
          setState({ kind: 'updated' });
          return true;
        }
      } catch (err) {
        setState({ kind: 'error', error: err as Error });
        return false;
      }
    },
    () => {
      setState({ kind: 'idle' });
    },
  ] as const;
}

export function useDeleteItem(args: {
  basePath: string;
  initialFiles: string[];
  storage: Config['storage'];
}) {
  const [state, setState] = useState<
    | { kind: 'idle' }
    | { kind: 'updated' }
    | { kind: 'loading' }
    | { kind: 'needs-fork' }
    | { kind: 'error'; error: Error }
  >({
    kind: 'idle',
  });
  const baseCommit = useBaseCommit();
  const currentBranch = useCurrentBranch();

  const [, mutate] = useMutation(createCommitMutation);
  const setTreeSha = useSetTreeSha();
  const repoInfo = useRepoInfo();
  const appSlug = useContext(AppSlugContext);
  const unscopedTreeData = useCurrentUnscopedTree();
  const { basePath: rootPath } = useRouter();
  const config = useConfig();

  return [
    state,
    async (opts?: { redirect?: { from: string; to: string } }) => {
      try {
        const unscopedTree =
          unscopedTreeData.kind === 'loaded'
            ? unscopedTreeData.data.tree
            : undefined;
        if (!unscopedTree) return false;
        if (
          args.storage.kind === 'github' &&
          repoInfo &&
          !repoInfo.hasWritePermission &&
          appSlug?.value
        ) {
          setState({ kind: 'needs-fork' });
          return false;
        }
        setState({ kind: 'loading' });
        const prefix = getPathPrefix(args.storage) ?? '';
        // everything the schema knows about, plus every other file that
        // happens to live under this entry's own directory (e.g. orphaned
        // local-media uploads the schema never referenced) — deleting an
        // entry should take its whole folder with it
        const entryDirPrefix = `${prefix}${args.basePath}/`;
        const cascadeDeletions =
          unscopedTreeData.kind === 'loaded'
            ? [...unscopedTreeData.data.entries.values()]
                .filter(
                  entry =>
                    entry.type === 'blob' && entry.path.startsWith(entryDirPrefix)
                )
                .map(entry => entry.path)
            : [];
        const deletions = [
          ...new Set([
            ...args.initialFiles.map(x => prefix + x),
            ...cascadeDeletions,
          ]),
        ];
        // deleting an entry the user wants redirected: fold it into
        // redirects/index.yaml in this same commit/`/update` call, exactly
        // like the rename path in useUpsertItem above.
        const redirectAddition = opts?.redirect
          ? await buildRedirectAddition({
              config,
              unscopedTree,
              pathPrefix: prefix,
              redirect: opts.redirect,
              baseCommit,
              repoInfo,
              rootPath,
            })
          : undefined;
        const updatedTree = await updateTreeWithChanges(unscopedTree, {
          additions: redirectAddition ? [redirectAddition] : [],
          deletions,
        });
        await hydrateTreeCacheWithEntries(updatedTree.entries);
        if (args.storage.kind === 'github') {
          if (!repoInfo) {
            throw new Error('Repo info not loaded');
          }
          const { error } = await mutate({
            input: {
              branch: {
                repositoryNameWithOwner: `${repoInfo.owner}/${repoInfo.name}`,
                branchName: currentBranch,
              },
              message: { headline: `Delete ${args.basePath}` },
              expectedHeadOid: baseCommit,
              fileChanges: {
                additions: redirectAddition
                  ? [
                      {
                        ...redirectAddition,
                        contents: base64Encode(redirectAddition.contents),
                      },
                    ]
                  : [],
                deletions: deletions.map(path => ({ path })),
              },
            },
          });
          if (
            error?.graphQLErrors.some(
              err =>
                'type' in err &&
                err.type === 'FORBIDDEN' &&
                err.message === 'Resource not accessible by integration'
            )
          ) {
            throw new Error(
              `The GitHub App is unable to commit to the repository. Please ensure that the drystack GitHub App is installed in the GitHub repository ${repoInfo.owner}/${repoInfo.name}`
            );
          }
          if (error) {
            throw error;
          }
          setState({ kind: 'updated' });
          return true;
        } else {
          // local storage: move the whole entry into the trash instead of
          // deleting it outright, so it can be restored from the File
          // Manager — emulated as one request that both rewrites the bytes
          // at their `.deleted/...` path and removes the originals
          const additions = (
            await Promise.all(
              deletions.map(async path => {
                const sha = getTreeNodeAtPath(unscopedTree, path)?.entry.sha;
                if (!sha) return null;
                const contents = await fetchBlob(
                  config,
                  sha,
                  path,
                  baseCommit,
                  repoInfo,
                  rootPath
                );
                return {
                  path: trashedPathFor(path),
                  contents: base64Encode(contents),
                };
              })
            )
          ).filter((x): x is NonNullable<typeof x> => x !== null);
          if (redirectAddition) {
            additions.push({
              path: redirectAddition.path,
              contents: base64Encode(redirectAddition.contents),
            });
          }
          const res = await fetch(`/api${rootPath}/update`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'no-cors': '1',
            },
            body: JSON.stringify({
              additions,
              deletions: deletions.map(path => ({ path })),
            }),
          });
          if (!res.ok) {
            throw new Error(await res.text());
          }
          const newTree: TreeEntry[] = await res.json();
          const { tree } = await hydrateTreeCacheWithEntries(newTree);
          setTreeSha(await treeSha(tree));
          setState({ kind: 'updated' });
          return true;
        }
      } catch (err) {
        setState({ kind: 'error', error: err as Error });
      }
    },
    () => {
      setState({ kind: 'idle' });
    },
  ] as const;
}

const FetchRef = gql`
  query FetchRef($owner: String!, $name: String!, $ref: String!) {
    repository(owner: $owner, name: $name) {
      id
      ref(qualifiedName: $ref) {
        id
        target {
          id
          oid
        }
      }
    }
  }
` as import('../../__generated__/ts-gql/FetchRef').type;
