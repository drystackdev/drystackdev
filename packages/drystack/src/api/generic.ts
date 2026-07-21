import * as cookie from "cookie";
import * as s from "superstruct";
import { Config } from "..";
import { DrystackResponse, DrystackRequest, redirect } from "./internal-utils";
import { handleGitHubAppCreation, localModeApiHandler } from "#api-handler";
import { R2BucketLike, r2ModeApiHandler, requireNativeSession } from "./api-r2";
import { makeAiRouteHandler } from "./ai";
import { webcrypto } from "#webcrypto";
import { bytesToHex } from "../hex";
import { decryptValue, encryptValue } from "./encryption";
import { GITHUB_API_USER_AGENT, verifyGitHubAccess } from "./github-access";

// Public path (relative to the site root) of the dry-map static asset
// written by @drystack/astro's astro:build:done hook - see index.ts's
// writeDryMapFile. Shared here (not duplicated) so the writer and the
// `github/dry-map` route below always agree on where to look.
export const DRY_MAP_PUBLIC_PATH = "_drystack/dry-map.json";

export type APIRouteConfig = {
  /** @default process.env.DRYSTACK_GITHUB_CLIENT_ID */
  clientId?: string;
  /** @default process.env.DRYSTACK_GITHUB_CLIENT_SECRET */
  clientSecret?: string;
  /** @default process.env.DRYSTACK_SECRET */
  secret?: string;
  localBaseDirectory?: string;
  config: Config<any, any>;
  /** @default process.env.DRY_AI_PROVIDER */
  aiProvider?: string;
  /** @default process.env.DRY_AI_KEY */
  aiKey?: string;
  /** @default process.env.DRY_AI_MODEL */
  aiModel?: string;
  /** @default process.env.DRY_AI_BASE_URL */
  aiBaseUrl?: string;
  /**
   * The path segment the drystack UI and API routes are mounted at, without slashes.
   * e.g. 'admin' mounts the UI at /admin and the API at /api/admin.
   * @default 'drystack'
   */
  basePath?: string;
  /**
   * Lets `github/dry-map` (see below) self-fetch the dry-map static asset
   * the build wrote alongside the site - e.g. Cloudflare's `env.ASSETS`
   * binding. Omitted on adapters/deployments with no such binding; the route
   * just 404s in that case (never returns the map without it).
   */
  assetsFetcher?: { fetch(input: string | URL): Promise<Response> };
  /**
   * The R2 bucket backing `storage: { kind: 'r2' }` - on Cloudflare this is
   * the `DRYSTACK_R2` binding (see @drystack/astro's api.tsx). Required in r2
   * mode; the handler returns a loud 500 without it rather than silently
   * degrading.
   */
  r2Bucket?: R2BucketLike;
};

type InnerAPIRouteConfig = {
  clientId: string;
  clientSecret: string;
  secret: string;
  config: Config;
  uiBasePath: string;
  apiBasePath: string;
  assetsFetcher?: { fetch(input: string | URL): Promise<Response> };
};

const drystackRouteRegex =
  /^branch\/[^]+(\/collection\/[^/]+(|\/(create|item\/[^/]+))|\/singleton\/[^/]+)?$/;

