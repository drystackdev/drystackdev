import { Config, GitHubConfig, LocalConfig } from '../config';

// Split out from app/utils.ts (which re-exports these) so `@drystack/astro`
// can import the predicates directly (subpath "./storage-mode") without
// pulling in the rest of utils.ts, most of which only makes sense inside the
// admin app. VEI (packages/astro/src/editor/*) needs `isDemoConfig` too - it
// shares the same read paths as the admin app (see app/demo-source.ts) and
// gates its own writes independently.

export function isGitHubConfig(config: Config): config is GitHubConfig {
  return config.storage.kind === 'github';
}

export function isLocalConfig(config: Config): config is LocalConfig {
  return config.storage.kind === 'local';
}

// Demo is local mode with the disk swapped for a prebuilt zip and every write
// turned into a toast. Note this is deliberately *not* mutually exclusive with
// `isLocalConfig` - a demo config is a local config, and every local branch in
// the app stays correct for it. Only code that actually touches the filesystem
// or an API route needs to ask this question on top.
//
// The return type references `LocalConfig['storage']` itself (rather than a
// hand-written literal) so a narrowed `config.storage.ai` stays in sync with
// LocalStorageConfig's real shape (config.tsx) instead of silently drifting.
export function isDemoConfig(
  config: Config
): config is LocalConfig & {
  storage: LocalConfig['storage'] & { demo: true };
} {
  return config.storage.kind === 'local' && config.storage.demo === true;
}
