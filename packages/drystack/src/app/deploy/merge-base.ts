// Resolves the real merge base of a brand branch and the default branch, by
// asking git (via GitHub's compare API) instead of remembering it.
//
// A brand used to carry the base it was cut from in its IndexedDB record. That
// worked only as long as the record survived; whenever it didn't (new browser,
// cleared storage, a branch adopted from a URL), the brand guard rebuilt the
// record with `base = default branch HEAD *today*`. Deploy then merged with
// base === theirs, which makes classifyChanges read every commit main gained
// since the brand was cut as "ours deleted/reverted it" - and the deploy commit
// silently rolled main back to the brand's tree. The base is not something we
// get to guess: it's a fact about the two refs, so we look it up every deploy.
//
// Callers pass commit SHAs (not branch names) so refs containing `/` - every
// brand ref does - need no path escaping.
export type MergeBase = { commitSha: string; treeSha: string };

export async function fetchMergeBase(
  accessToken: string,
  repo: string, // "owner/name"
  baseCommitSha: string,
  headCommitSha: string,
): Promise<MergeBase> {
  const res = await fetch(
    `https://api.github.com/repos/${repo}/compare/${baseCommitSha}...${headCommitSha}?per_page=1`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
      },
    },
  );
  if (!res.ok) {
    throw new Error(
      "Không xác định được điểm rẽ nhánh (merge base) giữa brand và nhánh mặc định - huỷ deploy để tránh ghi đè nhầm.",
    );
  }
  const json = (await res.json()) as {
    merge_base_commit?: { sha?: string; commit?: { tree?: { sha?: string } } };
  };
  const commitSha = json.merge_base_commit?.sha;
  const treeSha = json.merge_base_commit?.commit?.tree?.sha;
  if (!commitSha || !treeSha) {
    throw new Error(
      "GitHub không trả về merge base hợp lệ - huỷ deploy để tránh ghi đè nhầm.",
    );
  }
  return { commitSha, treeSha };
}
