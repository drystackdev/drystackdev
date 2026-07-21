import type { AstroIntegration } from "astro";
import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  Plugin,
  ResolvedConfig,
  RunnableDevEnvironment,
  ViteDevServer,
} from "vite";
import { createRunnableDevEnvironment } from "vite";
import {
  mkdirSync,
  writeFileSync,
  readdirSync,
  readFileSync,
  existsSync,
  appendFileSync,
  cpSync,
} from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { pipeline } from "node:stream/promises";
import { basename, dirname, join, relative, sep } from "node:path";
import { load } from "js-yaml";
import {
  getCollectionPath,
  getSingletonPath,
} from "@drystack/core/path-utils";
import {
  parseRedirectEntries,
  serializeRedirectsFile,
  REDIRECTS_FILE_PATH,
} from "@drystack/core/redirects";
import { DRY_MAP_PUBLIC_PATH } from "@drystack/core/api/generic";
import { readDryMapRegistryFile, resetDryMapRegistryFile } from "./dry";

// Cloudflare's `_redirects` file caps out at 2,000 static rules (see
// https://developers.cloudflare.com/workers/static-assets/redirects/) - the
// redirect table is expected to stay tiny (it only grows across renames, and
// appendRedirect keeps it flat rather than accumulating chains), so this is a
// loud safety net, not a limit we expect to hit.
const CLOUDFLARE_REDIRECTS_LIMIT = 2000;

// A dedicated Node-runnable Vite environment for the local-storage API. The
// Cloudflare adapter turns the default `ssr` environment into a non-runnable
// workerd one, so we can't use `server.ssrLoadModule` to run the handler in
// Node. This separate environment loads/executes drystack's API modules in the
// real Node process, where `fs` writes actually work.
const DRYSTACK_NODE_ENV = "drystack_local_api";

const virtualPathModuleId = "virtual:drystack-path";
const resolvedVirtualPathModuleId = "\0" + virtualPathModuleId;

const virtualBuildVersionModuleId = "virtual:drystack-build-version";
const resolvedVirtualBuildVersionModuleId = "\0" + virtualBuildVersionModuleId;

// Runs the drystack API handler in the Node dev process (not workerd), so
// `storage: 'local'` filesystem writes work under `astro dev`. Loaded lazily
// via Vite's `ssrLoadModule` so it executes in Node with real `fs`. Only
// local and demo storage are handled here (demo shares local's read/write
// routes, minus the write itself - see api-node.ts's isDemoConfig guard);
// GitHub mode is passed through to the normal route.
async function handleLocalApiRequest(
  server: ViteDevServer,
  basePath: string,
  req: IncomingMessage,
  res: ServerResponse,
  next: (err?: unknown) => void,
): Promise<void> {
  const env = server.environments[DRYSTACK_NODE_ENV] as
    | RunnableDevEnvironment
    | undefined;
  if (!env?.runner) {
    // Environment wasn't set up (shouldn't happen in dev) - let the route try.
    return next();
  }
  const [genericMod, configMod] = await Promise.all([
    env.runner.import("@drystack/core/api/generic"),
    env.runner.import("virtual:drystack-config"),
  ]);
  const config = configMod.default;
  if (config?.storage?.kind !== "local" && config?.storage?.kind !== "demo") {
    // Let the workerd-run route handle GitHub mode.
    return next();
  }

  const handler = genericMod.makeGenericAPIRouteHandler(
    { config, basePath },
    { slugEnvName: "PUBLIC_DRYSTACK_GITHUB_APP_SLUG" },
  );

  const host = req.headers.host ?? "localhost";
  const method = req.method ?? "GET";
  const requestHeaders = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value))
      value.forEach((v) => requestHeaders.append(key, v));
    else if (value != null) requestHeaders.set(key, value);
  }

  let body: Buffer | undefined;
  if (method !== "GET" && method !== "HEAD") {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
      chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    body = Buffer.concat(chunks);
  }

  const request = new Request(`http://${host}${req.url ?? ""}`, {
    method,
    headers: requestHeaders,
    // Buffer is a Uint8Array at runtime (fine as a fetch body), but its type
    // isn't structurally assignable to BodyInit - see the same cast pattern
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
    } else if (typeof responseHeaders.entries === "function") {
      for (const [k, v] of (responseHeaders as Headers).entries())
        setHeader(k, v);
    } else {
      for (const [k, v] of Object.entries(responseHeaders)) {
        if (v != null) setHeader(k, String(v));
      }
    }
  }

  const responseBody = response.body;
  if (responseBody == null) res.end();
  else if (typeof responseBody === "string") res.end(responseBody);
  // A streaming body (the AI generate route) has to be piped through chunk by
  // chunk. `res.end(stream)` would buffer the whole thing and flush it in one
  // go, which looks exactly like a provider that isn't streaming - so getting
  // this wrong is easy to misdiagnose. Only reached in dev; production goes
  // through `new Response(body)` in api.tsx, which streams natively.
  else if (responseBody instanceof ReadableStream) {
    const { Readable } = await import("node:stream");
    await pipeline(Readable.fromWeb(responseBody as any), res);
  } else res.end(Buffer.from(responseBody as Uint8Array));
}

