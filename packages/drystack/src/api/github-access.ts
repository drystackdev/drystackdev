// Proof that a request carries a token GitHub still accepts for *this* repo.
//
// Lives in its own module rather than in generic.ts because generic.ts imports
// the AI routes, and the AI routes need this - importing it back would close a
// cycle.

import type { Config } from "..";
import { serializeRepoConfig } from "../app/repo-config";

// GitHub's REST API (api.github.com, as opposed to the OAuth endpoints on
// github.com) rejects any request with no `User-Agent` header - 403 "Request
// forbidden by administrative rules", not a 401 - regardless of how valid
// the bearer token is. Cloudflare Workers' `fetch()` doesn't set one by
// default (unlike a browser), so every api.github.com call needs this set
// explicitly or GitHub bounces it before even looking at the token.
export const GITHUB_API_USER_AGENT = "drystack";

/**
 * Whether `token` can actually read the configured repo.
 *
 * The only server-side check anywhere in drystack that a GitHub token is real
 * (every other "auth" check - getAuth/getSyncAuth - just reads whether a
 * client-readable cookie is present, which is trivially spoofable). The
 * presence of the cookie proves nothing: any visitor can set one, so only
 * GitHub can say whether the value behind it is live.
 *
 * Hits the repo directly, not just /user, so a valid token for an *unrelated*
 * GitHub account (no access to this repo) is correctly rejected too - a
 * private repo 404s for non-collaborators, a public one still requires the
 * token to be genuine to get a 200 from GitHub.
 *
 * Deliberately unmemoized: the routes behind it are user-initiated and rare
 * (page load, model pick, a write), so one API call each is nothing against
 * the 5000/hour budget, and a cache would keep a revoked token working for as
 * long as its TTL.
 */
export async function verifyGitHubAccess(
  config: Config<any, any>,
  token: string,
): Promise<boolean> {
  if (config.storage.kind !== "github") return false;
  const res = await fetch(
    `https://api.github.com/repos/${serializeRepoConfig(config.storage.repo)}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": GITHUB_API_USER_AGENT,
      },
    },
  );
  return res.ok;
}
