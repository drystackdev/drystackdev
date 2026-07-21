#!/usr/bin/env node
// Post-processes a `PUBLIC_DEMO=true astro build` output: Astro's Cloudflare
// adapter always splits into dist/client + dist/server for consistency with
// real (github-mode) builds - see astro's public/integrations.d.ts. A demo
// build has no on-demand routes at all (isDemoBuild in
// packages/astro/src/index.ts swaps them for static equivalents), so
// dist/server ends up empty. This moves dist/client/* up into dist/ directly
// and removes the empty dist/server, purely for a flatter local dist/ layout.
//
// Refuses to touch anything if dist/server isn't empty, so running this
// against a real (non-demo) build - which does put actual worker code in
// dist/server - is a safe no-op-with-error rather than data loss.
import { existsSync, readdirSync, renameSync, rmdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const distDir = fileURLToPath(new URL("../dist/", import.meta.url));
const clientDir = join(distDir, "client");
const serverDir = join(distDir, "server");

if (!existsSync(clientDir)) {
  console.error("flatten-demo-dist: dist/client not found - run the build first.");
  process.exit(1);
}

if (existsSync(serverDir)) {
  if (readdirSync(serverDir).length > 0) {
    console.error(
      "flatten-demo-dist: dist/server is not empty - this looks like a real " +
        "(non-demo) build with actual server output, refusing to delete it.",
    );
    process.exit(1);
  }
  rmdirSync(serverDir);
}

for (const entry of readdirSync(clientDir)) {
  renameSync(join(clientDir, entry), join(distDir, entry));
}
rmdirSync(clientDir);

console.log("flatten-demo-dist: moved dist/client/* into dist/, removed empty dist/server.");
