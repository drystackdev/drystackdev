// @ts-check
import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";
import react from "@astrojs/react";
import drystack from "@drystack/astro";
import sitemap from "@astrojs/sitemap";

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
  integrations: [
    react(),
    drystack(),
    sitemap({
      filter: (page) =>
        !page.includes("/drystack") && !page.includes("/api/drystack"),
    }),
  ],
  // The drystack admin (/drystack) and its API (/api/drystack) are on-demand
  // routes (prerender: false) - they need a server adapter even though the
  // rest of the site stays statically prerendered.
  adapter: cloudflare({
    prerenderEnvironment: "node",
  }),
  output: "static",
  server: {
    port: 4567,
    host: "0.0.0.0",
  },
  vite: isDev
    ? {
        resolve: { conditions: ["drystack-src"] },
        ssr: { resolve: { conditions: ["drystack-src"] } },
      }
    : {},
});
