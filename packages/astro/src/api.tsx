import {
  type APIRouteConfig,
  makeGenericAPIRouteHandler,
} from '@drystack/core/api/generic';
import type { APIContext } from 'astro';
import { parseString } from 'set-cookie-parser';

// Astro v6 removed `context.locals.runtime.env` — the Cloudflare adapter now
// exposes bindings/env vars via the `cloudflare:workers` module instead. That
// module only resolves when actually running on Workers (or its Miniflare
// simulation), so this is a dynamic import guarded by try/catch: it silently
// falls through to the `import.meta.env.*` lookups below on every other
// adapter (Node, etc.), where env vars come from `.env` files instead.
async function getCloudflareEnv(): Promise<Record<string, any> | undefined> {
  try {
    // @ts-expect-error — only resolves at runtime on Workers; see the comment above.
    const cf: any = await import(/* @vite-ignore */ 'cloudflare:workers');
    return cf.env;
  } catch {
    return undefined;
  }
}

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
        dryMapSecret:
          _config.dryMapSecret ??
          envVarsForCf?.DRYSTACK_DRY_MAP_SECRET ??
          tryOrUndefined(() => {
            return import.meta.env.DRYSTACK_DRY_MAP_SECRET;
          }),
        // The `github/dry-map` route self-fetches its own deployed static
        // assets through this — Cloudflare's `ASSETS` binding (declared in
        // wrangler.jsonc) is a `Fetcher`, so `.fetch(url)` works the same as
        // the global `fetch`. Undefined on adapters with no such binding;
        // the route just 404s rather than ever serving the map unencrypted.
        assetsFetcher: _config.assetsFetcher ?? envVarsForCf?.ASSETS,
      },
      {
        slugEnvName: 'PUBLIC_DRYSTACK_GITHUB_APP_SLUG',
      }
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
      } else if (typeof headers.entries === 'function') {
        for (const [key, value] of headers.entries()) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
        if (
          'getSetCookie' in headers &&
          typeof headers.getSetCookie === 'function'
        ) {
          const setCookieHeaders = (headers as any).getSetCookie();
          if (setCookieHeaders?.length) {
            headersInADifferentStructure.set('set-cookie', setCookieHeaders);
          }
        }
      } else {
        // Neither an array nor a Headers instance (excluded above), so per
        // ResponseInit's HeadersInit union this must be a plain string map.
        for (const [key, value] of Object.entries(headers as Record<string, string>)) {
          headersInADifferentStructure.set(key.toLowerCase(), [value]);
        }
      }
    }

    const setCookieHeaders = headersInADifferentStructure.get('set-cookie');
    headersInADifferentStructure.delete('set-cookie');
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
            sameSite === 'lax' || sameSite === 'strict' || sameSite === 'none'
              ? sameSite
              : undefined,
        });
      }
    }

    return new Response(body, {
      status,
      headers: [...headersInADifferentStructure.entries()].flatMap(
        ([key, val]) => val.map((x): [string, string] => [key, x])
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
