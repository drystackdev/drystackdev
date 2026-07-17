// Pure IndexedDB persistence for the current "brand" (a personal git branch in
// GitHub mode - see brand.tsx). Extracted out of brand.tsx (which is
// React/context-heavy) so the visual editor (VEI, packages/astro/src/editor)
// can read/rotate the same record over the same origin's IndexedDB without
// pulling the admin app's React tree. Re-exported from brand.tsx so existing
// admin imports keep working unchanged.
import { createStore, get, set, del, type UseStore } from "idb-keyval";

import type { GitHubConfig } from "../config";
import { serializeRepoConfig } from "./repo-config";

// Deliberately holds no merge base: the base a brand was cut from is a fact
// about the two refs, and deploy re-derives it from GitHub every time (see
// deploy/merge-base.ts). Storing it here meant that whenever the record was
// lost, it got rebuilt with a *guessed* base - which made Deploy roll the
// default branch back to the brand's tree.
export type BrandRecord = {
  ref: string;
  label: string;
  login: string;
  createdAt: number;
};

let store: UseStore | undefined;
function getStore(): UseStore {
  if (!store) {
    store = createStore("drystack-brand", "brands");
  }
  return store;
}

function repoKey(config: GitHubConfig): string {
  return serializeRepoConfig(config.storage.repo);
}

export function readBrandRecord(
  config: GitHubConfig,
): Promise<BrandRecord | undefined> {
  return get(repoKey(config), getStore());
}

export function writeBrandRecord(
  config: GitHubConfig,
  record: BrandRecord,
): Promise<void> {
  return set(repoKey(config), record, getStore());
}

export function removeBrandRecord(config: GitHubConfig): Promise<void> {
  return del(repoKey(config), getStore());
}
