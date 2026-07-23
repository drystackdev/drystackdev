// This module is selected via the `#api-handler` export condition whenever
// Vite resolves with the worker/workerd conditions (i.e. the Cloudflare
// adapter) instead of `node`. But that condition is applied at *bundle* time,
// while the actual runtime can still be real Node.js - most importantly during
// `astro dev`, whose on-demand routes execute in the Node dev process even
// though the Cloudflare adapter tags the module graph as worker. So, exactly
// like `packages/astro/src/reader.ts`, we detect a real Node runtime at
// request time and delegate to the Node implementation when it's available.
// Only a genuinely non-Node runtime (the deployed Worker, where this handler
// can't work anyway) falls through to the 500 stub. `./api-node` is imported
// dynamically so its node:fs/node:path/node:crypto imports are never evaluated
// in the Worker bundle.
import type * as ApiNode from "./api-node";

// `process` may be entirely absent in some runtimes; guard defensively (same
// shape as reader.ts's `hasBuildTimeFilesystem`).
function hasNodeRuntime(): boolean {
  try {
    return !!(globalThis as any).process?.versions?.node;
  } catch {
    return false;
  }
}

export const localModeApiHandler: typeof ApiNode.localModeApiHandler = (
  config,
  localBaseDirectory,
) => {
  let realHandler: ReturnType<typeof ApiNode.localModeApiHandler> | undefined;
  return async (req, params) => {
    if (hasNodeRuntime()) {
      if (!realHandler) {
        const mod = await import("./api-node");
        realHandler = mod.localModeApiHandler(config, localBaseDirectory);
      }
      return realHandler(req, params);
    }
    return {
      status: 500,
      body: "The drystack API route requires a Node.js runtime, which this environment doesn't have",
    };
  };
};
