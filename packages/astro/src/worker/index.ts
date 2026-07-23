// The Cloudflare Worker entrypoint for a drystack site: just the Astro
// request handler. An app uses it as its worker entry directly, no source
// file of its own:
//
//   // wrangler.jsonc
//   "main": "@drystack/astro/worker",
//
// The Astro Cloudflare adapter resolves `main` and bundles it into
// dist/server/entry.mjs. An app that needs its own routes on top swaps `main`
// back to a local file and re-exports {@link createDrystackWorker} with a
// `fetch` handler of its own.

import { handle } from "@astrojs/cloudflare/handler";

// The Cloudflare adapter types `handle` against the app's generated global
// `Env`, which drystack can't name (it doesn't exist until `wrangler types`
// runs in the app). We only ever need `ExecutionContext`, so widen at this
// one boundary rather than dragging the app's globals in here.
type AstroHandlerEnv = Parameters<typeof handle>[1];

type CreateWorkerOptions<TEnv> = {
  /**
   * Runs before the Astro handler. Return a Response to take the request;
   * return undefined to let Astro handle it.
   */
  fetch?: (
    request: Request,
    env: TEnv,
    ctx: ExecutionContext,
  ) => Response | undefined | Promise<Response | undefined>;
};

/**
 * Builds the worker's default export: the Astro handler, optionally layered
 * with app-specific routes on top.
 */
export function createDrystackWorker<TEnv = unknown>(
  options: CreateWorkerOptions<TEnv> = {},
): ExportedHandler<TEnv> {
  return {
    async fetch(request, env, ctx) {
      const fromApp = await options.fetch?.(request, env, ctx);
      if (fromApp) return fromApp;
      return handle(request, env as unknown as AstroHandlerEnv, ctx);
    },
  };
}

export default createDrystackWorker();
