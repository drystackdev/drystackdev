import { Config } from "..";
import { DrystackResponse, DrystackRequest } from "./internal-utils";
import { localModeApiHandler } from "#api-handler";
import { R2BucketLike, r2ModeApiHandler, requireNativeSession } from "./api-r2";
import { D1DatabaseLike } from "./d1";
import { EmailSenderBinding } from "./email";
import { makeAiRouteHandler } from "./ai";

// Public path (relative to the site root) of the dry-map static asset
// written by @drystack/astro's astro:build:done hook - see index.ts's
// writeDryMapFile.
export const DRY_MAP_PUBLIC_PATH = "_drystack/dry-map.json";

export type APIRouteConfig = {
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
   * The R2 bucket backing `storage: { kind: 'r2' }` - on Cloudflare this is
   * the `DRYSTACK_R2` binding (see @drystack/astro's api.tsx). Required in r2
   * mode; the handler returns a loud 500 without it rather than silently
   * degrading.
   */
  r2Bucket?: R2BucketLike;
  /**
   * The D1 database backing `storage: { kind: 'r2' }`'s user/role/permission
   * store (see plan/user-managent.md) - on Cloudflare this is the
   * `DRYSTACK_DB` binding (see @drystack/astro's api.tsx). Required in r2
   * mode; the handler returns a loud 500 without it rather than silently
   * degrading.
   */
  d1Database?: D1DatabaseLike;
  /**
   * Sends invite/forgot-password emails (see plan/user-managent.md mục 7) -
   * on Cloudflare this is the `DRYSTACK_EMAIL` send_email binding (declared
   * in wrangler.jsonc). Undefined means email isn't configured yet - the
   * affected routes still succeed, just without sending anything (see
   * user-management.ts).
   */
  emailSender?: EmailSenderBinding;
  /** The verified `from` address for emails sent via `emailSender`. */
  emailFrom?: string;
  /**
   * Resend API key - alternative to `emailSender` that works on the
   * Workers Free plan (Cloudflare's own Email Sending requires Workers
   * Paid for arbitrary recipients). Takes priority over `emailSender` when
   * both are set - see api-r2.ts's r2ModeApiHandler.
   */
  resendApiKey?: string;
  /** The verified `from` address for emails sent via `resendApiKey`. */
  resendFrom?: string;
};

function tryOrUndefined<T>(fn: () => T) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function makeGenericAPIRouteHandler(_config: APIRouteConfig) {
  const _config2: APIRouteConfig = {
    secret: _config.secret ?? tryOrUndefined(() => process.env.DRYSTACK_SECRET),
    config: _config.config,
    basePath: _config.basePath,
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
    // Only consulted by requireMagicWriterPermission when storage.kind ===
    // 'r2' - harmless to pass for demo, which ignores them.
    r2Bucket: _config.r2Bucket,
    d1Database: _config.d1Database,
    secret: _config2.secret,
  });

  // `ai/*` has to be dispatched ahead of every branch below, because each of
  // them is terminal: the demo/r2 handler below 404s anything that isn't
  // tree/blob/update. That would swallow `ai/*` before it could ever be
  // reached.
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

  if (_config2.config.storage.kind === "demo") {
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
      _config.d1Database,
      _config2.secret,
      _config.emailSender,
      _config.emailFrom,
      _config.resendApiKey,
      _config.resendFrom,
    );
    // Not wrapped in `withAi`: an r2 deployment is public, so the native
    // session is required here BEFORE the AI handler can spend the site
    // owner's key - demo has no `/api` routes at all, so it never reaches
    // this branch.
    return async (req: DrystackRequest): Promise<DrystackResponse> => {
      const params = getParams(req);
      if (params[0] === "ai" && aiHandler) {
        if (
          !(await requireNativeSession(
            req,
            _config.r2Bucket,
            _config.d1Database,
            _config2.secret,
          ))
        ) {
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
  return withAi(() => ({ status: 404, body: "Not Found" }));
}
