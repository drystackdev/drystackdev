import type { AstroIntegration } from 'astro';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { ResolvedConfig, RunnableDevEnvironment, ViteDevServer } from 'vite';
import { createRunnableDevEnvironment } from 'vite';
import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  appendFileSync,
  cpSync,
} from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import { load } from 'js-yaml';
import {
  parseRedirectEntries,
  serializeRedirectsFile,
  REDIRECTS_FILE_PATH,
} from '@drystack/core/redirects';
import { DRY_MAP_PUBLIC_PATH } from '@drystack/core/api/generic';
import { readDryMapRegistryFile, resetDryMapRegistryFile } from './dry';

// Cloudflare's `_redirects` file caps out at 2,000 static rules (see
// https://developers.cloudflare.com/workers/static-assets/redirects/) — the
// redirect table is expected to stay tiny (it only grows across renames, and
// appendRedirect keeps it flat rather than accumulating chains), so this is a
// loud safety net, not a limit we expect to hit.
const CLOUDFLARE_REDIRECTS_LIMIT = 2000;

// A dedicated Node-runnable Vite environment for the local-storage API. The
// Cloudflare adapter turns the default `ssr` environment into a non-runnable
// workerd one, so we can't use `server.ssrLoadModule` to run the handler in
// Node. This separate environment loads/executes drystack's API modules in the
// real Node process, where `fs` writes actually work.
const DRYSTACK_NODE_ENV = 'drystack_local_api';

const virtualPathModuleId = 'virtual:drystack-path';
const resolvedVirtualPathModuleId = '\0' + virtualPathModuleId;

const virtualBuildVersionModuleId = 'virtual:drystack-build-version';
const resolvedVirtualBuildVersionModuleId = '\0' + virtualBuildVersionModuleId;

// Runs the drystack API handler in the Node dev process (not workerd), so
// `storage: 'local'` filesystem writes work under `astro dev`. Loaded lazily
// via Vite's `ssrLoadModule` so it executes in Node with real `fs`. Only local
// storage is handled here; other modes are passed through to the normal route.
async function handleLocalApiRequest(
  server: ViteDevServer,
  basePath: string,
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void
): Promise<void> {
  const env = server.environments[DRYSTACK_NODE_ENV] as
    | RunnableDevEnvironment
    | undefined;
  if (!env?.runner) {
    // Environment wasn't set up (shouldn't happen in dev) — let the route try.
    return next();
  }
  const [genericMod, configMod] = await Promise.all([
    env.runner.import('@drystack/core/api/generic'),
    env.runner.import('virtual:drystack-config'),
  ]);
  const config = configMod.default;
  if (config?.storage?.kind !== 'local') {
    // Let the workerd-run route handle GitHub mode.
    return next();
  }

  const handler = genericMod.makeGenericAPIRouteHandler(
    { config, basePath },
    { slugEnvName: 'PUBLIC_DRYSTACK_GITHUB_APP_SLUG' }
  );

  const host = req.headers.host ?? 'localhost';
  const method = req.method ?? 'GET';
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach(v => requestHeaders.append(key, v));
    else if (value != null) requestHeaders.set(key, value);
  }

  let body: Buffer | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
    }
    body = Buffer.concat(chunks);
  }

  const request = new Request(`http://${host}${req.url ?? ''}`, {
    method,
    headers: requestHeaders,
    // Buffer is a Uint8Array at runtime (fine as a fetch body), but its type
    // isn't structurally assignable to BodyInit — see the same cast pattern
    // for pending-blob bytes in Toolbar.tsx/bind.ts.
    body: body as BodyInit | undefined,
  });

  const response = await handler(request);

  res.statusCode = response.status;
  const responseHeaders = response.headers;
  if (responseHeaders) {
    const setHeader = (k: string, v: string) => res.setHeader(k, v);
    if (Array.isArray(responseHeaders)) {
      for (const [k, v] of responseHeaders) setHeader(k, v);
    } else if (typeof responseHeaders.entries === 'function') {
      for (const [k, v] of (responseHeaders as Headers).entries()) setHeader(k, v);
    } else {
      for (const [k, v] of Object.entries(responseHeaders)) {
        if (v != null) setHeader(k, String(v));
      }
    }
  }

  const responseBody = response.body;
  if (responseBody == null) res.end();
  else if (typeof responseBody === 'string') res.end(responseBody);
  else res.end(Buffer.from(responseBody as Uint8Array));
}

