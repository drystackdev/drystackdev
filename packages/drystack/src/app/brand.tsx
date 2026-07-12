// "Brand" = a personal git branch an editor works on in GitHub mode. Entering
// /drystack auto-creates (or reuses) one per repo, all saves commit to it, and
// Deploy (deploy.ts) merges it into the default branch then rotates to a
// fresh brand. See plan/brand.md for the full design.
import { UseStore, createStore, get, set, del } from 'idb-keyval';
import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { Config, GitHubConfig } from '../config';
import { getBranchPrefix } from './utils';
import { serializeRepoConfig } from './repo-config';
import { useRouter } from './router';
import { useCreateBranchMutation } from './branch-selection';
import {
  GitHubAppShellDataContext,
  useBranches,
  useCurrentBranch,
  useRepoInfo,
} from './shell/data';
import { useViewer } from './shell/viewer-data';

export type BrandRecord = {
  ref: string;
  label: string;
  login: string;
  createdAt: number;
  baseCommitOid: string;
  baseTreeSha: string;
};

// Persistence (IndexedDB)
// -----------------------------------------------------------------------------

let store: UseStore | undefined;
function getStore(): UseStore {
  if (!store) {
    store = createStore('drystack-brand', 'brands');
  }
  return store;
}

function repoKey(config: GitHubConfig): string {
  return serializeRepoConfig(config.storage.repo);
}

export function readBrandRecord(
  config: GitHubConfig
): Promise<BrandRecord | undefined> {
  return get(repoKey(config), getStore());
}

export function writeBrandRecord(
  config: GitHubConfig,
  record: BrandRecord
): Promise<void> {
  return set(repoKey(config), record, getStore());
}

export function removeBrandRecord(config: GitHubConfig): Promise<void> {
  return del(repoKey(config), getStore());
}

