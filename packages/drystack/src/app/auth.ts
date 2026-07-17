import { parse } from "cookie";
import { Config } from "../config";

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