// Top-level project directories that never hold drystack-managed content
// assets, so the asset-copy scan skips them (`src/assets/` in particular is
// Astro's own ESM asset dir handled by `astro:assets`, not the media library).
const ASSET_COPY_EXCLUDE = new Set([
  "node_modules",
  "dist",
  "public",
  "src",
  "packages",
]);

// drystack's media library only ever writes into directories literally named
// `assets` - the shared root `assets/` and each entry's co-located
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
      if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
      const abs = join(dir, entry.name);
      if (entry.name === "assets") found.push(abs);
      else walk(abs);
    }
  };
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    if (ASSET_COPY_EXCLUDE.has(entry.name)) continue;
    const abs = join(root, entry.name);
    if (entry.name === "assets") found.push(abs);
    else walk(abs);
  }
  for (const abs of found) {
    const dest = join(clientDir, relative(root, abs));
    mkdirSync(dest, { recursive: true });
    cpSync(abs, dest, { recursive: true });
  }
}

// Turns the `redirects` singleton (redirects/index.yaml - written by
// drystack's rename/delete flow, see packages/drystack/src/app/updating.tsx)
// into a Cloudflare Workers `_redirects` file so renamed/deleted entries get a
// real edge-served 301 instead of a 404. Astro's static build already copied
// `public/_redirects` (if any) into `clientDir` by the time `astro:build:done`
// fires, so this appends rather than overwrites - a hand-authored file's
// rules stay first and win ties (Cloudflare uses the top-most matching rule).
function writeCmsRedirectsFile(root: string, clientDir: string) {
  const sourcePath = join(root, REDIRECTS_FILE_PATH);
  if (!existsSync(sourcePath)) return;
  const parsed = load(readFileSync(sourcePath, "utf8"));
  const entries = parseRedirectEntries(parsed);
  if (!entries.length) return;
  if (entries.length > CLOUDFLARE_REDIRECTS_LIMIT) {
    console.warn(
      `drystack: ${entries.length} redirects exceeds Cloudflare's ${CLOUDFLARE_REDIRECTS_LIMIT}-rule limit for _redirects - only the first ${CLOUDFLARE_REDIRECTS_LIMIT} will be written. Consider pruning old entries in the "Chuyển hướng 301" singleton.`,
    );
  }
  const body = serializeRedirectsFile(
    entries.slice(0, CLOUDFLARE_REDIRECTS_LIMIT),
  );
  if (!body) return;
  const destPath = join(clientDir, "_redirects");
  const separator = existsSync(destPath) ? "\n" : "";
  mkdirSync(clientDir, { recursive: true });
  appendFileSync(destPath, separator + body + "\n");
}

// Flushes dry.ts's build-time id→{data-dry,kind,value} registry (populated
// only for storage.kind === 'github' - see dry.ts's readSingleton) to a
// static asset, gated behind GitHub auth by the `github/dry-map` route
// (generic.ts) - not encrypted, since the registry only reveals field
// paths/kinds, not any actual site secret. Empty registry (local mode, or no
// .bind()/.view() calls at all) means nothing to write.
async function writeDryMapFile(clientDir: string) {
  const registry = readDryMapRegistryFile();
  if (Object.keys(registry).length === 0) return;
  const destPath = join(clientDir, DRY_MAP_PUBLIC_PATH);
  mkdirSync(join(clientDir, "_drystack"), { recursive: true });
  writeFileSync(destPath, JSON.stringify(registry));
}

// Checked, in order, against the project root - mirrors the extensions
// Astro/Vite would try when resolving the bare `./drystack.config` specifier
// the rest of this integration uses (see the `resolveId` plugin above).
const DRYSTACK_CONFIG_CANDIDATES = [
  "drystack.config.ts",
  "drystack.config.mts",
  "drystack.config.js",
  "drystack.config.mjs",
  "drystack.config.cjs",
];