function tryOrUndefined<T>(fn: () => T) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function makeGenericAPIRouteHandler(
  _config: APIRouteConfig,
  options?: { slugEnvName?: string },
) {
  const _config2: APIRouteConfig = {
    clientId:
      _config.clientId ??
      tryOrUndefined(() => process.env.DRYSTACK_GITHUB_CLIENT_ID),
    clientSecret:
      _config.clientSecret ??
      tryOrUndefined(() => process.env.DRYSTACK_GITHUB_CLIENT_SECRET),
    secret: _config.secret ?? tryOrUndefined(() => process.env.DRYSTACK_SECRET),
    config: _config.config,
    basePath: _config.basePath,
    assetsFetcher: _config.assetsFetcher,
    aiProvider:
      _config.aiProvider ?? tryOrUndefined(() => process.env.DRY_AI_PROVIDER),
    aiKey: _config.aiKey ?? tryOrUndefined(() => process.env.DRY_AI_KEY),
    aiModel: _config.aiModel ?? tryOrUndefined(() => process.env.DRY_AI_MODEL),
    aiBaseUrl:
      _config.aiBaseUrl ?? tryOrUndefined(() => process.env.DRY_AI_BASE_URL),
  };

  const rawBasePath = (_config2.basePath ?? "drystack").replace(
    /^\/+|\/+$/g,
    "",
  );
  const uiBasePath = `/${rawBasePath}`;
  const apiBasePath = `/api/${rawBasePath}`;

  const getParams = (req: DrystackRequest) => {
    let url;
    try {
      url = new URL(req.url);
    } catch (err) {
      throw new Error("Found incomplete URL in drystack API route URL handler");
    }
    let pathname = url.pathname;
    if (pathname.startsWith(apiBasePath)) {
      pathname = pathname.slice(apiBasePath.length);
    }
    return pathname
      .split("/")
      .map((x) => decodeURIComponent(x))
      .filter(Boolean);
  };

  const aiHandler = makeAiRouteHandler({
    config: _config2.config,
    env: {
      DRY_AI_PROVIDER: _config2.aiProvider,
      DRY_AI_KEY: _config2.aiKey,
      DRY_AI_MODEL: _config2.aiModel,
      DRY_AI_BASE_URL: _config2.aiBaseUrl,
    },
  });

  // `ai/*` has to be dispatched ahead of every branch below, because each of
  // them is terminal: local mode hands the request to `localModeApiHandler`,
  // which 404s anything that isn't tree/blob/update, and the
  // no-GitHub-credentials branch 404s anything that isn't a `github/*` route.
  // Either would swallow `ai/*` before it could ever be reached.
  //
  // AI generation neither reads nor writes the repo, so it's storage-agnostic
  // and has to work identically in local and github mode. It also has to work
  // with no GitHub App configured at all, which is why this sits above the
  // clientId/secret check too.
  const withAi = (
    inner: (
      req: DrystackRequest,
    ) => Promise<DrystackResponse> | DrystackResponse,
  ) => {
    if (!aiHandler) return inner;
    return async (req: DrystackRequest): Promise<DrystackResponse> => {
      const params = getParams(req);
      if (params[0] === "ai") return aiHandler(req, params);
      return inner(req);
    };
  };

  if (
    _config2.config.storage.kind === "local" ||
    _config2.config.storage.kind === "demo"
  ) {
    const handler = localModeApiHandler(
      _config2.config,
      _config.localBaseDirectory,
    );
    return withAi((req: DrystackRequest) => {
      const params = getParams(req);
      return handler(req, params);
    });
  }
  if (_config2.config.storage.kind === "r2") {
    const handler = r2ModeApiHandler(
      _config2.config,
      _config.r2Bucket,
      _config2.secret,
    );
    // Not wrapped in `withAi`: that dispatches `ai/*` unauthenticated, which
    // is fine for local (dev machine) and github (its own token check inside
    // ai/index.ts's requireSession), but an r2 deployment is public with no
    // GitHub cookie - so the native session is required here BEFORE the AI
    // handler can spend the site owner's key. Same money-shaped reasoning as
    // requireSession's own doc comment.
    return async (req: DrystackRequest): Promise<DrystackResponse> => {
      const params = getParams(req);
      if (params[0] === "ai" && aiHandler) {
        if (!(await requireNativeSession(req, _config.r2Bucket, _config2.secret))) {
          return {
            status: 401,
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ error: "Chưa đăng nhập." }),
          };
        }
        return aiHandler(req, params);
      }
      return handler(req, params);
    };
  }
  if (!_config2.clientId || !_config2.clientSecret || !_config2.secret) {
    return withAi(async function drystackAPIRoute(
      req: DrystackRequest,
    ): Promise<DrystackResponse> {
      const params = getParams(req);
      const joined = params.join("/");
      if (joined === "github/created-app") {
        return handleGitHubAppCreation(req, options?.slugEnvName, uiBasePath);
      }
      if (
        joined === "github/login" ||
        joined === "github/repo-not-found" ||
        joined === "github/logout"
      ) {
        return redirect(`${uiBasePath}/setup`);
      }
      return { status: 404, body: "Not Found" };
    });
  }
  const config: InnerAPIRouteConfig = {
    clientId: _config2.clientId,
    clientSecret: _config2.clientSecret,
    secret: _config2.secret,
    config: _config2.config,
    uiBasePath,
    apiBasePath,
    assetsFetcher: _config2.assetsFetcher,
  };

  return withAi(async function drystackAPIRoute(
    req: DrystackRequest,
  ): Promise<DrystackResponse> {
    const params = getParams(req);
    const joined = params.join("/");
    if (joined === "github/oauth/callback") {
      return githubOauthCallback(req, config);
    }
    if (joined === "github/login") {
      return githubLogin(req, config);
    }
    if (joined === "github/refresh-token") {
      return githubRefreshToken(req, config);
    }
    if (joined === "github/repo-not-found") {
      return githubRepoNotFound(req, config);
    }
    if (joined === "github/dry-map") {
      return githubDryMap(req, config);
    }
    if (joined === "github/logout") {
      const cookies = cookie.parse(req.headers.get("cookie") ?? "");
      const access_token = cookies["drystack-gh-access-token"];
      if (access_token) {
        await fetch(
          `https://api.github.com/applications/${config.clientId}/token`,
          {
            method: "DELETE",
            headers: {
              Authorization: `Basic ${btoa(
                config.clientId + ":" + config.clientSecret,
              )}`,
              "User-Agent": GITHUB_API_USER_AGENT,
            },
            body: JSON.stringify({ access_token }),
          },
        );
      }
      return redirect(config.uiBasePath, [
        ["Set-Cookie", immediatelyExpiringCookie("drystack-gh-access-token")],
        ["Set-Cookie", immediatelyExpiringCookie("drystack-gh-refresh-token")],
      ]);
    }
    if (joined === "github/created-app") {
      return {
        status: 404,
        body: "It looks like you just tried to create a GitHub App for drystack but there is already a GitHub App configured for drystack.\n\nYou may be here because you started creating a GitHub App but then started the process again elsewhere and completed it there. You should likely go back to drystack and sign in with GitHub to continue.",
      };
    }
    return { status: 404, body: "Not Found" };
  });
}

