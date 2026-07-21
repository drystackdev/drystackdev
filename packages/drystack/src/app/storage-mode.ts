import { Config, GitHubConfig, LocalConfig, DemoConfig, LocalOrDemoConfig } from '../config';

// Split out from app/utils.ts (which re-exports these) so `@drystack/astro`
// can import the predicates directly (subpath "./storage-mode") without
// pulling in the rest of utils.ts, most of which only makes sense inside the
// admin app. VEI (packages/astro/src/editor/*) needs `isDemoConfig` too - it
// shares the same read paths as the admin app (see app/demo-source.ts) and
// gates its own writes independently.

export function isGitHubConfig(config: Config): config is GitHubConfig {
  return config.storage.kind === 'github';
}

// Strictly real local storage - excludes demo. Most call sites that want
// "local-shaped" behavior (no branches, no OAuth) should use
// `isLocalOrDemoConfig` below instead; this one is for the rare case that
// needs to exclude the read-only public demo specifically.
export function isLocalConfig(config: Config): config is LocalConfig {
  return config.storage.kind === 'local';
}

// Demo is local mode with the disk swapped for a prebuilt zip and every write
// turned into a toast - see DemoStorageConfig's own doc comment (config.tsx).
// Its own `storage.kind` rather than a flag on local storage, so it's *not*
// matched by `isLocalConfig` - code that wants both should use
// `isLocalOrDemoConfig`. Only code that actually touches the filesystem or an
// API route needs to ask this question on its own.
export function isDemoConfig(config: Config): config is DemoConfig {
  return config.storage.kind === 'demo';
}

// "Local-shaped" - real local storage or the demo that inherits its entire
// shape (one tree, no branches, no OAuth). Use this wherever pre-split code
// used to rely on `isLocalConfig` matching demo too; reach for `isDemoConfig`
// only when the behavior actually needs to differ for demo specifically.
export function isLocalOrDemoConfig(
  config: Config
): config is LocalOrDemoConfig {
  return config.storage.kind === 'local' || config.storage.kind === 'demo';
}
