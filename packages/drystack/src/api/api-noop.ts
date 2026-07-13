// This module is selected via the `#api-handler` export condition whenever
// Vite resolves with the worker/workerd conditions (i.e. the Cloudflare
// adapter) instead of `node`. But that condition is applied at *bundle* time,
// while the actual runtime can still be real Node.js — most importantly during
// `astro dev`, whose on-demand routes execute in the Node dev process even
// though the Cloudflare adapter tags the module graph as worker. So, exactly
// like `packages/astro/src/reader.ts`, we detect a real Node runtime at
// request time and delegate to the Node implementation when it's available.
// Only a genuinely non-Node runtime (the deployed Worker, where local storage
// can't work anyway) falls through to the 500 stub. `./api-node` is imported
// dynamically so its node:fs/node:path/node:crypto imports are never evaluated
// in the Worker bundle.
import type * as ApiNode from './api-node';
import { exchangeGitHubAppManifestCode } from './github-app-manifest';
import { redirect } from './internal-utils';
import { webcrypto } from '#webcrypto';
import { bytesToHex } from '../hex';

// `process` may be entirely absent in some runtimes; guard defensively (same
// shape as reader.ts's `hasBuildTimeFilesystem`).
function hasNodeRuntime(): boolean {
  try {
    return !!(globalThis as any).process?.versions?.node;
  } catch {
    return false;
  }
}

// `hasNodeRuntime()` alone isn't a safe enough signal to gate "write
// GitHub App secrets to the local .env file": Cloudflare's newer
// `enable_nodejs_process_v2` compat flag makes `process.versions.node`
// non-empty even on the real deployed Worker (this repo isn't opted into
// that compat date yet, but a routine future bump could flip it), and any
// self-hosted-Node deployment (outside the Cloudflare adapter entirely) has
// a real Node runtime with `NODE_ENV=production`. Either way, writing to
// `.env` on a live, publicly reachable deployment from an anonymous
// visitor's manifest code would let them plant their own GitHub App
// credentials into the site's real config. Require the same NODE_ENV signal
// the rest of this codebase already uses to mean "this is `astro dev` on my
// own machine", in addition to the Node-shape check.
function canPersistGitHubAppSecretsToDisk(): boolean {
  try {
    const p = (globalThis as any).process;
    return !!p?.versions?.node && p?.env?.NODE_ENV === 'development';
  } catch {
    return false;
  }
}

export const localModeApiHandler: typeof ApiNode.localModeApiHandler = (
  config,
  localBaseDirectory
) => {
  let realHandler: ReturnType<typeof ApiNode.localModeApiHandler> | undefined;
  return async (req, params) => {
    if (hasNodeRuntime()) {
      if (!realHandler) {
        const mod = await import('./api-node');
        realHandler = mod.localModeApiHandler(config, localBaseDirectory);
      }
      return realHandler(req, params);
    }
    return {
      status: 500,
      body: "The drystack API route is running in a non-Node.js environment which is not supported with `storage: { kind: 'local' }`",
    };
  };
};

export const handleGitHubAppCreation: typeof ApiNode.handleGitHubAppCreation =
  async (req, slugEnvVarName, uiBasePath) => {
    if (canPersistGitHubAppSecretsToDisk()) {
      const mod = await import('./api-node');
      return mod.handleGitHubAppCreation(req, slugEnvVarName, uiBasePath);
    }
    // No writable filesystem here (a real Worker, Miniflare, or any
    // deployed target) — exchange the code with GitHub, but instead of
    // persisting the result, hand the generated secrets back to the client
    // once via the redirect's URL fragment, so the site owner can copy them
    // into their host's own secret manager. The fragment is never sent to
    // any server on the next request and never lands in access logs, unlike
    // a query string.
    const result = await exchangeGitHubAppManifestCode(req);
    if (!result.ok) return result.response;
    const { slug, client_id, client_secret } = result.data;
    const secret = bytesToHex(webcrypto.getRandomValues(new Uint8Array(40)));
    const fragment = new URLSearchParams({
      DRYSTACK_GITHUB_CLIENT_ID: client_id,
      DRYSTACK_GITHUB_CLIENT_SECRET: client_secret,
      DRYSTACK_SECRET: secret,
    }).toString();
    return redirect(
      `${uiBasePath}/created-github-app?slug=${encodeURIComponent(slug)}#${fragment}`
    );
  };
