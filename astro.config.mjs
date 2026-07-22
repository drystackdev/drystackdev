// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import drystack from "@drystack/astro";

// `astro dev` runs @drystack/core and @drystack/astro straight from their
// TypeScript source (via the "drystack-src" export condition in their
// package.json) so editing those packages gets HMR again, instead of
// requiring a full `dist` rebuild + restart on every change. `astro build`
// still resolves the packages' normal "default" condition (dist), which is
// also what the published npm packages fall back to since they don't set
// this condition.
const isDev = process.argv.includes("dev");

// https://astro.build/config
export default defineConfig({
  site: "https://quangseo.drystack.dev/",
  integrations: [react(), drystack()],
  // Every route is server-rendered on demand (plan/auth.md phase 2) - none
  // of it is prerendered anymore, `/drystack` and `/api/drystack` included.
  // This is what makes a CMS save (local, github, or r2) show up on the live
  // site on the very next request, with no rebuild/redeploy in between.
  // `src/pages/sitemap.xml.ts` replaces the old @astrojs/sitemap integration
  // for the same reason - that integration only ever sees pages Astro
  // actually prerendered to static HTML, so under full SSR it would silently
  // stop listing every blog/service/knowledge-base page.
  adapter: cloudflare({
    prerenderEnvironment: "node",
    // No Cloudflare Images binding is configured, so runtime image requests
    // (any `<Image>`/`getImage()` call on a now-SSR page, e.g. a post's CMS
    // cover image) use the adapter's no-op passthrough - the original file,
    // unresized. `compile` still fully optimizes any build-time-known image
    // (a local `import ... from "../assets/x.png"`) into the deployed
    // output, exactly like before.
    imageService: { build: "compile", runtime: "passthrough" },
  }),
  output: "server",
  server: {
    port: 4567,
    host: "0.0.0.0",
  },
  vite: {
    resolve: {
      // Actually activates the "drystack-src" export condition described
      // above - without this, `isDev` was computed but never consumed, so
      // Vite always fell back to the "default" condition (dist) even in
      // `astro dev`, silently defeating the HMR-from-source setup.
      conditions: isDev ? ["drystack-src"] : [],
    },
  },
});
