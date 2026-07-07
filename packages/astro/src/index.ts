import type { AstroIntegration } from 'astro';
import { mkdirSync, writeFileSync } from 'node:fs';

const virtualPathModuleId = 'virtual:keystatic-path';
const resolvedVirtualPathModuleId = '\0' + virtualPathModuleId;

export default function keystatic(options?: { path?: string }): AstroIntegration {
  const path = (options?.path ?? 'drystack').replace(/^\/+|\/+$/g, '');
  return {
    name: 'keystatic',
    hooks: {
      'astro:config:setup': ({ injectRoute, updateConfig, config }) => {
        updateConfig({
          server: config.server.host ? {} : { host: '127.0.0.1' },
          vite: {
            plugins: [
              {
                name: 'keystatic',
                resolveId(id) {
                  if (id === 'virtual:keystatic-config') {
                    return this.resolve('./keystatic.config', './a');
                  }
                  if (id === virtualPathModuleId) {
                    return resolvedVirtualPathModuleId;
                  }
                  return null;
                },
                load(id) {
                  if (id === resolvedVirtualPathModuleId) {
                    return `export default ${JSON.stringify(path)};`;
                  }
                  return null;
                },
              },
            ],
            optimizeDeps: {
              entries: ['keystatic.config.*', '.astro/keystatic-imports.js'],
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
      },
    },
  };
}
