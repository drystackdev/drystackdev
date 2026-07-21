import {
  Config,
  GitHubConfig,
  LocalConfig,
  DemoConfig,
  R2Config,
  LocalShapedConfig,
} from '../config';

// Split out from app/utils.ts (which re-exports these) so `@drystack/astro`
// can import the predicates directly (subpath "./storage-mode") without
// pulling in the rest of utils.ts, most of which only makes sense inside the
// admin app. VEI (packages/astro/src/editor/*) needs `isDemoConfig` too - it
// shares the same read paths as the admin app (see app/demo-source.ts) and
// gates its own writes independently.

export function isGitHubConfig(config: Config): config is GitHubConfig {
  return config.storage.kind === 'github';
}

// Strictly real local storage - excludes demo and r2. Most call sites that
// want "local-shaped" behavior (no branches, no OAuth) should use
// `isLocalShapedConfig` below instead; this one is for the rare case that
// needs the developer's own filesystem specifically.
export function isLocalConfig(config: Config): config is LocalConfig {
  return config.storage.kind === 'local';
}

// Demo is local mode with the disk swapped for a prebuilt zip and every write
// turned into a toast - see DemoStorageConfig's own doc comment (config.tsx).
// Its own `storage.kind` rather than a flag on local storage, so it's *not*
// matched by `isLocalConfig` - code that wants both should use
// `isLocalShapedConfig`. Only code that actually touches the filesystem or an
// API route needs to ask this question on its own.
export function isDemoConfig(config: Config): config is DemoConfig {
  return config.storage.kind === 'demo';
}

// R2 is local mode with the disk swapped for a Cloudflare R2 bucket and the
// deployment made public, so writes (and /drystack itself) sit behind the
// native email/password login - see R2StorageConfig's doc comment
// (config.tsx) and api/api-r2.ts. Matched by `isLocalShapedConfig` like demo;
// branch on this directly only where R2 genuinely differs (auth gating, the
// server-side storage backend).
export function isR2Config(config: Config): config is R2Config {
  return config.storage.kind === 'r2';
}

// "Local-shaped" - real local storage, the demo, or r2: one tree, no
// branches, no OAuth, reads/writes over the local REST routes. Use this
// wherever pre-split code used to rely on `isLocalConfig` matching demo too;
// reach for `isDemoConfig`/`isR2Config` only when the behavior actually needs
// to differ for that mode specifically.
export function isLocalShapedConfig(
  config: Config
): config is LocalShapedConfig {
  return (
    config.storage.kind === 'local' ||
    config.storage.kind === 'demo' ||
    config.storage.kind === 'r2'
  );
}
