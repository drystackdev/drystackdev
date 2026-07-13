// The Cloudflare Worker entrypoint (`main` in wrangler.jsonc). Everything it
// does lives in drystack — the Astro handler and the BuildStatusHub Durable
// Object that backs the deploy progress UI. Re-exported here because Cloudflare
// resolves Durable Object classes off the entry module.
export { BuildStatusHub, default } from '@drystack/astro/worker';
