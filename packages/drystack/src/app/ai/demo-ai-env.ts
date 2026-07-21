// Resolves the two env vars that drive Magic write/rewrite in demo mode:
// `DRYSTACK_AI_URL` (the proxy's base URL - see ai-proxy/src/worker.ts) and
// `DRY_AI_MODEL` (shared with the real, authenticated ai route - see
// api/ai/env.ts - rather than a demo-only duplicate). No `storage.ai` config
// block exists for this anymore (see config.tsx's DemoStorageConfig): demo
// mode is on if and only if `DRYSTACK_AI_URL` is set, full stop - it never
// falls back to DRY_AI_KEY/DRY_AI_PROVIDER, which are for the direct-provider
// path only. Unlike `PUBLIC_DEMO`, these two reach the browser bundle
// without a `PUBLIC_` alias, via an extra `vite.envPrefix` entry (see
// packages/astro/src/index.ts) - exact-name prefixes, so `DRY_AI_KEY`/
// `DRY_AI_PROVIDER` (different names) are never swept in by accident.
//
// Same three-context dance as config.tsx's `config()` (raw Bun import / Vite
// SSR / Vite client bundle) and the same rule: the `import.meta.env.X`
// access must appear as this exact literal text, never through an aliased
// variable or computed lookup, or Vite's client-bundle inlining silently
// skips it. Factoring the *lookup* into these two functions is fine - each
// still contains the literal form in its own body - only aliasing the `.env`
// object itself isn't.
type ViteMeta = { env: Record<string, string | undefined> };

export function getDemoAiUrl(): string | undefined {
  const viteEnvIsDefined =
    typeof (import.meta as unknown as ViteMeta).env !== "undefined";
  return viteEnvIsDefined
    ? (import.meta as unknown as ViteMeta).env.DRYSTACK_AI_URL
    : typeof process !== "undefined"
      ? process.env.DRYSTACK_AI_URL
      : undefined;
}

export function getDemoAiModel(): string | undefined {
  const viteEnvIsDefined =
    typeof (import.meta as unknown as ViteMeta).env !== "undefined";
  return viteEnvIsDefined
    ? (import.meta as unknown as ViteMeta).env.DRY_AI_MODEL
    : typeof process !== "undefined"
      ? process.env.DRY_AI_MODEL
      : undefined;
}
