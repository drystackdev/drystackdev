#!/usr/bin/env bun
// Seed the drystack R2 bucket from the repo's working tree - the one-time
// migration step when flipping `storage.kind` to 'r2' (see plan/auth.md).
//
// Uploads go through the running site's own `/api/drystack/update` route
// (NOT `wrangler r2 object put`, which URI-encodes object keys - a file
// named "a b.png" would land under the literal key "a%20b.png" and never
// match its content references). The API writes exact keys, attaches the
// blob-sha metadata the tree route needs, and enforces the same allowlist as
// every other write - so seeding also smoke-tests the real write path.
//
//   bun scripts/r2-seed.ts --email you@example.com --password <pw>
//   bun scripts/r2-seed.ts --email ... --password ... --url https://your-site.example
//
// Targets the local dev server (http://127.0.0.1:4567) by default; pass the
// deployed URL to seed the real bucket. If the target has no users yet, the
// credentials are used to create the first admin (auth/setup) before
// seeding.

import { readdirSync, statSync, existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import config from '../drystack.config';
import { getAllowedDirectories } from '../packages/drystack/src/api/allowed-directories';

const args = process.argv.slice(2);
const flagValue = (name: string) => {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : undefined;
};
const baseUrl = (flagValue('--url') ?? 'http://127.0.0.1:4567').replace(/\/+$/, '');
const email = flagValue('--email');
const password = flagValue('--password');
if (!email || !password) {
  console.error(
    'usage: bun scripts/r2-seed.ts --email <email> --password <pw> [--url <site>]'
  );
  process.exit(1);
}

const root = new URL('..', import.meta.url).pathname;

function walk(dir: string, out: string[] = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) walk(abs, out);
    else if (entry.isFile()) out.push(abs);
  }
  return out;
}

// The same allowlist api-r2.ts enforces, so everything seeded here is
// reachable and nothing else gets uploaded by accident.
const dirs = getAllowedDirectories(config as any).filter(dir =>
  existsSync(join(root, dir))
);
const files: { abs: string; key: string }[] = [];
for (const dir of dirs) {
  const base = join(root, dir);
  if (!statSync(base).isDirectory()) continue;
  for (const abs of walk(base)) {
    files.push({ abs, key: relative(root, abs) });
  }
}
if (files.length === 0) {
  console.log('Nothing to seed (no files under:', dirs.join(', '), ')');
  process.exit(0);
}

// --- authenticate (setup-on-first-run, login otherwise) ---
const origin = new URL(baseUrl).origin;
const jsonHeaders = { 'content-type': 'application/json', Origin: origin };

const statusRes = await fetch(`${baseUrl}/api/drystack/auth/status`);
if (!statusRes.ok) {
  console.error(
    `GET /api/drystack/auth/status failed (${statusRes.status}) - is the site running at ${baseUrl} with storage kind 'r2'?`
  );
  process.exit(1);
}
const status = (await statusRes.json()) as { needsSetup: boolean };
const authRoute = status.needsSetup ? 'setup' : 'login';
const authRes = await fetch(`${baseUrl}/api/drystack/auth/${authRoute}`, {
  method: 'POST',
  headers: jsonHeaders,
  body: JSON.stringify({ email, password }),
});
if (!authRes.ok) {
  console.error(`auth/${authRoute} failed (${authRes.status}):`, await authRes.text());
  process.exit(1);
}
const cookie = authRes.headers
  .getSetCookie()
  .map(value => value.split(';')[0])
  .join('; ');
if (status.needsSetup) console.log(`Created first admin ${email}.`);

// --- upload in small batches through the real write route ---
console.log(
  `Seeding ${files.length} files from [${dirs.join(', ')}] via ${baseUrl}...`
);
const BATCH = 5;
for (let i = 0; i < files.length; i += BATCH) {
  const batch = files.slice(i, i + BATCH);
  const res = await fetch(`${baseUrl}/api/drystack/update`, {
    method: 'POST',
    headers: { ...jsonHeaders, 'no-cors': '1', cookie },
    body: JSON.stringify({
      additions: batch.map(({ abs, key }) => ({
        path: key,
        contents: readFileSync(abs).toString('base64'),
      })),
      deletions: [],
    }),
  });
  if (!res.ok) {
    console.error(`FAILED batch at ${batch[0].key} (${res.status}):`, await res.text());
    process.exit(1);
  }
  for (const { key } of batch) console.log(`  ${key}`);
}
console.log('Done.');
