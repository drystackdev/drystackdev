import { zipSync, strToU8 } from "fflate";
import { buildDemoDataset } from "@drystack/core/api/demo-build";
import { isDemoConfig } from "@drystack/core/storage-mode";
import type { Config } from "@drystack/core";

// Reserved key inside the zip for the manifest, namespaced with drystack's
// existing "__" convention for its own internal names (see
// REDIRECTS_SINGLETON_KEY) so it can't collide with a real content path.
const MANIFEST_KEY = "__manifest.json";

// Serves `/__data.zip` - the entire read-only dataset a demo build needs
// (see @drystack/core/app/demo-source.ts, the client-side counterpart). This
// runs once, at build time: the injected route (internal/drystack-demo-zip.js)
// is prerendered, so Astro executes this during `astro build` (in Node, with
// a real filesystem - same assumption `storage: 'local'` already makes) and
// writes the response body straight to `dist/client/__data.zip`.
//
// Not gated at the integration level (index.ts always injects this route,
// demo config or not) - checking here keeps the wiring unconditional and
// trivially correct; a non-demo site just gets a static 404 at this path.
export async function buildDemoZipResponse(
  config: Config<any, any>,
): Promise<Response> {
  if (!isDemoConfig(config)) {
    return new Response("Not Found", { status: 404 });
  }
  const { manifest, files } = await buildDemoDataset(config, process.cwd());
  const zipInput: Record<string, Uint8Array> = {
    [MANIFEST_KEY]: strToU8(JSON.stringify(manifest)),
  };
  for (const file of files) {
    zipInput[file.path] = file.contents;
  }
  const zipped = zipSync(zipInput, { level: 6 });
  return new Response(zipped, {
    headers: {
      "content-type": "application/zip",
      "cache-control": "public, max-age=3600",
    },
  });
}