// `astro:config:setup` runs before Vite exists, so this can't go through the
// virtual-module machinery every other config read in this file uses (see
// handleLocalApiRequest / contentRefreshDevPlugin, both of which wait for a
// running dev server). It's only needed to decide, at build time, whether
// `/${path}` can be prerendered instead of served on-demand - so it imports
// the config file directly. That only works when the process running `astro
// build` can execute the file's extension itself (this repo runs everything
// through Bun, which transpiles .ts on import; a plain Node run without a
// loader would throw).
//
// Any failure here - file not found, import throws - falls back to the
// normal on-demand route UNLESS PUBLIC_DEMO=true was explicitly passed to
// this build: that's an operator asking for a locked-down, browser-only
// public demo (see app/storage-mode.ts's isDemoConfig + app/demo-guard.ts),
// and silently shipping a real filesystem-writable /api/drystack server
// instead - because this one detection import happened to throw - would be
// a fail-open security regression, not a graceful degrade. So that specific
// combination throws and fails the build instead of swallowing the error.
async function isDemoBuild(root: URL): Promise<boolean> {
  const rootPath = fileURLToPath(root);
  for (const candidate of DRYSTACK_CONFIG_CANDIDATES) {
    const full = join(rootPath, candidate);
    if (!existsSync(full)) continue;
    try {
      const mod = await import(pathToFileURL(full).href);
      const storage = mod.default?.storage;
      return storage?.kind === "demo";
    } catch (err) {
      if (process.env.PUBLIC_DEMO === "true") {
        throw new Error(
          `PUBLIC_DEMO=true but ${candidate} could not be evaluated to confirm demo mode, so the build cannot decide between a static demo and a real on-demand server - refusing to silently fall back to a writable API. Original error: ${(err as Error).message}`
        );
      }
      return false;
    }
  }
  return false;
}

// The static demo shell (drystack-astro-page-static.astro) only ever
// produces one file, `${path}/index.html` - the page does its own
// client-side routing off `window.location`, not Astro params (see
// ui.tsx's makePage) - so every deeper `/${path}/...` URL 404s unless
// something maps it back to that same file. Appended (not written fresh)
// for the same reason writeCmsRedirectsFile appends: a hand-authored
// `public/_redirects` file, already copied into clientDir by the time
// `astro:build:done` fires, keeps its rules first.
//
// Target is `/${path}/` (a directory, no filename) rather than the more
// obvious `/${path}/index.html` - Cloudflare's redirect validator rejects
// the latter outright ("Infinite loop detected"): its own implicit
// html_handling normalizes a request for `/${path}/index.html` back down to
// `/${path}/`, which matches this same wildcard rule again. Targeting the
// directory is already the normalized form, so there's nothing left to loop
// on, and Cloudflare's own asset serving resolves it to the index file.
function writeDemoSpaFallback(clientDir: string, path: string) {
  const destPath = join(clientDir, "_redirects");
  const separator = existsSync(destPath) ? "\n" : "";
  mkdirSync(clientDir, { recursive: true });
  appendFileSync(destPath, `${separator}/${path}/* /${path}/ 200\n`);
}

// Data-file basename for an `index`-location entry (`index.yaml`,
// `index.json`, `index.md`, `index.mdx`, `index.mdoc`). A collection's data
// extension depends on its format, so match them all - a false positive only
// costs one wasted getStaticPaths re-run, never correctness.
const INDEX_DATA_FILE_RE = /^index\.(ya?ml|json|md|mdx|mdoc)$/;
// Data extension for a flat (`outer`-location) entry, e.g. `<slug>.yaml`
// sitting directly in the collection dir.
const DATA_EXT_RE = /\.(ya?ml|json|md|mdx|mdoc)$/;

