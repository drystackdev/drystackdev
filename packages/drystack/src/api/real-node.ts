// Under the `@astrojs/cloudflare` adapter, `node:fs`/`node:path`/`node:crypto`
// are aliased to `unenv` polyfills - and that aliasing is applied even in the
// real Node process that serves `astro dev`'s on-demand routes. The unenv
// polyfills stub out real filesystem work (`fs.readdir` throws "[unenv]
// fs.readdir is not implemented yet!"), which breaks `storage: 'local'` file
// reads/writes during dev.
//
// `process.getBuiltinModule(id)` (Node 22+) returns the genuine builtin module
// regardless of any bundler/module aliasing, so we use it to reach the real
// `fs`/`path`/`crypto` when we're actually on Node. The static imports are the
// fallback for contexts where `getBuiltinModule` is unavailable (they resolve
// to whatever the environment provides - unenv in the Worker, real builtins in
// a plain Node process).
import fsPromisesFallback from "node:fs/promises";
import pathFallback from "node:path";
import * as cryptoFallback from "node:crypto";

const getBuiltin: ((id: string) => any) | undefined = (() => {
  try {
    const p = (globalThis as any).process;
    return typeof p?.getBuiltinModule === "function"
      ? p.getBuiltinModule.bind(p)
      : undefined;
  } catch {
    return undefined;
  }
})();

export const realFsPromises: typeof import("node:fs/promises") =
  getBuiltin?.("node:fs/promises") ?? fsPromisesFallback;
export const realPath: typeof import("node:path") =
  getBuiltin?.("node:path") ?? pathFallback;
export const realCrypto: typeof import("node:crypto") =
  getBuiltin?.("node:crypto") ?? cryptoFallback;
