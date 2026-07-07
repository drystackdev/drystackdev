// @ts-check
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import drystack from '@drystack/astro';

// https://astro.build/config
export default defineConfig({
  integrations: [react(), drystack()],
});
