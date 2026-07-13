// Orchestrates Deploy: merges the current brand into the default branch
// (client-side 3-way merge, §6 of plan/brand.md), commits once, rotates to a
// fresh brand, then hands the resulting commit off to DeployButton for build
// tracking. No GitHub merge API involved — see plan/brand.md §2 for why.
import { useCallback, useRef, useState } from 'react';
import { useMutation } from 'urql';
import { gql } from '@ts-gql/tag/no-transform';

import { GitHubConfig } from '../../config';
import { base64Encode } from '#base64';
import { useRouter } from '../router';
import {
  createBrand,
  removeBrandRecord,
  useCurrentBrand,
  useSetBrandRecord,
} from '../brand';
import { useCreateBranchMutation, useDeleteBranchMutation } from '../branch-selection';
import { createCommitMutation } from '../shell/useCommitFileChanges';
import {
  Ref_base,
  fetchGitHubTreeData,
  useCurrentBranch,
  useRepoInfo,
} from '../shell/data';
import { useConfig } from '../shell/context';
import { useViewer } from '../shell/viewer-data';
import { fetchBlob } from '../useItemData';
import { createUrqlClient } from '../provider';
import {
  ChangeClassification,
  Hunk,
  classifyChanges,
  conflictHunkCount,
  merge3Text,
  resolveHunks,
} from './merge3';

export type ConflictFileState = {
  path: string;
  hunks: Hunk[];
  choices: ('ours' | 'theirs' | null)[];
};

export type DeployState =
  | { kind: 'idle'; error?: string }
  | { kind: 'loading'; label: string }
  | { kind: 'conflicts'; files: ConflictFileState[] }
  | { kind: 'merged'; commitOid: string };

type ConflictResolution =
  | { action: 'submit'; files: ConflictFileState[] }
  | { action: 'cancel' };

const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MAX_STALE_DATA_RETRIES = 5;

const FetchBranchRefQuery = gql`
  query FetchBranchRef($owner: String!, $name: String!, $ref: String!) {
    repository(owner: $owner, name: $name) {
      id
      ref(qualifiedName: $ref) {
        ...Ref_base
      }
    }
  }
  ${Ref_base}
` as import('../../../__generated__/ts-gql/FetchBranchRef').type;

async function fetchFreshRef(
  config: GitHubConfig,
  basePath: string,
  owner: string,
  name: string,
  refName: string
): Promise<{ id: string; commitSha: string; treeSha: string } | null> {
  const result = await createUrqlClient(config, basePath)
    .query(FetchBranchRefQuery, { owner, name, ref: `refs/heads/${refName}` })
    .toPromise();
  const ref = result.data?.repository?.ref;
  if (!ref || ref.target?.__typename !== 'Commit') return null;
  return { id: ref.id, commitSha: ref.target.oid, treeSha: ref.target.tree.oid };
}

async function fetchBlobTextIfPresent(
  config: GitHubConfig,
  entry: { sha: string } | undefined,
  path: string,
  commitSha: string,
  repoInfo: { owner: string; name: string; isPrivate: boolean },
  basePath: string
): Promise<string> {
  if (!entry) return '';
  const bytes = await fetchBlob(config, entry.sha, path, commitSha, repoInfo, basePath);
  return textDecoder.decode(bytes);
}