// Label & ref generation
// -----------------------------------------------------------------------------

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function timestampParts(date: Date) {
  return {
    YYYY: date.getFullYear(),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
}

export function formatBrandLabel(
  date: Date,
  name: string,
  role: string
): string {
  const { YYYY, MM, DD, HH, mm, ss } = timestampParts(date);
  return `${YYYY}-${MM}-${DD} - ${HH}:${mm}:${ss} - ${name} - ${role}`;
}

// Allowlist (keep only [a-z0-9-]) rather than denylisting git's invalid-ref
// characters (see branch-selection.tsx) — strictly safer, since it can't miss
// a character git rejects, and it also collapses sequences like ".." or
// trailing ".lock" that a denylist would need to special-case.
function sanitizeRefSegment(input: string): string {
  const s = input
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics, e.g. Vietnamese names
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s || 'editor';
}

export function formatBrandRef(
  config: GitHubConfig,
  date: Date,
  login: string
): string {
  const { YYYY, MM, DD, HH, mm, ss } = timestampParts(date);
  const prefix = getBranchPrefix(config) ?? 'drystack/';
  return `${prefix}${YYYY}-${MM}-${DD}-${HH}${mm}${ss}-${sanitizeRefSegment(login)}`;
}

// Reactive current-brand context
// -----------------------------------------------------------------------------
// In-memory source of truth for the session (IndexedDB is only durability) so
// every reader (chip, DeployButton) updates immediately when useEnsureBrandAtRoot
// / useBrandGuard / useDeploy change the brand, without polling IndexedDB.

// Default (no provider, i.e. local mode — BrandProvider only wraps the
// github-mode tree in ui.tsx) is a safe no-op rather than a throw: BranchNotFound
// (shell/index.tsx) calls useBrandGuard unconditionally for both storage kinds,
// same as it already does for useBranches/useCurrentBranch.
const BrandContext = createContext<{
  record: BrandRecord | null;
  setRecord: (record: BrandRecord | null) => void;
}>({ record: null, setRecord: () => {} });

export function BrandProvider(props: { children: ReactNode }) {
  const [record, setRecord] = useState<BrandRecord | null>(null);
  const value = useMemo(() => ({ record, setRecord }), [record]);
  return (
    <BrandContext.Provider value={value}>
      {props.children}
    </BrandContext.Provider>
  );
}

export function useCurrentBrand(): BrandRecord | null {
  return useContext(BrandContext).record;
}

export function useSetBrandRecord(): (record: BrandRecord | null) => void {
  return useContext(BrandContext).setRecord;
}

// Entry point A — /drystack root, before any branch is chosen
// -----------------------------------------------------------------------------
// Reads raw refs off GitHubAppShellDataContext (BranchesContext/RepoInfoContext
// don't exist yet at this point — those need a currentBranch, which is what
// we're resolving). Reuses the locally-remembered brand if GitHub still has
// it, otherwise creates a fresh one off the default branch HEAD, then
// navigates to it exactly once.

export function useEnsureBrandAtRoot(config: GitHubConfig): void {
  const { push, basePath } = useRouter();
  const viewer = useViewer();
  const shellData = useContext(GitHubAppShellDataContext);
  const setRecord = useSetBrandRecord();
  const [, createBranch] = useCreateBranchMutation();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    const repo = shellData?.data?.repository;
    const defaultBranchName = repo?.defaultBranchRef?.name;
    if (!repo?.id || !defaultBranchName || !viewer) return;
    const defaultRef = repo.refs?.nodes?.find(
      x => x?.name === defaultBranchName
    );
    if (!defaultRef || defaultRef.target?.__typename !== 'Commit') return;

    startedRef.current = true;
    (async () => {
      const existing = await readBrandRecord(config);
      if (existing && repo.refs?.nodes?.some(x => x?.name === existing.ref)) {
        setRecord(existing);
        push(`${basePath}/branch/${encodeURIComponent(existing.ref)}`);
        return;
      }

      const record = await createBrand(config, {
        createBranch,
        repositoryId: repo.id,
        login: viewer.login,
        name: viewer.name ?? viewer.login,
        defaultBranchCommitOid: defaultRef.target!.oid,
        defaultBranchTreeSha:
          defaultRef.target!.__typename === 'Commit'
            ? defaultRef.target!.tree.oid
            : '',
      });
      if (!record) {
        // mutation failed (e.g. transient network error) — allow a retry on
        // the next data update instead of getting stuck forever.
        startedRef.current = false;
        return;
      }
      setRecord(record);
      push(`${basePath}/branch/${encodeURIComponent(record.ref)}`);
    })();
  }, [shellData, viewer, config, push, basePath, createBranch, setRecord]);
}

// Entry point B — already on /branch/<ref>
// -----------------------------------------------------------------------------
// Safety net for: (a) a hard refresh/direct link landing straight on the
// brand branch (in-memory context is empty even though the ref is valid), and
// (b) the remembered brand having been deleted outside the app. Runs inside
// AppShell, where BranchesContext/RepoInfoContext are already populated.

