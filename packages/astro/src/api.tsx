import {
  type APIRouteConfig,
  makeGenericAPIRouteHandler,
} from "@drystack/core/api/generic";
import type { APIContext } from "astro";
import { parseString } from "set-cookie-parser";
import { getCloudflareEnv } from "./cloudflare-env";

export function makeHandler(_config: APIRouteConfig) {
  return async function drystackAPIRoute(context: APIContext) {
    const envVarsForCf = await getCloudflareEnv();
    const handler = makeGenericAPIRouteHandler(
      {
        ..._config,
        clientId:
          _config.clientId ??
          envVarsForCf?.DRYSTACK_GITHUB_CLIENT_ID ??
          tryOrUndefined(() => {
            return import.meta.env.DRYSTACK_GITHUB_CLIENT_ID;
          }),
        clientSecret:
          _config.clientSecret ??
          envVarsForCf?.DRYSTACK_GITHUB_CLIENT_SECRET ??
          tryOrUndefined(() => {
            return import.meta.env.DRYSTACK_GITHUB_CLIENT_SECRET;
          }),
        secret:
          _config.secret ??
          envVarsForCf?.DRYSTACK_SECRET ??
          tryOrUndefined(() => {
            return import.meta.env.DRYSTACK_SECRET;
          }),
        // Read at request time, never at build time - on Cloudflare, Pages
        // "Secrets" are invisible to `astro build`, so anything that reached
        // for DRY_AI_KEY during the build would silently see nothing.
        aiProvider:
          _config.aiProvider ??
          envVarsForCf?.DRY_AI_PROVIDER ??
          tryOrUndefined(() => {
            return import.meta.env.DRY_AI_PROVIDER;
          }),
        aiKey:
          _config.aiKey ??
          envVarsForCf?.DRY_AI_KEY ??
          tryOrUndefined(() => {
            return import.meta.env.DRY_AI_KEY;
          }),
        aiModel:
          _config.aiModel ??
          envVarsForCf?.DRY_AI_MODEL ??
          tryOrUndefined(() => {
            return import.meta.env.DRY_AI_MODEL;
          }),
        aiBaseUrl:
          _config.aiBaseUrl ??
          envVarsForCf?.DRY_AI_BASE_URL ??
          tryOrUndefined(() => {
            return import.meta.env.DRY_AI_BASE_URL;
          }),
        // The `github/dry-map` route self-fetches its own deployed static
        // assets through this - Cloudflare's `ASSETS` binding (declared in
        // wrangler.jsonc) is a `Fetcher`, so `.fetch(url)` works the same as
        // the global `fetch`. Undefined on adapters with no such binding;
        // the route just 404s rather than ever serving the map.
        assetsFetcher: _config.assetsFetcher ?? envVarsForCf?.ASSETS,
        // `storage: { kind: 'r2' }` reads/writes through this bucket binding
        // (declared in wrangler.jsonc). Undefined elsewhere; the r2 handler
        // 500s loudly rather than pretending to work without it.
        r2Bucket: _config.r2Bucket ?? envVarsForCf?.DRYSTACK_R2,
      },
      {
        slugEnvName: "PUBLIC_DRYSTACK_GITHUB_APP_SLUG",
      },
    );
    const { body, headers, status } = await handler(context.request);
    // all this stuff should be able to go away when astro is using a version of undici with getSetCookie
    let headersInADifferentStructure = new Map<string, string[]>();
    if (headers) {
      if (Array.isArray(headers)) {
        for (const [key, value] of headers) {
          if (!headersInADifferentStructure.has(key.toLowerCase())) {
            headersInADifferentStructure.set(key.toLowerCase(), []);
          }
          headersInADifferentStructure.get(key.toLowerCase())!.push(value);
        }
      } else if (typeof headers.entries === "function") {
        for (const [key, value] of headers.entries()) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
        if (
          "getSetCookie" in headers &&
          typeof headers.getSetCookie === "function"
        ) {
          const setCookieHeaders = (headers as any).getSetCookie();
          if (setCookieHeaders?.length) {
            headersInADifferentStructure.set("set-cookie", setCookieHeaders);
          }
        }
      } else {
        // Neither an array nor a Headers instance (excluded above), so per
        // ResponseInit's HeadersInit union this must be a plain string map.
        for (const [key, value] of Object.entries(
          headers as Record<string, string>,
        )) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
      }
    }

    const setCookieHeaders = headersInADifferentStructure.get("set-cookie");
    headersInADifferentStructure.delete("set-cookie");
    if (setCookieHeaders) {
      for (const setCookieValue of setCookieHeaders) {
        const { name, value, ...options } = parseString(setCookieValue);
        const sameSite = options.sameSite?.toLowerCase();
        context.cookies.set(name, value, {
          domain: options.domain,
          expires: options.expires,
          httpOnly: options.httpOnly,
          maxAge: options.maxAge,
          path: options.path,
          sameSite:
            sameSite === "lax" || sameSite === "strict" || sameSite === "none"
              ? sameSite
              : undefined,
        });
      }
    }

    return new Response(body as BodyInit | null, {
      status,
      headers: [...headersInADifferentStructure.entries()].flatMap(
        ([key, val]) => val.map((x): [string, string] => [key, x]),
      ),
    });
  };
}

function tryOrUndefined<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}
