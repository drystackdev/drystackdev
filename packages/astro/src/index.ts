import type { AstroIntegration } from 'astro';
import { mkdirSync, writeFileSync } from 'node:fs';

const virtualPathModuleId = 'virtual:keystatic-path';
const resolvedVirtualPathModuleId = '\0' + virtualPathModuleId;

const virtualBuildVersionModuleId = 'virtual:keystatic-build-version';
const resolvedVirtualBuildVersionModuleId = '\0' + virtualBuildVersionModuleId;

export default function keystatic(options?: { path?: string }): AstroIntegration {
  const path = (options?.path ?? 'drystack').replace(/^\/+|\/+$/g, '');
  // Captured once per build/dev-server start. Cloudflare Pages runs a fresh
  // build on every deploy, so this timestamp is monotonically increasing
  // across deploys — the client compares it against the version it last saw
  // to detect "a newer build was published" and discard stale IndexedDB edits.
  const buildVersion = Date.now();
  return {
    name: 'keystatic',
    hooks: {
      'astro:config:setup': ({ injectRoute, injectScript, updateConfig, config }) => {
        updateConfig({
          server: config.server.host ? {} : { host: '127.0.0.1' },
          vite: {
            plugins: [
              {
                name: 'keystatic',
                resolveId(id) {
                  if (id === 'virtual:keystatic-config') {
                    return this.resolve('./drystack.config', './a');
                  }
                  if (id === virtualPathModuleId) {
                    return resolvedVirtualPathModuleId;
                  }
                  if (id === virtualBuildVersionModuleId) {
                    return resolvedVirtualBuildVersionModuleId;
                  }
                  return null;
                },
                load(id) {
                  if (id === resolvedVirtualPathModuleId) {
                    return `export default ${JSON.stringify(path)};`;
                  }
                  if (id === resolvedVirtualBuildVersionModuleId) {
                    return `export default ${JSON.stringify(buildVersion)};`;
                  }
                  return null;
                },
              },
            ],
            optimizeDeps: {
              entries: ['drystack.config.*', '.astro/keystatic-imports.js'],
            },
          },
        });

        const dotAstroDir = new URL('./.astro/', config.root);
        mkdirSync(dotAstroDir, { recursive: true });
        writeFileSync(
          new URL('keystatic-imports.js', dotAstroDir),
          `import "@drystack/astro/ui";
import "@drystack/astro/api";
import "@drystack/core/ui";
`
        );

        injectRoute({
          // @ts-ignore — kept for Astro 2/3 where the option was named `entryPoint`
          entryPoint: '@drystack/astro/internal/keystatic-astro-page.astro',
          entrypoint: '@drystack/astro/internal/keystatic-astro-page.astro',
          pattern: `/${path}/[...params]`,
          prerender: false,
        });
        injectRoute({
          // @ts-ignore — kept for Astro 2/3 where the option was named `entryPoint`
          entryPoint: '@drystack/astro/internal/keystatic-api.js',
          entrypoint: '@drystack/astro/internal/keystatic-api.js',
          pattern: `/api/${path}/[...params]`,
          prerender: false,
        });

        // MVP 1 visual DOM editor — stage 1: tiny eligibility check present on
        // every page (dev, or a logged-in-GitHub cookie in prod). Only when
        // eligible does it dynamically import the real editor (stage 2), so
        // anonymous visitors never download the editor chunk.
        injectScript(
          'page',
          `const eligible = import.meta.env.DEV || document.cookie.includes('drystack-gh-access-token=');
if (eligible) {
  if (import.meta.env.DEV) {
    // The editor is mounted manually (not as an Astro/React island), so
    // @vitejs/plugin-react's Fast Refresh preamble — normally injected into
    // the HTML of pages with a client:* React island — never runs here.
    // Without it, the .tsx modules below (and drystack.config's own field UI
    // components, transitively imported when loading the config) throw
    // "can't detect preamble" as soon as they're evaluated. A static
    // top-level import would be hoisted and evaluated before we get a
    // chance to install the preamble, so every import below is dynamic —
    // dynamic imports run in the exact order awaited, unlike static ones.
    const refresh = await import('/@react-refresh');
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => (type) => type;
    window.__vite_plugin_react_preamble_installed__ = true;
  }
  const [{ default: cfg }, { default: buildVersion }, editor] = await Promise.all([
    import('virtual:keystatic-config'),
    import('virtual:keystatic-build-version'),
    import('@drystack/astro/editor'),
  ]);
  editor.mount(cfg, buildVersion);
}`
        );
      },
    },
  };
}
