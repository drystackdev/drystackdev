// @ts-check

import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "astro/config"
import react from "@astrojs/react"

import sitemap from "@astrojs/sitemap";

// https://astro.build/config
export default defineConfig({
  // Domain production — dùng cho canonical URL, Open Graph, sitemap, JSON-LD.
  site: "https://drystack.dev",
  vite: {
    plugins: [tailwindcss()],
  },
  integrations: [react(), sitemap()],
})