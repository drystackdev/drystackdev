// "Brand" = an optional personal git branch an editor can spin up to stage
// changes before merging (NewBranchButton). Brands are opt-in - nothing here
// auto-creates one anymore. Entering /drystack (or losing track of a brand)
// lands you on the repo's default branch instead, and Deploy (deploy.ts)
// merges a brand into the default branch and returns you there rather than
// rotating to a fresh brand. See plan/brand.md for the full design.
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
// it, otherwise lands on the default branch - brands are opt-in
// (NewBranchButton) now, nothing here creates one automatically.

export function useEnsureBrandAtRoot(config: GitHubConfig): void {
  const { push, basePath } = useRouter();
  const viewer = useViewer();
  const shellData = useContext(GitHubAppShellDataContext);
  const setRecord = useSetBrandRecord();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    const repo = shellData?.data?.repository;
    const defaultBranchName = repo?.defaultBranchRef?.name;
    if (!repo?.id || !defaultBranchName || !viewer) return;

    startedRef.current = true;
    (async () => {
      const existing = await readBrandRecord(config);
      if (existing && repo.refs?.nodes?.some((x) => x?.name === existing.ref)) {
        setRecord(existing);
        push(`${basePath}/branch/${encodeURIComponent(existing.ref)}`);
        return;
      }

      // No valid personal brand - land on the default branch instead of
      // auto-creating one. useBrandGuard adopts it once AppShell mounts.
      push(`${basePath}/branch/${encodeURIComponent(defaultBranchName)}`);
    })();
  }, [shellData, viewer, config, push, basePath, setRecord]);
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
    if (branchInfo) {
      // the URL's branch is a real ref - personal brand or the default branch,
      // both adoptable now that brands are opt-in (CurrentBrandChip gates
      // switching to the default branch behind its own confirm dialog; this
      // guard just adopts whatever a valid URL already points at). Reuses the
      // stored record if it matches, otherwise reconstructs one from the ref
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

    // the URL's branch doesn't exist (e.g. a deleted brand, a stale link). If
    // context already holds a different, still-valid ref, redirect there;
    // otherwise land on the default branch - brands are opt-in
    // (NewBranchButton) now, nothing here creates one automatically. Once the
    // URL points at the default branch, the next run of this effect adopts it
    // through the branch above.
    if (record && branches.has(record.ref)) {
      startedRef.current = currentBranch;
      push(`${basePath}/branch/${encodeURIComponent(record.ref)}`);
      return;
    }

    if (!branches.has(repoInfo.defaultBranch)) return; // default branch itself not loaded yet
    startedRef.current = currentBranch;
    push(`${basePath}/branch/${encodeURIComponent(repoInfo.defaultBranch)}`);
  }, [repoInfo, viewer, currentBranch, branches, record?.ref, config, push, basePath, setRecord]);
}

// Shared brand creation
// -----------------------------------------------------------------------------
// The only caller is NewBranchButton.tsx (brands are opt-in now). `ref`
// defaults to a fresh timestamped name but can be overridden - the "New
// branch" dialog pre-fills that default and lets the user edit it before
// creating.

export async function createBrand(
  config: GitHubConfig,
  args: {
    createBranch: ReturnType<typeof useCreateBranchMutation>[1];
    repositoryId: string;
    login: string;
    name: string;
    defaultBranchCommitOid: string;
    ref?: string;
  },
): Promise<BrandRecord | null> {
  const now = new Date();
  const ref = args.ref ?? formatBrandRef(getBranchPrefix(config), now);
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
