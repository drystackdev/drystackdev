// VEI-native Deploy — the visual editor's port of the admin's useDeploy
// (packages/drystack/src/app/deploy/useDeploy.ts). Merges the current brand
// branch into the repo's default branch with the same client-side 3-way merge,
// commits once, rotates to a fresh brand, then tracks the Cloudflare build.
//
// The editor is a standalone React tree with no admin context, so this talks to
// GitHub directly using the raw helpers already in save.ts (token/parse/gql/
// base64) and the pure, shared modules from @drystack/core (merge logic, brand
// store/label, build status). Unlike the admin, there is NO conflict-resolution
// UI here: on a real merge conflict we stop and tell the user to deploy from the
// admin panel instead (a deliberate scope choice).
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Config } from '@drystack/core';
import { toastQueue } from '@keystar/ui/toast';
import { watchBuildStatus } from '@drystack/core/build-status';
import { classifyChanges, merge3Text } from '@drystack/core/deploy-merge';
import {
  readBrandRecord,
  writeBrandRecord,
  removeBrandRecord,
  type BrandRecord,
} from '@drystack/core/brand-store';
import { formatBrandLabel, formatBrandRef } from '@drystack/core/brand-label';
import {
  getGithubToken,
  parseRepo,
  githubGraphQL,
  base64Encode,
  decodeBase64ToBytes,
  GithubGraphQLError,
} from './save';

const GH_API = 'https://api.github.com';
const textDecoder = new TextDecoder();
const textEncoder = new TextEncoder();
const MAX_STALE_DATA_RETRIES = 5;

type TreeEntry = { path: string; mode: string; type: 'tree' | 'blob'; sha: string };