// Dev-only. Makes `dry.collection(name).all()` (and therefore the
// `getStaticPaths` that feeds off it) notice brand-new / deleted / newly
// published entries without a dev-server restart.
//
// Why it's needed: with `output: 'static'`, Astro caches each route's
// getStaticPaths result and only re-runs it when the route MODULE object
// changes (see core/render/route-cache.js: `cached.mod === mod`). A route
// module changes when it - or something in its Vite import graph - is
// invalidated. drystack's reader reads entry files straight off disk via
// `node:fs`, so `blog/<new-slug>/index.yaml` is not in any module's import
// graph; Vite's watcher fires an `add` but nothing gets invalidated, the
// cached path list stays stale, and the new URL 404s until you restart.
//
// This plugin closes that gap: it watches the on-disk directories that back
// each collection/singleton (derived from the drystack config) and, when an
// entry is added, removed, or its data file changes there, invalidates every
// `.astro` page module across Vite's environments. That forces Astro to
// re-load those modules and re-run getStaticPaths on the next request, so the
// fresh slug is there when the user navigates/refreshes.
//
// Scope of what triggers it: entry *data files* (index.yaml etc., or a flat
// `<slug>.yaml`) and slug-directory add/remove. `body.html` and asset writes
// are ignored - they never change the slug set or `publish` flag, and are
// already reflected per-request (Astro re-runs each page's frontmatter, which
// re-reads via dry.entry(), on every dev request). This keeps routine CMS
// saves - which rewrite body.html + assets on every keystroke-autosave - from
// needlessly invalidating routes, while still catching a `publish: false ->
// true` flip (that edits the data file).
//
// Deliberately does NOT push a client `full-reload`: entries are usually
// created/edited from inside the drystack CMS (a React SPA route), and a
// blanket reload would discard unsaved form edits open in another tab.
// Server-side invalidation alone is enough - the next navigation/refresh of
// the public URL re-runs getStaticPaths and resolves.
function contentRefreshDevPlugin(): Plugin {
  return {
    name: "drystack:content-refresh",
    apply: "serve",
    configureServer(server) {
      // Absolute on-disk dirs backing every collection/singleton, resolved
      // once from the drystack config (executed in the Node dev env, the same
      // way the local API middleware loads it) and cached for the server's
      // lifetime.
      let contentDirsPromise: Promise<string[]> | null = null;
      const getContentDirs = () => {
        if (!contentDirsPromise) {
          contentDirsPromise = (async () => {
            const env = server.environments[DRYSTACK_NODE_ENV] as
              | RunnableDevEnvironment
              | undefined;
            if (!env?.runner) return [];
            try {
              const configMod = await env.runner.import(
                "virtual:drystack-config",
              );
              const config = configMod.default;
              const dirs: string[] = [];
              for (const name of Object.keys(config.collections ?? {})) {
                dirs.push(join(server.config.root, getCollectionPath(config, name)));
              }
              for (const name of Object.keys(config.singletons ?? {})) {
                try {
                  dirs.push(
                    join(server.config.root, getSingletonPath(config, name)),
                  );
                } catch {
                  // getSingletonPath throws on a `*`-containing path - skip it.
                }
              }
              return dirs;
            } catch {
              // Config failed to load - fall back to doing nothing rather than
              // throwing on a filesystem event.
              return [];
            }
          })();
        }
        return contentDirsPromise;
      };

      const invalidateRouteModules = () => {
        for (const env of Object.values(server.environments)) {
          const graph = (env as { moduleGraph?: any }).moduleGraph;
          if (!graph?.idToModuleMap) continue;
          for (const mod of graph.idToModuleMap.values() as Iterable<{
            file?: string | null;
          }>) {
            if (mod.file?.endsWith(".astro")) {
              graph.invalidateModule(mod);
            }
          }
        }
      };

      let timer: ReturnType<typeof setTimeout> | undefined;
      const schedule = () => {
        // Debounce: touching one entry fires a burst of events (data file +
        // body.html + assets, or a dir plus its children).
        clearTimeout(timer);
        timer = setTimeout(invalidateRouteModules, 50);
      };
      const inContentDir = (path: string, dirs: string[]) =>
        dirs.some((dir) => path === dir || path.startsWith(dir + sep));

      // add/change/unlink of a *file*: only an entry data file can change the
      // slug set or a `publish` flag - ignore body.html/asset writes.
      const onFileEvent = (file: string) => {
        getContentDirs()
          .then((dirs) => {
            if (!inContentDir(file, dirs)) return;
            const base = basename(file);
            const isDataFile =
              INDEX_DATA_FILE_RE.test(base) ||
              (DATA_EXT_RE.test(base) && dirs.includes(dirname(file)));
            if (isDataFile) schedule();
          })
          .catch(() => {});
      };
      // add/remove of a *directory*: a new/removed slug dir (its data file's
      // own event may be debounced away, so react to the dir itself too).
      const onDirEvent = (dir: string) => {
        getContentDirs()
          .then((dirs) => {
            if (inContentDir(dir, dirs)) schedule();
          })
          .catch(() => {});
      };

      server.watcher.on("add", onFileEvent);
      server.watcher.on("change", onFileEvent);
      server.watcher.on("unlink", onFileEvent);
      server.watcher.on("addDir", onDirEvent);
      server.watcher.on("unlinkDir", onDirEvent);
    },
  };
}

