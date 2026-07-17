// "Brand" = a personal git branch an editor works on in GitHub mode. Entering
// /drystack auto-creates (or reuses) one per repo, all saves commit to it, and
// Deploy (deploy.ts) merges it into the default branch then rotates to a
// fresh brand. See plan/brand.md for the full design.
import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { Config, GitHubConfig } from "../config";
import { getBranchPrefix } from "./utils";
import { useRouter } from "./router";
import { useCreateBranchMutation } from "./branch-selection";
import {
  GitHubAppShellDataContext,
  useBranches,
  useCurrentBranch,
  useRepoInfo,
} from "./shell/data";
import { useViewer } from "./shell/viewer-data";

import {
  readBrandRecord,
  writeBrandRecord,
  removeBrandRecord,
  type BrandRecord,
} from "./brand-store";
import { formatBrandLabel, formatBrandRef } from "./brand-label";

// IndexedDB persistence + brand ref/label generation live in pure, React-free
// modules so the visual editor (VEI) can reuse them over the same origin -
// re-exported here to keep existing admin imports of `../brand` working.
export type { BrandRecord };
export {
  readBrandRecord,
  writeBrandRecord,
  removeBrandRecord,
  formatBrandLabel,
  formatBrandRef,
};

// Reactive current-brand context
// -----------------------------------------------------------------------------
// In-memory source of truth for the session (IndexedDB is only durability) so
// every reader (chip, DeployButton) updates immediately when useEnsureBrandAtRoot
// / useBrandGuard / useDeploy change the brand, without polling IndexedDB.

// Default (no provider, i.e. local mode - BrandProvider only wraps the
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

// Entry point A - /drystack root, before any branch is chosen
// -----------------------------------------------------------------------------
// Reads raw refs off GitHubAppShellDataContext (BranchesContext/RepoInfoContext
// don't exist yet at this point - those need a currentBranch, which is what
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
      (x) => x?.name === defaultBranchName,
    );
    if (!defaultRef || defaultRef.target?.__typename !== "Commit") return;

    startedRef.current = true;
    (async () => {
      const existing = await readBrandRecord(config);
      if (existing && repo.refs?.nodes?.some((x) => x?.name === existing.ref)) {
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
      });
      if (!record) {
        // mutation failed (e.g. transient network error) - allow a retry on
        // the next data update instead of getting stuck forever.
        startedRef.current = false;
        return;
      }
      setRecord(record);
      push(`${basePath}/branch/${encodeURIComponent(record.ref)}`);
    })();
  }, [shellData, viewer, config, push, basePath, createBranch, setRecord]);
}

// Entry point B - already on /branch/<ref>
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
    // storage kinds - brand only exists in github mode (see plan/brand.md §12).
    // Config's `storage` is a plain union, so narrowing config.storage.kind
    // doesn't narrow the nominal `Config` type itself to `GitHubConfig` (they're
    // separately-defined generic types, not literally A | B) - the cast is
    // safe given the runtime check just above it.
    if (config.storage.kind !== "github") return;
    const githubConfig = config as GitHubConfig;
    if (!repoInfo || !viewer) return;
    if (record?.ref === currentBranch) return;
    if (startedRef.current === currentBranch) return;

    const branchInfo = branches.get(currentBranch);
    if (branchInfo && currentBranch !== repoInfo.defaultBranch) {
      // the URL's branch is a real ref - adopt it into context, reusing the
      // stored record if it matches, otherwise reconstructing one from the ref
      // itself. Nothing here is a guess any more: a record is just a name +
      // who/when, and deploy asks GitHub for the merge base (deploy/merge-base.ts).
      startedRef.current = currentBranch;
      readBrandRecord(githubConfig).then((existing) => {
        if (existing?.ref === currentBranch) {
          setRecord(existing);
          return;
        }
        const fallback: BrandRecord = {
          ref: currentBranch,
          label: currentBranch,
          login: viewer.login,
          createdAt: Date.now(),
        };
        writeBrandRecord(githubConfig, fallback).then(() =>
          setRecord(fallback),
        );
      });
      return;
    }

    // the URL's branch doesn't exist, or is the default branch itself - a
    // brand is always a personal branch, so `main` (or whatever the default
    // branch is called) must never be adopted as one (plan/brand.md §1/§5).
    // If context already holds a different, still-valid brand (e.g. the user
    // hit "back" after Deploy rotated us to a new one, or opened `/branch/main`
    // in a tab that already has a brand), just redirect there instead of
    // creating a needless extra branch - only fall through to creating a
    // fresh one if we truly have nothing valid to fall back on.
    if (
      record &&
      record.ref !== repoInfo.defaultBranch &&
      branches.has(record.ref)
    ) {
      startedRef.current = currentBranch;
      push(`${basePath}/branch/${encodeURIComponent(record.ref)}`);
      return;
    }

    const defaultBranchInfo = branches.get(repoInfo.defaultBranch);
    if (!defaultBranchInfo) return; // default branch itself not loaded yet
    startedRef.current = currentBranch;
    (async () => {
      // in-memory context can be empty on a fresh tab (e.g. landing straight
      // on `/branch/main`) even though IndexedDB already has a valid brand
      // for this repo - reuse it instead of creating a redundant one.
      const existing = await readBrandRecord(githubConfig);
      if (
        existing &&
        existing.ref !== repoInfo.defaultBranch &&
        branches.has(existing.ref)
      ) {
        setRecord(existing);
        push(`${basePath}/branch/${encodeURIComponent(existing.ref)}`);
        return;
      }

      // recreate a fresh brand off the current default branch HEAD and redirect to it.
      const newRecord = await createBrand(githubConfig, {
        createBranch,
        repositoryId: repoInfo.id,
        login: viewer.login,
        name: viewer.name ?? viewer.login,
        defaultBranchCommitOid: defaultBranchInfo.commitSha,
      });
      if (!newRecord) {
        startedRef.current = null;
        return;
      }
      setRecord(newRecord);
      // land on the new brand's root rather than trying to preserve the rest
      // of the path - a deep link into the deleted brand's uncommitted state
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
  },
): Promise<BrandRecord | null> {
  const now = new Date();
  const ref = formatBrandRef(getBranchPrefix(config), now, args.login);
  const label = formatBrandLabel(now, args.name, "Editor");
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
  };
  await writeBrandRecord(config, record);
  return record;
}