// Top-level project directories that never hold drystack-managed content
// assets, so the asset-copy scan skips them (`src/assets/` in particular is
// Astro's own ESM asset dir handled by `astro:assets`, not the media library).
const ASSET_COPY_EXCLUDE = new Set([
  'node_modules',
  'dist',
  'public',
  'src',
  'packages',
]);

// drystack's media library only ever writes into directories literally named
// `assets` — the shared root `assets/` and each entry's co-located
// `<collection>/<slug>/assets/`. Astro's static build copies `public/` into the
// client output but knows nothing about these dirs, so every CMS-managed image
// 404s once deployed. This mirrors those `assets/` dirs into the client output,
// preserving their repo-relative path, so the `/…/assets/<file>` URLs stored in
// image fields resolve in production. Works for both storage kinds: the files
// are on disk at build time (local mode: the dev disk; github mode: the repo
// checkout Cloudflare builds from). `.deleted` trash dirs are skipped so files
// the user removed via the File Manager don't get republished.
function copyDrystackAssets(root: string, clientDir: string) {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const abs = join(dir, entry.name);
      if (entry.name === 'assets') found.push(abs);
      else walk(abs);
    }
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
    if (ASSET_COPY_EXCLUDE.has(entry.name)) continue;
    const abs = join(root, entry.name);
    if (entry.name === 'assets') found.push(abs);
    else walk(abs);
  }
  for (const abs of found) {
    const dest = join(clientDir, relative(root, abs));
    mkdirSync(dest, { recursive: true });
    cpSync(abs, dest, { recursive: true });
  }
}

// Turns the `redirects` singleton (redirects/index.yaml — written by
// drystack's rename/delete flow, see packages/drystack/src/app/updating.tsx)
// into a Cloudflare Workers `_redirects` file so renamed/deleted entries get a
// real edge-served 301 instead of a 404. Astro's static build already copied
// `public/_redirects` (if any) into `clientDir` by the time `astro:build:done`
// fires, so this appends rather than overwrites — a hand-authored file's
// rules stay first and win ties (Cloudflare uses the top-most matching rule).
function writeCmsRedirectsFile(root: string, clientDir: string) {
  const sourcePath = join(root, REDIRECTS_FILE_PATH);
  if (!existsSync(sourcePath)) return;
  const parsed = load(readFileSync(sourcePath, 'utf8'));
  const entries = parseRedirectEntries(parsed);
  if (!entries.length) return;
  if (entries.length > CLOUDFLARE_REDIRECTS_LIMIT) {
    console.warn(
      `drystack: ${entries.length} redirects exceeds Cloudflare's ${CLOUDFLARE_REDIRECTS_LIMIT}-rule limit for _redirects — only the first ${CLOUDFLARE_REDIRECTS_LIMIT} will be written. Consider pruning old entries in the "Chuyển hướng 301" singleton.`
    );
  }
  const body = serializeRedirectsFile(entries.slice(0, CLOUDFLARE_REDIRECTS_LIMIT));
  if (!body) return;
  const destPath = join(clientDir, '_redirects');
  const separator = existsSync(destPath) ? '\n' : '';
  mkdirSync(clientDir, { recursive: true });
  appendFileSync(destPath, separator + body + '\n');
}

// Flushes dry.ts's build-time id→{data-dry,kind,value} registry (populated
// only for storage.kind === 'github' — see dry.ts's readSingleton) to a
// static asset, gated behind GitHub auth by the `github/dry-map` route
// (generic.ts) — not encrypted, since the registry only reveals field
// paths/kinds, not any actual site secret. Empty registry (local mode, or no
// dry.item() calls at all) means nothing to write.
async function writeDryMapFile(clientDir: string) {
  const registry = readDryMapRegistryFile();
  if (Object.keys(registry).length === 0) return;
  const destPath = join(clientDir, DRY_MAP_PUBLIC_PATH);
  mkdirSync(join(clientDir, '_drystack'), { recursive: true });
  writeFileSync(destPath, JSON.stringify(registry));
}