export function useBrandGuard(config: Config): void {
  const { push, basePath } = useRouter();
  const viewer = useViewer();
  const currentBranch = useCurrentBranch();
  const branches = useBranches();
  const repoInfo = useRepoInfo();
  const record = useCurrentBrand();
  const setRecord = useSetBrandRecord();
  const [, createBranch] = useCreateBranchMutation();
  const startedRef = useRef<string | null>(null);

  useEffect(() => {
    // BranchNotFound (shell/index.tsx) calls this unconditionally for both
    // storage kinds — brand only exists in github mode (see plan/brand.md §12).
    // Config's `storage` is a plain union, so narrowing config.storage.kind
    // doesn't narrow the nominal `Config` type itself to `GitHubConfig` (they're
    // separately-defined generic types, not literally A | B) — the cast is
    // safe given the runtime check just above it.
    if (config.storage.kind !== 'github') return;
    const githubConfig = config as GitHubConfig;
    if (!repoInfo || !viewer) return;
    if (record?.ref === currentBranch) return;
    if (startedRef.current === currentBranch) return;

    const branchInfo = branches.get(currentBranch);
    if (branchInfo) {
      // the URL's branch is a real ref — adopt it into context, reusing the
      // stored record if it matches, otherwise reconstructing a best-effort
      // one (base = today's default branch HEAD; see plan/brand.md §16).
      startedRef.current = currentBranch;
      readBrandRecord(githubConfig).then(existing => {
        if (existing?.ref === currentBranch) {
          setRecord(existing);
          return;
        }
        const defaultBranchInfo = branches.get(repoInfo.defaultBranch);
        const fallback: BrandRecord = {
          ref: currentBranch,
          label: currentBranch,
          login: viewer.login,
          createdAt: Date.now(),
          baseCommitOid: defaultBranchInfo?.commitSha ?? branchInfo.commitSha,
          baseTreeSha: defaultBranchInfo?.treeSha ?? branchInfo.treeSha,
        };
        writeBrandRecord(githubConfig, fallback).then(() => setRecord(fallback));
      });
      return;
    }

    // the URL's branch doesn't exist. If context already holds a different,
    // still-valid brand (e.g. the user hit "back" after Deploy rotated us to
    // a new one), just redirect there instead of creating a needless extra
    // branch — only fall through to creating a fresh one if we truly have
    // nothing valid to fall back on.
    if (record && branches.has(record.ref)) {
      startedRef.current = currentBranch;
      push(`${basePath}/branch/${encodeURIComponent(record.ref)}`);
      return;
    }

    // recreate a fresh brand off the current default branch HEAD and redirect to it.
    const defaultBranchInfo = branches.get(repoInfo.defaultBranch);
    if (!defaultBranchInfo) return; // default branch itself not loaded yet
    startedRef.current = currentBranch;
    (async () => {
      const newRecord = await createBrand(githubConfig, {
        createBranch,
        repositoryId: repoInfo.id,
        login: viewer.login,
        name: viewer.name ?? viewer.login,
        defaultBranchCommitOid: defaultBranchInfo.commitSha,
        defaultBranchTreeSha: defaultBranchInfo.treeSha,
      });
      if (!newRecord) {
        startedRef.current = null;
        return;
      }
      setRecord(newRecord);
      // land on the new brand's root rather than trying to preserve the rest
      // of the path — a deep link into the deleted brand's uncommitted state
      // (e.g. an item that only existed there) may not exist on the fresh copy.
      push(`${basePath}/branch/${encodeURIComponent(newRecord.ref)}`);
    })();
  }, [
    repoInfo,
    viewer,
    currentBranch,
    branches,
    record?.ref,
    config,
    push,
    basePath,
    createBranch,
    setRecord,
  ]);
}

// Shared brand creation
// -----------------------------------------------------------------------------
// Exported so deploy.ts can create the next brand right after a successful
// merge, using the same logic as the two guards above.

export async function createBrand(
  config: GitHubConfig,
  args: {
    createBranch: ReturnType<typeof useCreateBranchMutation>[1];
    repositoryId: string;
    login: string;
    name: string;
    defaultBranchCommitOid: string;
    defaultBranchTreeSha: string;
  }
): Promise<BrandRecord | null> {
  const now = new Date();
  const ref = formatBrandRef(config, now, args.login);
  const label = formatBrandLabel(now, args.name, 'Editor');
  const result = await args.createBranch({
    input: {
      name: `refs/heads/${ref}`,
      oid: args.defaultBranchCommitOid,
      repositoryId: args.repositoryId,
    },
  });
  if (!result.data?.createRef?.__typename) {
    return null;
  }
  const record: BrandRecord = {
    ref,
    label,
    login: args.login,
    createdAt: now.getTime(),
    baseCommitOid: args.defaultBranchCommitOid,
    baseTreeSha: args.defaultBranchTreeSha,
  };
  await writeBrandRecord(config, record);
  return record;
}
