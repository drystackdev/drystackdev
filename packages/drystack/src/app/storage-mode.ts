import { Config, DemoConfig, R2Config } from '../config';

// Split out from app/utils.ts (which re-exports these) so `@drystack/astro`
// can import the predicates directly (subpath "./storage-mode") without
// pulling in the rest of utils.ts, most of which only makes sense inside the
// admin app. VEI (packages/astro/src/editor/*) needs `isDemoConfig` too - it
// shares the same read paths as the admin app (see app/demo-source.ts) and
// gates its own writes independently.

// Demo is r2-shaped storage with the bucket swapped for a prebuilt zip and
// every write turned into a toast - see DemoStorageConfig's own doc comment
// (config.tsx). Its own `storage.kind` rather than a flag on r2, so it's
// *not* matched by `isR2Config`. Only code that actually touches the
// filesystem or an API route needs to ask this question on its own.
export function isDemoConfig(config: Config): config is DemoConfig {
  return config.storage.kind === 'demo';
}

// R2 stores content in a Cloudflare R2 bucket with the deployment made
// public, so writes (and /drystack itself) sit behind the native
// email/password login - see R2StorageConfig's doc comment (config.tsx) and
// api/api-r2.ts.
export function isR2Config(config: Config): config is R2Config {
  return config.storage.kind === 'r2';
}
