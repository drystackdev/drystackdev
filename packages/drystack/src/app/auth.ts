import { parse } from "cookie";
import { Config } from "../config";

// A 401 from the local-shaped REST write route only ever means one thing: an
// r2-mode session expired (local mode never 401s, demo 403s, github never
// uses the route). Bounce through /login - unsaved edits survive in
// IndexedDB (see persistence.tsx) and `from` brings the user straight back.
// Callers still throw right after for the non-401 cases.
export function redirectToNativeLoginIfUnauthorized(status: number) {
  if (status !== 401 || typeof location === "undefined") return;
  location.assign(
    `/login?from=${encodeURIComponent(location.pathname + location.search)}`
  );
}

export function getSyncAuth(config: Config) {
  if (typeof document === "undefined") {
    return null;
  }
  if (config.storage.kind === "github") {
    const cookies = parse(document.cookie);
    const accessToken = cookies["drystack-gh-access-token"];
    if (!accessToken) {
      return null;
    }
    return { accessToken };
  }
  return null;
}

let _refreshTokenPromise: Promise<{ accessToken: string } | null> | undefined;

export async function getAuth(config: Config, basePath: string) {
  const token = getSyncAuth(config);

  if (config.storage.kind === "github" && !token) {
    return refreshAuth(basePath);
  }
  return token;
}

// Unconditionally trades the (httpOnly, much longer-lived) refresh-token
// cookie for a fresh access-token cookie. `getAuth` only reaches this when
// the access-token cookie is already absent, but some callers need to force
// it even with a cookie present - e.g. a client-side check that only tests
// for the access-token cookie's *presence* (cheap, no network call) can pass
// while the token itself is stale/revoked, which only a server round-trip
// (like the one this refresh performs) can catch.
export async function refreshAuth(
  basePath: string,
): Promise<{ accessToken: string } | null> {
  if (!_refreshTokenPromise) {
    _refreshTokenPromise = (async () => {
      try {
        const res = await fetch(`/api${basePath}/github/refresh-token`, {
          method: "POST",
        });
        if (res.status === 200) {
          const cookies = parse(document.cookie);
          const accessToken = cookies["drystack-gh-access-token"];
          if (accessToken) {
            return { accessToken };
          }
        }
      } catch {
      } finally {
        _refreshTokenPromise = undefined;
      }
      return null;
    })();
  }
  return _refreshTokenPromise;
}