function ghFetch(token: string, path: string) {
  return fetch(`${GH_API}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
    },
  });
}

// Full recursive tree as a path→entry map — exactly the shape classifyChanges
// wants (it only reads each entry's `sha`/`type`).
async function fetchTreeEntries(
  token: string,
  owner: string,
  name: string,
  treeSha: string
): Promise<Map<string, TreeEntry>> {
  const res = await ghFetch(
    token,
    `/repos/${owner}/${name}/git/trees/${treeSha}?recursive=1`
  );
  if (!res.ok) throw new Error('Không đọc được cây file từ GitHub.');
  const json = (await res.json()) as {
    truncated?: boolean;
    tree?: Array<{ path: string; mode: string; type: string; sha: string }>;
  };
  if (json.truncated) {
    throw new Error(
      'Repo quá lớn để deploy từ trình sửa trực tiếp — hãy deploy từ trang admin.'
    );
  }
  const entries = new Map<string, TreeEntry>();
  for (const it of json.tree ?? []) {
    entries.set(it.path, {
      path: it.path,
      mode: it.mode,
      type: it.type === 'tree' ? 'tree' : 'blob',
      sha: it.sha,
    });
  }
  return entries;
}

async function fetchBlobBytes(
  token: string,
  owner: string,
  name: string,
  sha: string
): Promise<Uint8Array> {
  const res = await ghFetch(token, `/repos/${owner}/${name}/git/blobs/${sha}`);
  if (!res.ok) throw new Error('Không đọc được nội dung file từ GitHub.');
  const json = (await res.json()) as { content: string };
  return decodeBase64ToBytes(json.content);
}

async function readTextIfPresent(
  token: string,
  owner: string,
  name: string,
  entry: TreeEntry | undefined
): Promise<string> {
  if (!entry) return '';
  return textDecoder.decode(await fetchBlobBytes(token, owner, name, entry.sha));
}

// One query for everything a merge needs: viewer identity (for the next
// brand's label/ref), the repo id (createRef), and fresh default-branch + brand
// refs (commit + tree oids, plus the brand ref's node id for deleteRef).
const RefsQuery = `
  query VeiDeployRefs($owner: String!, $name: String!, $brandRef: String!) {
    viewer { login name }
    repository(owner: $owner, name: $name) {
      id
      defaultBranchRef {
        name
        target { oid ... on Commit { tree { oid } } }
      }
      brand: ref(qualifiedName: $brandRef) {
        id
        target { oid ... on Commit { tree { oid } } }
      }
    }
  }
`;

// Selects the new commit's tree oid (unlike save.ts's commit mutation) so the
// rotated brand can record it as its base tree.
const CreateCommitMutation = `
  mutation VeiCreateCommit($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      ref { id target { oid ... on Commit { tree { oid } } } }
    }
  }
`;

const DeleteRefMutation = `
  mutation VeiDeleteRef($refId: ID!) {
    deleteRef(input: { refId: $refId }) { clientMutationId }
  }
`;

const CreateRefMutation = `
  mutation VeiCreateRef($input: CreateRefInput!) {
    createRef(input: $input) { ref { id } }
  }
`;

export type DeployOutcome =
  | { status: 'committed'; commitOid: string; newBrand: BrandRecord | null }
  | { status: 'conflict' }
  | { status: 'nothing' };

// Runs one deploy end-to-end (merge → commit → brand rotation), retrying from
// scratch only when the default branch moves under us (STALE_DATA). Throws on
// hard failures; returns a discriminated outcome the hook turns into UI.
async function runDeploy(
  config: Config<any, any>,
  setLabel: (label: string) => void
): Promise<DeployOutcome> {
  const token = getGithubToken();
  if (!token) throw new Error('Chưa đăng nhập GitHub.');
  const storage = config.storage as {
    repo: string | { owner: string; name: string };
    branchPrefix?: string;
  };
  const brand = await readBrandRecord(config as any);
  if (!brand) throw new Error('Chưa có brand để deploy — mở admin để khởi tạo.');
  const { owner, name } = parseRepo(storage.repo);

  async function attempt(): Promise<DeployOutcome | 'retry'> {
    setLabel('Đang tải thay đổi…');
    const data = await githubGraphQL(token!, RefsQuery, {
      owner,
      name,
      brandRef: `refs/heads/${brand!.ref}`,
    });
    const repo = data?.repository;
    const login: string | undefined = data?.viewer?.login;
    const viewerName: string = data?.viewer?.name ?? login ?? 'editor';
    const mainRef = repo?.defaultBranchRef;
    const brandRefNode = repo?.brand;
    if (!repo?.id || !mainRef?.target?.oid || !mainRef?.target?.tree?.oid) {
      throw new Error('Không tìm thấy nhánh mặc định.');
    }
    if (!brandRefNode?.id || !brandRefNode?.target?.oid || !brandRefNode?.target?.tree?.oid) {
      throw new Error('Brand hiện tại không còn tồn tại — vui lòng tải lại trang.');
    }
    if (!login) throw new Error('Không xác định được người dùng GitHub.');

    const defaultBranchName: string = mainRef.name;
    const mainCommit: string = mainRef.target.oid;
    const mainTree: string = mainRef.target.tree.oid;
    const brandRefId: string = brandRefNode.id;
    const brandTree: string = brandRefNode.target.tree.oid;

    const [baseEntries, oursEntries, theirsEntries] = await Promise.all([
      fetchTreeEntries(token!, owner, name, brand!.baseTreeSha),
      fetchTreeEntries(token!, owner, name, brandTree),
      fetchTreeEntries(token!, owner, name, mainTree),
    ]);

    const cls = classifyChanges(baseEntries, oursEntries, theirsEntries);

    const additions: { path: string; contents: Uint8Array }[] = [];
    const deletions: { path: string }[] = cls.takeOursDeletions.map(path => ({
      path,
    }));

    setLabel('Đang tải nội dung thay đổi…');
    await Promise.all(
      cls.takeOursAdditions.map(async path => {
        const entry = oursEntries.get(path)!;
        additions.push({
          path,
          contents: await fetchBlobBytes(token!, owner, name, entry.sha),
        });
      })
    );

    if (cls.conflictEligible.length > 0) {
      setLabel('Đang kiểm tra xung đột…');
      for (const path of cls.conflictEligible) {
        const [baseText, oursText, theirsText] = await Promise.all([
          readTextIfPresent(token!, owner, name, baseEntries.get(path)),
          readTextIfPresent(token!, owner, name, oursEntries.get(path)),
          readTextIfPresent(token!, owner, name, theirsEntries.get(path)),
        ]);
        const merged = merge3Text(oursText, baseText, theirsText);
        if (merged.kind === 'conflict') {
          // Block-and-redirect: no resolution UI in the visual editor.
          return { status: 'conflict' };
        }
        if (merged.content === '') deletions.push({ path });
        else additions.push({ path, contents: textEncoder.encode(merged.content) });
      }
    }

    if (additions.length === 0 && deletions.length === 0) {
      return { status: 'nothing' };
    }

    setLabel('Đang deploy…');
    let commitData;
    try {
      commitData = await githubGraphQL(token!, CreateCommitMutation, {
        input: {
          branch: {
            repositoryNameWithOwner: `${owner}/${name}`,
            branchName: defaultBranchName,
          },
          expectedHeadOid: mainCommit,
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
    } catch (err) {
      if (err instanceof GithubGraphQLError && err.type === 'STALE_DATA') {
        return 'retry'; // default branch moved while we merged — redo from scratch
      }
      throw err;
    }

    const target = commitData?.createCommitOnBranch?.ref?.target;
    const newCommitOid: string | undefined = target?.oid;
    const newTreeOid: string | undefined = target?.tree?.oid;
    if (!newCommitOid || !newTreeOid) {
      throw new Error('Deploy thất bại — không nhận được commit mới.');
    }

    // Rotate the brand like the admin does: drop the merged branch, create a
    // fresh one off the new default-branch HEAD. Best-effort — the deploy commit
    // has already landed, so a rotation hiccup just leaves the admin's brand
    // guard to recreate one on its next visit rather than failing the deploy.
    let newBrand: BrandRecord | null = null;
    try {
      await githubGraphQL(token!, DeleteRefMutation, { refId: brandRefId });
      await removeBrandRecord(config as any);
      const now = new Date();
      const newRef = formatBrandRef(storage.branchPrefix, now, login);
      const created = await githubGraphQL(token!, CreateRefMutation, {
        input: {
          name: `refs/heads/${newRef}`,
          oid: newCommitOid,
          repositoryId: repo.id,
        },
      });
      if (created?.createRef?.ref?.id) {
        newBrand = {
          ref: newRef,
          label: formatBrandLabel(now, viewerName, 'Editor'),
          login,
          createdAt: now.getTime(),
          baseCommitOid: newCommitOid,
          baseTreeSha: newTreeOid,
        };
        await writeBrandRecord(config as any, newBrand);
      }
    } catch {
      newBrand = null;
    }

    return { status: 'committed', commitOid: newCommitOid, newBrand };
  }

  for (let i = 0; i < MAX_STALE_DATA_RETRIES; i++) {
    const result = await attempt();
    if (result !== 'retry') return result;
  }
  throw new Error('Nhánh mặc định thay đổi liên tục — vui lòng thử lại.');
}

export type VeiDeployState =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string }
  | { kind: 'building'; label: string };

// Editor-local controller for the deploy pill: exposes the current brand (for
// the date-stripped label), a busy label for the button, and deploy().
export function useVeiDeploy(config: Config<any, any>) {
  const isGithub = config.storage.kind === 'github';
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [state, setState] = useState<VeiDeployState>({ kind: 'idle' });
  const buildStopRef = useRef<(() => void) | null>(null);

  const refreshBrand = useCallback(async () => {
    if (!isGithub) {
      setBrand(null);
      return;
    }
    try {
      setBrand((await readBrandRecord(config as any)) ?? null);
    } catch {
      // IndexedDB read failed — leave whatever we had.
    }
  }, [config, isGithub]);

  useEffect(() => {
    refreshBrand();
  }, [refreshBrand]);

  // Stop tracking a build if the editor unmounts mid-deploy.
  useEffect(() => () => buildStopRef.current?.(), []);

  const deploy = useCallback(async () => {
    if (!isGithub || state.kind !== 'idle') return;
    setState({ kind: 'loading', label: 'Đang tải thay đổi…' });
    let outcome: DeployOutcome;
    try {
      outcome = await runDeploy(config, label =>
        setState({ kind: 'loading', label })
      );
    } catch (err) {
      setState({ kind: 'idle' });
      toastQueue.critical(err instanceof Error ? err.message : 'Deploy thất bại.', {
        timeout: 6000,
      });
      return;
    }

    if (outcome.status === 'conflict') {
      setState({ kind: 'idle' });
      toastQueue.info(
        'Có xung đột giữa brand và nhánh chính — hãy mở admin để xử lý và deploy.',
        { timeout: 8000 }
      );
      return;
    }
    if (outcome.status === 'nothing') {
      setState({ kind: 'idle' });
      toastQueue.info('Không có thay đổi nào để deploy.', { timeout: 4000 });
      return;
    }

    // Committed — reflect the rotated brand immediately, then track the build.
    setBrand(outcome.newBrand);
    setState({ kind: 'building', label: 'Đang chờ build…' });
    const finish = (toast: () => void) => {
      buildStopRef.current = null;
      setState({ kind: 'idle' });
      toast();
    };
    buildStopRef.current?.();
    buildStopRef.current = watchBuildStatus(outcome.commitOid, update => {
      if (update.kind === 'label') {
        setState({ kind: 'building', label: update.label });
        return;
      }
      if (update.kind === 'phase' && update.phase === 'started') {
        setState({ kind: 'building', label: 'Đang cài đặt dependencies…' });
        return;
      }
      if (update.kind === 'timeout') {
        finish(() =>
          toastQueue.info('Build đang lâu hơn bình thường — kiểm tra lại sau.', {
            timeout: 8000,
          })
        );
        return;
      }
      if (update.kind === 'phase') {
        finish(() => {
          if (update.phase === 'succeeded') {
            toastQueue.positive('Nội dung đã được publish', { timeout: 4000 });
          } else {
            toastQueue.critical(
              'Build thất bại — thay đổi vẫn được lưu trên GitHub, thử lại sau.',
              { timeout: 8000 }
            );
          }
        });
      }
    });
  }, [config, isGithub, state.kind]);

  const isBusy = state.kind !== 'idle';
  const label = state.kind === 'idle' ? 'Deploy' : state.label;

  return { brand, state, deploy, refreshBrand, isBusy, label };
}
