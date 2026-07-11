import type { Config } from '@drystack/core';

// `createReader` (node:fs) only works where a real filesystem exists — i.e.
// local dev. Cloudflare Workers has none, not even for prerendering static
// pages at build time (the Cloudflare adapter builds inside a Workers
// simulation, not plain Node). For "github" storage — used in production —
// fetch content over HTTP instead, which works everywhere (Node, Workers, or
// otherwise). Both readers are dynamically imported so the unused one (and
// its node:fs/node:path imports, in the "local" reader's case) is never
// evaluated — a static import would pull node:fs/promises into the Workers
// bundle even when never called.
export async function createConfiguredReader(config: Config<any, any>) {
  if (config.storage.kind === 'local') {
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
    });
  }
  throw new Error(
    `createConfiguredReader(): MVP 1 chưa hỗ trợ storage.kind "${(config.storage as any).kind}"`
  );
}