const tokenDataResultType = s.type({
  access_token: s.string(),
  expires_in: s.number(),
  refresh_token: s.string(),
  refresh_token_expires_in: s.number(),
  scope: s.string(),
  token_type: s.literal("bearer"),
});

async function githubOauthCallback(
  req: DrystackRequest,
  config: InnerAPIRouteConfig,
): Promise<DrystackResponse> {
  const searchParams = new URL(req.url, "http://localhost").searchParams;
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description");
  if (typeof errorDescription === "string") {
    return {
      status: 400,
      body: `An error occurred when trying to authenticate with GitHub:\n${errorDescription}${
        error === "redirect_uri_mismatch"
          ? `\n\nIf you were trying to sign in locally, you need to add \`http://127.0.0.1${config.apiBasePath}/github/oauth/callback\` as a callback URL in your GitHub app.`
          : ""
      }`,
    };
  }
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (typeof code !== "string") {
    return { status: 400, body: "Bad Request" };
  }
  const cookies = cookie.parse(req.headers.get("cookie") ?? "");
  const fromCookie = state ? cookies["ks-" + state] : undefined;
  const from =
    typeof fromCookie === "string" && drystackRouteRegex.test(fromCookie)
      ? fromCookie
      : undefined;
  const url = new URL("https://github.com/login/oauth/access_token");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("code", code);

  const tokenRes = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
  });
  if (!tokenRes.ok) {
    return { status: 401, body: "Authorization failed" };
  }
  const _tokenData = await tokenRes.json();
  let tokenData;
  try {
    tokenData = tokenDataResultType.create(_tokenData);
  } catch {
    return { status: 401, body: "Authorization failed" };
  }

  const headers = await getTokenCookies(tokenData, config);
  if (state === "close") {
    return {
      headers: [...headers, ["Content-Type", "text/html"]],
      body: "<script>localStorage.setItem('ks-refetch-installations', 'true');window.close();</script>",
      status: 200,
    };
  }
  return redirect(`${config.uiBasePath}${from ? `/${from}` : ""}`, headers);
}

async function getTokenCookies(
  tokenData: s.Infer<typeof tokenDataResultType>,
  config: InnerAPIRouteConfig,
) {
  const headers: [string, string][] = [
    [
      "Set-Cookie",
      cookie.serialize("drystack-gh-access-token", tokenData.access_token, {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: tokenData.expires_in,
        expires: new Date(Date.now() + tokenData.expires_in * 1000),
        path: "/",
      }),
    ],
    [
      "Set-Cookie",
      cookie.serialize(
        "drystack-gh-refresh-token",
        await encryptValue(tokenData.refresh_token, config.secret),
        {
          sameSite: "lax",
          secure: process.env.NODE_ENV === "production",
          httpOnly: true,
          maxAge: tokenData.refresh_token_expires_in,
          expires: new Date(
            Date.now() + tokenData.refresh_token_expires_in * 1000,
          ),
          path: "/",
        },
      ),
    ],
  ];
  return headers;
}

async function getRefreshToken(
  req: DrystackRequest,
  config: InnerAPIRouteConfig,
) {
  const cookies = cookie.parse(req.headers.get("cookie") || "");
  const refreshTokenCookie = cookies["drystack-gh-refresh-token"];
  if (!refreshTokenCookie) return;
  let refreshToken;
  try {
    refreshToken = await decryptValue(refreshTokenCookie, config.secret);
  } catch {
    return;
  }
  return refreshToken;
}

async function githubRefreshToken(
  req: DrystackRequest,
  config: InnerAPIRouteConfig,
): Promise<DrystackResponse> {
  const headers = await refreshGitHubAuth(req, config);
  if (!headers) {
    return { status: 401, body: "Authorization failed" };
  }
  return { status: 200, headers, body: "" };
}

async function refreshGitHubAuth(
  req: DrystackRequest,
  config: InnerAPIRouteConfig,
) {
  const refreshToken = await getRefreshToken(req, config);
  if (!refreshToken) {
    return;
  }
  const url = new URL("https://github.com/login/oauth/access_token");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("client_secret", config.clientSecret);
  url.searchParams.set("grant_type", "refresh_token");
  url.searchParams.set("refresh_token", refreshToken);
  const tokenRes = await fetch(url, {
    method: "POST",
    headers: { Accept: "application/json" },
  });

  if (!tokenRes.ok) {
    return;
  }
  const _tokenData = await tokenRes.json();
  let tokenData;
  try {
    tokenData = tokenDataResultType.create(_tokenData);
  } catch {
    return;
  }
  return getTokenCookies(tokenData, config);
}

async function githubRepoNotFound(
  req: DrystackRequest,
  config: InnerAPIRouteConfig,
): Promise<DrystackResponse> {
  const headers = await refreshGitHubAuth(req, config);
  if (headers) {
    return redirect(`${config.uiBasePath}/repo-not-found`, headers);
  }
  return githubLogin(req, config);
}

// Verified editors only: returns the build-time
// data-dry-id → {data-dry, data-dry-kind, data-dry-value} registry so the
// VEI client can patch the real attributes back onto `[data-dry-id]`
// elements. See dry.ts (registry) and index.ts's writeDryMapFile (static
// asset) in @drystack/astro. Not encrypted - the registry only reveals
// field paths/kinds, not a site secret - but still gated behind GitHub auth
// so anonymous visitors can't enumerate the schema.
async function githubDryMap(
  req: DrystackRequest,
  config: InnerAPIRouteConfig,
): Promise<DrystackResponse> {
  const cookies = cookie.parse(req.headers.get("cookie") ?? "");
  const accessToken = cookies["drystack-gh-access-token"];
  if (!accessToken || !(await verifyGitHubAccess(config.config, accessToken))) {
    return { status: 401, body: "Not authorized" };
  }
  if (!config.assetsFetcher) {
    return { status: 404, body: "Not Found" };
  }
  const assetRes = await config.assetsFetcher.fetch(
    new URL(`/${DRY_MAP_PUBLIC_PATH}`, req.url),
  );
  if (!assetRes.ok) {
    return { status: 404, body: "Not Found" };
  }
  return {
    status: 200,
    headers: [["Content-Type", "application/json"]],
    body: await assetRes.text(),
  };
}

async function githubLogin(
  req: DrystackRequest,
  config: InnerAPIRouteConfig,
): Promise<DrystackResponse> {
  const reqUrl = new URL(req.url);
  const rawFrom = reqUrl.searchParams.get("from");
  const from =
    typeof rawFrom === "string" && drystackRouteRegex.test(rawFrom)
      ? rawFrom
      : "/";
  const state = bytesToHex(webcrypto.getRandomValues(new Uint8Array(10)));
  const url = new URL("https://github.com/login/oauth/authorize");
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set(
    "redirect_uri",
    `${reqUrl.origin}${config.apiBasePath}/github/oauth/callback`,
  );
  if (from === "/") {
    return redirect(url.toString());
  }
  url.searchParams.set("state", state);
  return redirect(url.toString(), [
    [
      "Set-Cookie",
      cookie.serialize("ks-" + state, from, {
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        // 1 day
        maxAge: 60 * 60 * 24,
        expires: new Date(Date.now() + 60 * 60 * 24 * 1000),
        path: "/",
        httpOnly: true,
      }),
    ],
  ]);
}

function immediatelyExpiringCookie(name: string) {
  return cookie.serialize(name, "", {
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
    expires: new Date(),
  });
}
