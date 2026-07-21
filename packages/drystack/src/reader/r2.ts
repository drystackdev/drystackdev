import { Collection, ComponentSchema, Config, Singleton } from '..';
import {
  BaseReader,
  MinimalFs,
  collectionReader,
  singletonReader,
} from './generic';
import { R2BucketLike, listAll } from '../api/api-r2';

export type { Entry, EntryWithResolvedLinkedFiles } from './generic';

export type Reader<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
> = BaseReader<Collections, Singletons>;

// Phase 2 of the r2/auth plan (plan/auth.md): reads content straight from
// the R2 bucket at request time, for the case `@drystack/astro`'s reader.ts
// falls back to - a genuinely deployed Worker with no build-time filesystem
// (dev and the Cloudflare build's Node prerender env both read the local
// checkout instead; see reader.ts's `hasBuildTimeFilesystem`).
//
// Unlike the GitHub reader, there's no "fetch the whole tree once" step:
// R2 keys are addressed directly (same paths api-r2.ts writes, unprefixed),
// so `readFile`/`fileExists` are single-object calls and `readdir` is a
// prefix listing - each roughly as cheap as the local fs reader's syscalls,
// just over the R2 binding instead.
export function createR2Reader<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
>(
  config: Config<Collections, Singletons>,
  bucket: R2BucketLike
): Reader<Collections, Singletons> {
  const fs: MinimalFs = {
    async fileExists(path) {
      return !!(await bucket.head(path));
    },
    async readdir(path) {
      const prefix = path === '' ? '' : `${path}/`;
      const objects = await listAll(bucket, prefix);
      // R2's flat key space has no real directories - split each object key
      // on the first '/' past the prefix to recover immediate children, the
      // same shape node:fs/promises.readdir({withFileTypes:true}) gives the
      // local reader. A key with no further '/' is a file at this level; one
      // with more path left is a descendant of a (deduped) child directory.
      const seenDirs = new Set<string>();
      const entries: { name: string; kind: 'file' | 'directory' }[] = [];
      for (const obj of objects) {
        const rest = obj.key.slice(prefix.length);
        if (!rest) continue;
        const slash = rest.indexOf('/');
        if (slash === -1) {
          entries.push({ name: rest, kind: 'file' });
        } else {
          const dir = rest.slice(0, slash);
          if (!seenDirs.has(dir)) {
            seenDirs.add(dir);
            entries.push({ name: dir, kind: 'directory' });
          }
        }
      }
      return entries;
    },
    async readFile(path) {
      const object = await bucket.get(path);
      if (!object) return null;
      return new Uint8Array(await object.arrayBuffer());
    },
  };
  return {
    collections: Object.fromEntries(
      Object.keys(config.collections || {}).map(key => [
        key,
        collectionReader(key, config as Config, fs),
      ])
    ) as any,
    singletons: Object.fromEntries(
      Object.keys(config.singletons || {}).map(key => [
        key,
        singletonReader(key, config as Config, fs),
      ])
    ) as any,
    config,
  };
}