export function useDeploy() {
  const config = useConfig();
  const { push, basePath } = useRouter();
  const repoInfo = useRepoInfo();
  const currentBranch = useCurrentBranch();
  const brand = useCurrentBrand();
  const viewer = useViewer();
  const setRecord = useSetBrandRecord();
  const [, createBranch] = useCreateBranchMutation();
  const [, deleteBranch] = useDeleteBranchMutation();
  const [, commit] = useMutation(createCommitMutation);

  const [state, setState] = useState<DeployState>({ kind: 'idle' });
  // resolved by submitConflicts/cancelConflicts, which read the live (possibly
  // just-edited) file list straight out of state rather than a stale closure
  const conflictResolverRef = useRef<((resolution: ConflictResolution) => void) | null>(
    null
  );

  const setHunkChoice = useCallback(
    (path: string, hunkIndex: number, choice: 'ours' | 'theirs') => {
      setState(prev => {
        if (prev.kind !== 'conflicts') return prev;
        return {
          kind: 'conflicts',
          files: prev.files.map(f =>
            f.path !== path
              ? f
              : {
                  ...f,
                  choices: f.choices.map((c, i) => (i === hunkIndex ? choice : c)),
                }
          ),
        };
      });
    },
    []
  );

  const submitConflicts = useCallback(() => {
    setState(prev => {
      if (prev.kind === 'conflicts') {
        conflictResolverRef.current?.({ action: 'submit', files: prev.files });
      }
      return prev;
    });
  }, []);
  const cancelConflicts = useCallback(() => {
    conflictResolverRef.current?.({ action: 'cancel' });
  }, []);

  const deploy = useCallback(async () => {
    if (config.storage.kind !== 'github' || !repoInfo || !viewer || !brand) {
      return;
    }
    const githubConfig = config as GitHubConfig;
    if (currentBranch !== brand.ref) {
      // shouldn't normally happen (DeployButton only renders once brand is
      // resolved), but guards against deploying the wrong thing
      setState({ kind: 'idle', error: 'Brand chưa sẵn sàng, thử lại sau.' });
      return;
    }

    // One attempt = fetch fresh main+brand refs, classify & merge, commit.
    // Loops only on STALE_DATA (main moved between fetch and commit).
    async function runOneAttempt(): Promise<'done' | 'retry'> {
      const [mainRef, brandRef] = await Promise.all([
        fetchFreshRef(githubConfig, basePath, repoInfo!.owner, repoInfo!.name, repoInfo!.defaultBranch),
        fetchFreshRef(githubConfig, basePath, repoInfo!.owner, repoInfo!.name, brand!.ref),
      ]);
      if (!mainRef) {
        setState({ kind: 'idle', error: 'Không tìm thấy nhánh mặc định.' });
        return 'done';
      }
      if (!brandRef) {
        setState({
          kind: 'idle',
          error: 'Brand hiện tại không còn tồn tại — vui lòng tải lại trang.',
        });
        return 'done';
      }

      const [baseTree, oursTree, theirsTree] = await Promise.all([
        fetchGitHubTreeData(brand!.baseTreeSha, githubConfig, basePath),
        fetchGitHubTreeData(brandRef.treeSha, githubConfig, basePath),
        fetchGitHubTreeData(mainRef.treeSha, githubConfig, basePath),
      ]);

      const classification: ChangeClassification = classifyChanges(
        baseTree.entries,
        oursTree.entries,
        theirsTree.entries
      );

      const additions: { path: string; contents: Uint8Array }[] = [];
      const deletions: { path: string }[] = classification.takeOursDeletions.map(
        path => ({ path })
      );

      setState({ kind: 'loading', label: 'Loading changed files…' });
      await Promise.all(
        classification.takeOursAdditions.map(async path => {
          const entry = oursTree.entries.get(path)!;
          const contents = await fetchBlob(
            githubConfig,
            entry.sha,
            path,
            brandRef.commitSha,
            repoInfo!,
            basePath
          );
          additions.push({ path, contents });
        })
      );

      if (classification.conflictEligible.length > 0) {
        setState({ kind: 'loading', label: 'Checking for conflicts…' });
        const conflictFiles: ConflictFileState[] = [];
        for (const path of classification.conflictEligible) {
          const [baseText, oursText, theirsText] = await Promise.all([
            fetchBlobTextIfPresent(
              githubConfig,
              baseTree.entries.get(path),
              path,
              brand!.baseCommitOid,
              repoInfo!,
              basePath
            ),
            fetchBlobTextIfPresent(
              githubConfig,
              oursTree.entries.get(path),
              path,
              brandRef.commitSha,
              repoInfo!,
              basePath
            ),
            fetchBlobTextIfPresent(
              githubConfig,
              theirsTree.entries.get(path),
              path,
              mainRef.commitSha,
              repoInfo!,
              basePath
            ),
          ]);
          const result = merge3Text(oursText, baseText, theirsText);
          if (result.kind === 'clean') {
            if (result.content === '') {
              deletions.push({ path });
            } else {
              additions.push({ path, contents: textEncoder.encode(result.content) });
            }
          } else {
            conflictFiles.push({
              path,
              hunks: result.hunks,
              choices: new Array(conflictHunkCount(result.hunks)).fill(null),
            });
          }
        }

        if (conflictFiles.length > 0) {
          setState({ kind: 'conflicts', files: conflictFiles });
          const resolution = await new Promise<ConflictResolution>(resolve => {
            conflictResolverRef.current = resolve;
          });
          conflictResolverRef.current = null;
          if (resolution.action === 'cancel') {
            setState({ kind: 'idle' });
            return 'done';
          }
          for (const file of resolution.files) {
            const choices = file.choices.map(c => c ?? 'ours');
            const text = resolveHunks(file.hunks, choices);
            if (text === '') {
              deletions.push({ path: file.path });
            } else {
              additions.push({ path: file.path, contents: textEncoder.encode(text) });
            }
          }
        }
      }

      if (additions.length === 0 && deletions.length === 0) {
        setState({ kind: 'idle', error: 'Không có thay đổi nào để deploy.' });
        return 'done';
      }

      setState({ kind: 'loading', label: 'Deploying…' });
      const result = await commit({
        input: {
          branch: {
            repositoryNameWithOwner: `${repoInfo!.owner}/${repoInfo!.name}`,
            branchName: repoInfo!.defaultBranch,
          },
          expectedHeadOid: mainRef.commitSha,
          message: { headline: `Deploy: ${brand!.label}` },
          fileChanges: {
            additions: additions.map(a => ({
              path: a.path,
              contents: base64Encode(a.contents),
            })),
            deletions,
          },
        },
      });

      const gqlError = result.error?.graphQLErrors[0]?.originalError;
      if (gqlError && 'type' in gqlError && gqlError.type === 'STALE_DATA') {
        return 'retry'; // main moved again while we were merging — redo from scratch
      }
      const target = result.data?.createCommitOnBranch?.ref?.target;
      // createCommitMutation's `target` doesn't select __typename (no
      // existing caller needed it — see shell/useCommitFileChanges.ts), so
      // narrow structurally instead: only the Commit variant selected `tree`.
      if (result.error || !target || !('tree' in target)) {
        setState({
          kind: 'idle',
          error: result.error?.message ?? 'Deploy thất bại.',
        });
        return 'done';
      }

      const newCommitOid = target.oid;

      await deleteBranch({ refId: brandRef.id });
      await removeBrandRecord(githubConfig);
      const newRecord = await createBrand(githubConfig, {
        createBranch,
        repositoryId: repoInfo!.id,
        login: viewer!.login,
        name: viewer!.name ?? viewer!.login,
        defaultBranchCommitOid: newCommitOid,
        defaultBranchTreeSha: target.tree.oid,
      });
      if (newRecord) {
        setRecord(newRecord);
        push(`${basePath}/branch/${encodeURIComponent(newRecord.ref)}`);
      }

      setState({ kind: 'merged', commitOid: newCommitOid });
      return 'done';
    }

    setState({ kind: 'loading', label: 'Preparing deploy…' });
    try {
      for (let attempt = 0; attempt < MAX_STALE_DATA_RETRIES; attempt++) {
        if ((await runOneAttempt()) === 'done') return;
      }
      setState({
        kind: 'idle',
        error: 'Nhánh mặc định thay đổi liên tục — vui lòng thử lại.',
      });
    } catch (err) {
      setState({
        kind: 'idle',
        error: err instanceof Error ? err.message : 'Deploy thất bại.',
      });
    }
  }, [
    config,
    repoInfo,
    viewer,
    brand,
    currentBranch,
    basePath,
    commit,
    createBranch,
    deleteBranch,
    setRecord,
    push,
  ]);

  const reset = useCallback(() => setState({ kind: 'idle' }), []);

  return { state, deploy, setHunkChoice, submitConflicts, cancelConflicts, reset };
}
