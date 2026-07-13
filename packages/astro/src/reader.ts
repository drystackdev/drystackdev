import type { Config } from '@drystack/core';

// `createReader` (node:fs) needs a real filesystem with the repo checked
// out. That's true in local dev, and also true during `astro build`'s
// prerender phase on Cloudflare (astro.config.mjs sets
// `prerenderEnvironment: 'node'`, so prerendering runs as a real Node
// process against the freshly-cloned repo, not inside a Workers
// simulation). So we prefer the local reader whenever a real filesystem is
// actually available, regardless of `storage.kind` — `storage.kind` alone
// can't distinguish "building on Cloudflare" from "live in the deployed
// Worker" since both have the same non-dev config. The GitHub reader is
// the fallback for contexts with no filesystem at all, e.g. a genuinely
// live `prerender: false` route running post-deploy in the Worker runtime.
// Both readers are dynamically imported so the unused one (and its
// node:fs/node:path imports, in the "local" reader's case) is never
// evaluated — a static import would pull node:fs/promises into the
// Workers bundle even when never called.
async function hasBuildTimeFilesystem(): Promise<boolean> {
  try {
    if (!process.versions?.node) return false;
    const { existsSync } = await import('node:fs');
    return existsSync(process.cwd());
  } catch {
    return false;
  }
}

export async function createConfiguredReader(config: Config<any, any>) {
  if (config.storage.kind === 'local' || (await hasBuildTimeFilesystem())) {
    const { createReader } = await import('@drystack/core/reader');
    return createReader(process.cwd(), config);
  }
  if (config.storage.kind === 'github') {
    const { createGitHubReader } = await import(
      '@drystack/core/reader/github'
    );
    const repo = config.storage.repo;
    const repoString = (
      typeof repo === 'string' ? repo : `${repo.owner}/${repo.name}`
    ).replace(/\.git$/, '');
    return createGitHubReader(config, {
      repo: repoString as `${string}/${string}`,
      pathPrefix: config.storage.pathPrefix,
      // Unauthenticated GitHub API requests are capped at 60/hour — enough
      // to trip during repeated local builds. Set DRYSTACK_GITHUB_TOKEN in
      // .env (a classic PAT with public_repo/repo read access) to build
      // against the authenticated 5000/hour limit instead.
      token: import.meta.env.DRYSTACK_GITHUB_TOKEN,
    });
  }
  throw new Error(
    `createConfiguredReader(): MVP 1 chưa hỗ trợ storage.kind "${(config.storage as any).kind}"`
  );
}