export default function drystack(options?: { path?: string }): AstroIntegration {
  const path = (options?.path ?? 'drystack').replace(/^\/+|\/+$/g, '');
  // Captured once per build/dev-server start. Cloudflare Pages runs a fresh
  // build on every deploy, so this timestamp is monotonically increasing
  // across deploys — the client compares it against the version it last saw
  // to detect "a newer build was published" and discard stale IndexedDB edits.
  const buildVersion = Date.now();
  // Captured in `astro:config:done` (final resolved paths) and consumed in
  // `astro:build:done` to mirror drystack `assets/` dirs into the client output.
  let projectRoot: string | undefined;
  let clientOutDir: string | undefined;
  return {
    name: 'drystack',
    hooks: {
      'astro:config:done': ({ config }) => {
        projectRoot = fileURLToPath(config.root);
        clientOutDir = fileURLToPath(config.build.client);
        // Fires once, before any page renders — clears out any dry-map
        // registry file left over from a previous build so stale entries
        // (possibly assigning different ids than this build will) never mix
        // in. See dry.ts's resetDryMapRegistryFile.
        resetDryMapRegistryFile();
      },
      'astro:build:done': async () => {
        if (projectRoot && clientOutDir) {
          copyDrystackAssets(projectRoot, clientOutDir);
          writeCmsRedirectsFile(projectRoot, clientOutDir);
          await writeDryMapFile(clientOutDir);
        }
      },
      'astro:config:setup': ({ injectRoute, injectScript, updateConfig, config }) => {
        updateConfig({
          server: config.server.host ? {} : { host: '127.0.0.1' },
          vite: {
            plugins: [
              {
                name: 'drystack',
                resolveId(id) {
                  if (id === 'virtual:drystack-config') {
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
              entries: ['drystack.config.*', '.astro/drystack-imports.js'],
            },
          },
        });

        const dotAstroDir = new URL('./.astro/', config.root);
        mkdirSync(dotAstroDir, { recursive: true });
        writeFileSync(
          new URL('drystack-imports.js', dotAstroDir),
          `import "@drystack/astro/ui";
import "@drystack/astro/api";
import "@drystack/core/ui";
`
        );

        injectRoute({
          // @ts-ignore — kept for Astro 2/3 where the option was named `entryPoint`
          entryPoint: '@drystack/astro/internal/drystack-astro-page.astro',
          entrypoint: '@drystack/astro/internal/drystack-astro-page.astro',
          pattern: `/${path}/[...params]`,
          prerender: false,
        });
        injectRoute({
          // @ts-ignore — kept for Astro 2/3 where the option was named `entryPoint`
          entryPoint: '@drystack/astro/internal/drystack-api.js',
          entrypoint: '@drystack/astro/internal/drystack-api.js',
          pattern: `/api/${path}/[...params]`,
          prerender: false,
        });

        // Under the Cloudflare adapter, `astro dev` executes on-demand routes
        // inside workerd. workerd's node:fs compat can *read* the host disk but
        // rejects writes (`mkdir` → "operation not permitted"), so the
        // local-storage API (`/api/<path>/update`, and reads for consistency)
        // can't run there. Intercept those requests in a Node-side Vite dev
        // middleware — it runs in the real Node host where fs writes work — and
        // run the exact same handler `drystack-api.js` uses. GitHub-mode
        // requests (OAuth, app creation) fall through to the workerd route.
        updateConfig({
          vite: {
            environments: {
              [DRYSTACK_NODE_ENV]: {
                dev: {
                  // `createRunnableDevEnvironment` gives us a Node module
                  // runner (unlike the workerd `ssr` environment).
                  createEnvironment(name: string, viteConfig: ResolvedConfig) {
                    return createRunnableDevEnvironment(name, viteConfig);
                  },
                },
                resolve: {
                  // Real Node resolution (not workerd) so `#api-handler` and
                  // node builtins point at the filesystem-capable versions.
                  conditions: ['node', 'import', 'module', 'default'],
                },
              },
            },
            plugins: [
              {
                name: 'drystack:local-api-dev-middleware',
                apply: 'serve',
                configureServer(server) {
                  const apiPrefix = `/api/${path}`;
                  server.middlewares.use((req, res, next) => {
                    const url = req.url ?? '';
                    if (
                      url !== apiPrefix &&
                      !url.startsWith(`${apiPrefix}/`) &&
                      !url.startsWith(`${apiPrefix}?`)
                    ) {
                      return next();
                    }
                    handleLocalApiRequest(server, path, req, res, next).catch(
                      next
                    );
                  });
                },
              },
            ],
          },
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
    import('virtual:drystack-config'),
    import('virtual:drystack-build-version'),
    import('@drystack/astro/editor'),
  ]);
  editor.mount(cfg, buildVersion);
}`
        );
      },
    },
  };
}
