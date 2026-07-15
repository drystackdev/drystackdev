// VEI-native Deploy — the visual editor's port of the admin's useDeploy
// (packages/drystack/src/app/deploy/useDeploy.ts). Merges the current brand
// branch into the repo's default branch with the same client-side 3-way merge,
// commits once, then rotates to a fresh brand. That's it — whether Cloudflare
// actually builds it is shown separately by the toolbar's own status icon
// (Toolbar.tsx, via useLatestBuildStatus), not tracked here.
//
// The editor is a standalone React tree with no admin context, so this talks to
// GitHub directly using the raw helpers already in save.ts (token/parse/gql/
// base64) and the pure, shared modules from @drystack/core (merge logic, brand
// store/label). Unlike the admin, there is NO conflict-resolution UI here: on a
// real merge conflict we stop and tell the user to deploy from the admin panel
// instead (a deliberate scope choice).
import { useCallback, useEffect, useState } from 'react';
import type { Config } from '@drystack/core';
import { toastQueue } from '@keystar/ui/toast';
import { classifyChanges, merge3Text } from '@drystack/core/deploy-merge';
import { fetchMergeBase } from '@drystack/core/deploy-merge-base';
import { readBrandRecord, removeBrandRecord, type BrandRecord } from '@drystack/core/brand-store';
import {
  getGithubTokenWithRefresh,
  parseRepo,
  githubGraphQL,
  base64Encode,
  decodeBase64ToBytes,
  GithubGraphQLError,
  createBrandRaw,
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

// Cheap enough to run every time the deploy pill opens: two oids, no tree
// walk. Used only to decide whether the Deploy button should be clickable —
// the real merge (runDeploy above) always re-fetches fresh refs of its own,
// so a stale answer here just means a wasted click, never a bad merge.
const HasChangesQuery = `
  query VeiDeployHasChanges($owner: String!, $name: String!, $brandRef: String!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef { target { oid } }
      brand: ref(qualifiedName: $brandRef) { target { oid } }
    }
  }
`;

async function checkHasChanges(
  config: Config<any, any>,
  brand: BrandRecord
): Promise<boolean> {
  const token = await getGithubTokenWithRefresh(config);
  if (!token) return true; // can't tell — don't block the button on it
  const storage = config.storage as { repo: string | { owner: string; name: string } };
  const { owner, name } = parseRepo(storage.repo);
  try {
    const data = await githubGraphQL(token, HasChangesQuery, {
      owner,
      name,
      brandRef: `refs/heads/${brand.ref}`,
    });
    const mainOid = data?.repository?.defaultBranchRef?.target?.oid;
    const brandOid = data?.repository?.brand?.target?.oid;
    if (!mainOid || !brandOid) return true;
    return mainOid !== brandOid;
  } catch {
    return true; // fail open — a broken check shouldn't block a real deploy
  }
}

const CreateCommitMutation = `
  mutation VeiCreateCommit($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      ref { id target { oid } }
    }
  }
`;

const DeleteRefMutation = `
  mutation VeiDeleteRef($refId: ID!) {
    deleteRef(input: { refId: $refId }) { clientMutationId }
  }
`;

export type DeployOutcome =
  | { status: 'committed'; commitOid: string; branch: string; newBrand: BrandRecord | null }
  | { status: 'conflict' }
  | { status: 'nothing' };

// Runs one deploy end-to-end (merge → commit → brand rotation), retrying from
// scratch only when the default branch moves under us (STALE_DATA). Throws on
// hard failures; returns a discriminated outcome the hook turns into UI.
async function runDeploy(
  config: Config<any, any>,
  setLabel: (label: string) => void
): Promise<DeployOutcome> {
  const token = await getGithubTokenWithRefresh(config);
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
    const brandCommit: string = brandRefNode.target.oid;
    const brandTree: string = brandRefNode.target.tree.oid;

    // Ask git where the brand actually diverged, every time — a base guessed
    // from "main's HEAD today" makes the merge below roll main back to the
    // brand's tree (see @drystack/core/deploy-merge-base). Throwing aborts the
    // deploy rather than committing against a base we aren't sure of.
    const mergeBase = await fetchMergeBase(
      token!,
      `${owner}/${name}`,
      mainCommit,
      brandCommit
    );

    const [baseEntries, oursEntries, theirsEntries] = await Promise.all([
      fetchTreeEntries(token!, owner, name, mergeBase.treeSha),
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

    const newCommitOid: string | undefined =
      commitData?.createCommitOnBranch?.ref?.target?.oid;
    if (!newCommitOid) {
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
      newBrand = await createBrandRaw(config, {
        token: token!,
        repositoryId: repo.id,
        login,
        viewerName,
        branchPrefix: storage.branchPrefix,
        fromOid: newCommitOid,
      });
    } catch {
      newBrand = null;
    }

    return { status: 'committed', commitOid: newCommitOid, branch: defaultBranchName, newBrand };
  }

  for (let i = 0; i < MAX_STALE_DATA_RETRIES; i++) {
    const result = await attempt();
    if (result !== 'retry') return result;
  }
  throw new Error('Nhánh mặc định thay đổi liên tục — vui lòng thử lại.');
}

export type VeiDeployState =
  | { kind: 'idle' }
  | { kind: 'loading'; label: string };

// Editor-local controller for the deploy pill: exposes the current brand (for
// the date-stripped label), a busy label for the button, and deploy(). Only
// covers the merge itself — Cloudflare build progress is a separate concern,
// shown by the toolbar's own status icon (useLatestBuildStatus).
export function useVeiDeploy(config: Config<any, any>) {
  const isGithub = config.storage.kind === 'github';
  const [brand, setBrand] = useState<BrandRecord | null>(null);
  const [state, setState] = useState<VeiDeployState>({ kind: 'idle' });
  // Fails open (true) while unknown so the button isn't disabled on a flash
  // of missing data — checkHasChanges re-settles it moments later.
  const [hasChanges, setHasChanges] = useState(true);

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

  // Re-runs whenever `brand` changes — on mount, after refreshBrand() picks
  // up a different record (e.g. the deploy pill reopening), and after a
  // deploy rotates to a fresh brand (which trivially has nothing to merge).
  useEffect(() => {
    if (!isGithub || !brand) return;
    let cancelled = false;
    checkHasChanges(config, brand).then(result => {
      if (!cancelled) setHasChanges(result);
    });
    return () => {
      cancelled = true;
    };
  }, [config, isGithub, brand]);

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

    // Committed — reflect the rotated brand and go straight back to idle; the
    // toolbar's status icon takes over showing what Cloudflare does with it.
    setBrand(outcome.newBrand);
    setState({ kind: 'idle' });
    toastQueue.positive('Đã gộp vào main — theo dõi build ở biểu tượng Cloudflare', {
      timeout: 4000,
    });
  }, [config, isGithub, state.kind]);

  const isBusy = state.kind !== 'idle';
  const label = state.kind === 'idle' ? 'Deploy' : state.label;

  return { brand, state, deploy, refreshBrand, isBusy, label, hasChanges };
}