export default function drystack(options?: {
  path?: string;
}): AstroIntegration {
  const path = (options?.path ?? "drystack").replace(/^\/+|\/+$/g, "");
  // Captured once per build/dev-server start. Cloudflare Pages runs a fresh
  // build on every deploy, so this timestamp is monotonically increasing
  // across deploys - the client compares it against the version it last saw
  // to detect "a newer build was published" and discard stale IndexedDB edits.
  const buildVersion = Date.now();
  // Captured in `astro:config:done` (final resolved paths) and consumed in
  // `astro:build:done` to mirror drystack `assets/` dirs into the client output.
  let projectRoot: string | undefined;
  let clientOutDir: string | undefined;
  // Set in astro:config:setup (the only hook `command` and `injectRoute` are
  // both available in) and read back in astro:build:done to decide whether
  // the SPA-fallback redirect is needed - see writeDemoSpaFallback.
  let demoStaticBuild = false;
  return {
    name: "drystack",
    hooks: {
      "astro:config:done": ({ config }) => {
        projectRoot = fileURLToPath(config.root);
        clientOutDir = fileURLToPath(config.build.client);
        // Fires once, before any page renders - clears out any dry-map
        // registry file left over from a previous build so stale entries
        // (possibly assigning different ids than this build will) never mix
        // in. See dry.ts's resetDryMapRegistryFile.
        resetDryMapRegistryFile();
      },
      "astro:build:done": async () => {
        if (projectRoot && clientOutDir) {
          copyDrystackAssets(projectRoot, clientOutDir);
          writeCmsRedirectsFile(projectRoot, clientOutDir);
          await writeDryMapFile(clientOutDir);
          if (demoStaticBuild) writeDemoSpaFallback(clientOutDir, path);
        }
      },
      "astro:config:setup": async ({
        injectRoute,
        injectScript,
        updateConfig,
        config,
        command,
      }) => {
        updateConfig({
          server: config.server.host ? {} : { host: "127.0.0.1" },
          vite: {
            // Astro's default envPrefix is just "PUBLIC_" (kept here, or every
            // other PUBLIC_ var in the app stops reaching the client bundle -
            // see create-vite.js: `settings.config.vite?.envPrefix ?? "PUBLIC_"`
            // is a straight override, not a merge). The two extra entries are
            // exact full var names, not broad prefixes: Vite matches with
            // `key.startsWith(prefix)`, so "DRYSTACK_AI_URL"/"DRY_AI_MODEL"
            // only ever match themselves - never `DRY_AI_KEY` or
            // `DRY_AI_PROVIDER`, which must stay server-only. This lets demo
            // mode's Magic write (see @drystack/core's app/ai/demo-ai-env.ts)
            // read those two straight off `import.meta.env` with no `PUBLIC_`
            // alias needed.
            envPrefix: ["PUBLIC_", "DRYSTACK_AI_URL", "DRY_AI_MODEL"],
            plugins: [
              {
                name: "drystack",
                resolveId(id) {
                  if (id === "virtual:drystack-config") {
                    return this.resolve("./drystack.config", "./a");
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
              entries: ["drystack.config.*", ".astro/drystack-imports.js"],
            },
          },
        });

        const dotAstroDir = new URL("./.astro/", config.root);
        mkdirSync(dotAstroDir, { recursive: true });
        writeFileSync(
          new URL("drystack-imports.js", dotAstroDir),
          `import "@drystack/astro/ui";
import "@drystack/astro/api";
import "@drystack/core/ui";
`,
        );

        // Only attempted for `astro build` (see isDemoBuild) - dev always
        // keeps the on-demand route below, regardless of storage.kind ===
        // 'demo', so dev behavior never changes.
        demoStaticBuild =
          command === "build" && (await isDemoBuild(config.root));

        if (demoStaticBuild) {
          injectRoute({
            // @ts-ignore - kept for Astro 2/3 where the option was named `entryPoint`
            entryPoint:
              "@drystack/astro/internal/drystack-astro-page-static.astro",
            entrypoint:
              "@drystack/astro/internal/drystack-astro-page-static.astro",
            pattern: `/${path}`,
            prerender: true,
          });
        } else {
          injectRoute({
            // @ts-ignore - kept for Astro 2/3 where the option was named `entryPoint`
            entryPoint: "@drystack/astro/internal/drystack-astro-page.astro",
            entrypoint: "@drystack/astro/internal/drystack-astro-page.astro",
            pattern: `/${path}/[...params]`,
            prerender: false,
          });
          // Skipped for a static demo build: nothing calls it there (demo
          // reads go through app/demo-source.ts's `__data.zip`, and every
          // write is blocked client-side before it ever reaches the network -
          // see app/demo-guard.ts), so a demo build has no on-demand route
          // left and needs no Worker at request time.
          injectRoute({
            // @ts-ignore - kept for Astro 2/3 where the option was named `entryPoint`
            entryPoint: "@drystack/astro/internal/drystack-api.js",
            entrypoint: "@drystack/astro/internal/drystack-api.js",
            pattern: `/api/${path}/[...params]`,
            prerender: false,
          });
        }
        // Prerendered (unlike the two routes above): it needs no per-request
        // handling, so Astro executes it once during `astro build` and writes
        // the response straight to `dist/client/__data.zip` as a static file.
        // Root-level and not under `/${path}` - it's meant to be fetchable as
        // a plain public asset (see app/demo-source.ts), not an API route.
        // Always injected regardless of storage mode; buildDemoZipResponse
        // itself 404s when the config isn't a demo config.
        injectRoute({
          // @ts-ignore - kept for Astro 2/3 where the option was named `entryPoint`
          entryPoint: "@drystack/astro/internal/drystack-demo-zip.js",
          entrypoint: "@drystack/astro/internal/drystack-demo-zip.js",
          pattern: `/__data.zip`,
          prerender: true,
        });

        // Under the Cloudflare adapter, `astro dev` executes on-demand routes
        // inside workerd. workerd's node:fs compat can *read* the host disk but
        // rejects writes (`mkdir` → "operation not permitted"), so the
        // local-storage API (`/api/<path>/update`, and reads for consistency)
        // can't run there. Intercept those requests in a Node-side Vite dev
        // middleware - it runs in the real Node host where fs writes work - and
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
                  conditions: ["node", "import", "module", "default"],
                },
              },
            },
            plugins: [
              {
                name: "drystack:local-api-dev-middleware",
                apply: "serve",
                configureServer(server) {
                  const apiPrefix = `/api/${path}`;
                  server.middlewares.use((req, res, next) => {
                    const url = req.url ?? "";
                    if (
                      url !== apiPrefix &&
                      !url.startsWith(`${apiPrefix}/`) &&
                      !url.startsWith(`${apiPrefix}?`)
                    ) {
                      return next();
                    }
                    handleLocalApiRequest(server, path, req, res, next).catch(
                      next,
                    );
                  });
                },
              },
              contentRefreshDevPlugin(),
            ],
          },
        });

        // MVP 1 visual DOM editor - stage 1: tiny eligibility check present on
        // every page (dev, a logged-in-GitHub cookie in prod, or a demo
        // build). Only when eligible does it dynamically import the real
        // editor (stage 2), so anonymous visitors on a normal (non-demo)
        // production site never download the editor chunk.
        //
        // Demo builds are the one case where every visitor is meant to see
        // the toolbar with no login at all - that's the point of the mode
        // (see app/demo-guard.ts: writes still toast-block instead of
        // persisting). `demoStaticBuild` is computed once above from the
        // same isDemoBuild() check that decides the static /drystack route,
        // so this stays in sync with that switch automatically.
        injectScript(
          "page",
          `const eligible = import.meta.env.DEV || document.cookie.includes('drystack-gh-access-token=') || ${JSON.stringify(demoStaticBuild)};
if (eligible) {
  if (import.meta.env.DEV) {
    // The editor is mounted manually (not as an Astro/React island), so
    // @vitejs/plugin-react's Fast Refresh preamble - normally injected into
    // the HTML of pages with a client:* React island - never runs here.
    // Without it, the .tsx modules below (and drystack.config's own field UI
    // components, transitively imported when loading the config) throw
    // "can't detect preamble" as soon as they're evaluated. A static
    // top-level import would be hoisted and evaluated before we get a
    // chance to install the preamble, so every import below is dynamic -
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
}`,
        );
      },
    },
  };
}
