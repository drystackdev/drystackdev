import { defineMiddleware } from "astro:middleware";
import { getContentVersion } from "@drystack/core/api/api-r2";
import { getCloudflareEnv } from "./cloudflare-env";
// @ts-expect-error - provided by the drystack Astro integration's Vite plugin
import config from "virtual:drystack-config";
// @ts-expect-error - provided by the drystack Astro integration's Vite plugin
import basePath from "virtual:drystack-path";

// Structural subsets of the Workers runtime globals this file needs -
// tsconfig.json deliberately excludes @cloudflare/workers-types (it clashes
// with lib.dom's globals the rest of this package's browser code relies on;
// see tsconfig.worker.json's own comment for the full reasoning), so these
// are typed locally instead, same pattern as api-r2.ts's `R2BucketLike`.
type CacheApiLike = {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
};
type ExecutionContextLike = { waitUntil(promise: Promise<unknown>): void };

// Injected unconditionally by the integration (see index.ts's
// `addMiddleware`) - a no-op for every storage kind except `r2`, where every
// public page is now `output: "server"` (plan/auth.md phase 2). Caches a
// page's rendered HTML in the Workers Cache API, keyed by a content-version
// token that only changes when a save actually writes to R2 (see
// api-r2.ts's `update`/`getContentVersion`) - so a page stays cached
// indefinitely between saves, not for a fixed TTL, and the very next request
// after a save is guaranteed fresh (no separate "purge" step to remember,
// and no async build/deploy pipeline the way github mode has - a save IS
// the deploy).
const ADMIN_PATHS = [`/${basePath}`, `/api/${basePath}`, "/login"];

function isAdminPath(pathname: string): boolean {
  return ADMIN_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`));
}

export const onRequest = defineMiddleware(async (context, next) => {
  if (config?.storage?.kind !== "r2") return next();
  if (context.request.method !== "GET") return next();
  if (isAdminPath(context.url.pathname)) return next();

  const bucket = (await getCloudflareEnv())?.DRYSTACK_R2;
  // No binding resolved (shouldn't happen once deployed, but e.g. a
  // misconfigured preview environment) - render normally rather than 500.
  if (!bucket) return next();

  const version = await getContentVersion(bucket);
  const cacheKeyUrl = new URL(context.url);
  cacheKeyUrl.searchParams.set("__cv", version);
  const cacheKey = new Request(cacheKeyUrl.toString(), {
    method: "GET",
    headers: context.request.headers,
  });

  const cache: CacheApiLike = (globalThis as any).caches.default;
  const cached = await cache.match(cacheKey);
  if (cached) {
    const response = new Response(cached.body, cached);
    response.headers.set("x-drystack-cache", "HIT");
    return response;
  }

  const response = await next();
  const debugHeader = "x-drystack-cache";
  if (response.status !== 200) {
    response.headers.set(debugHeader, "SKIP");
    return response;
  }

  // Two independent copies with deliberately different Cache-Control:
  // Cloudflare's Cache API honors the STORED response's own Cache-Control
  // when deciding whether to keep it at all - a `max-age=0` (what the
  // client-facing copy needs, see below) makes it refuse to persist the
  // entry, so a naive single `cache.put(cacheKey, response.clone())` here
  // silently never caches anything. Give the stored copy a long max-age
  // instead - the version-keyed cache key, not this header, is what
  // actually governs when it goes stale (the next save mints a new key).
  const cacheHeaders = new Headers(response.headers);
  cacheHeaders.set("cache-control", "public, max-age=31536000, immutable");
  const toCache = new Response(response.clone().body, {
    status: response.status,
    statusText: response.statusText,
    headers: cacheHeaders,
  });

  // The copy actually sent to the browser always revalidates - browsers
  // must never hold their own stale copy past one navigation; our edge
  // cache above is the only layer allowed to persist across requests.
  response.headers.set("cache-control", "public, max-age=0, must-revalidate");
  response.headers.set(debugHeader, "MISS");

  const cfContext = (context.locals as { cfContext?: ExecutionContextLike })
    .cfContext;
  const stored = cache.put(cacheKey, toCache);
  if (cfContext) cfContext.waitUntil(stored);
  else await stored;
  return response;
});
