// Astro v6 removed `context.locals.runtime.env` - the Cloudflare adapter now
// exposes bindings/env vars via the `cloudflare:workers` module instead. That
// module only resolves when actually running on Workers (or its Miniflare
// simulation), so this is a dynamic import guarded by try/catch: it silently
// falls through to the `import.meta.env.*` lookups elsewhere on every other
// adapter (Node, etc.), where env vars come from `.env` files instead.
//
// Split out from api.tsx (which used to define this inline) so lightweight
// consumers that only need env/bindings - reader.ts, native-session.ts -
// don't pull in api.tsx's `astro`/`set-cookie-parser` imports just for this.
export async function getCloudflareEnv(): Promise<
  Record<string, any> | undefined
> {
  try {
    // @ts-expect-error - only resolves at runtime on Workers; see the comment above.
    const cf: any = await import(/* @vite-ignore */ "cloudflare:workers");
    return cf.env;
  } catch {
    return undefined;
  }
}
