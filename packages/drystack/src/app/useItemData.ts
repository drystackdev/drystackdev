import { LRUCache } from "lru-cache";
import { useCallback, useMemo } from "react";
import { Config } from "../config";
import {
  AssetsFormField,
  ComponentSchema,
  ContentFormField,
  fields,
} from "../form/api";
import { parseProps } from "../form/parse-props";
import { loadDataFile } from "./required-files";
import { useRouter } from "./router";
import { useTree } from "./shell/data";
import { getDirectoriesForTreeKey, getTreeKey } from "./tree-key";
import { TreeNode, getTreeNodeAtPath, TreeEntry, blobSha } from "./trees";
import { LOADING, useData } from "./useData";
import { FormatInfo, getEntryDataFilepath, MaybePromise } from "./utils";
import { toFormattedFormDataError } from "../form/error-formatting";
import { isDemoConfig } from "./storage-mode";
import { getDemoBlob } from "./demo-source";
import { setBlobToPersistedCache } from "./object-cache";

class TrackedMap<K, V> extends Map<K, V> {
  #onGet: (key: K) => void;
  constructor(
    onGet: (key: K) => void,
    entries?: readonly (readonly [K, V])[] | null,
  ) {
    super(entries);
    this.#onGet = onGet;
  }
  get(key: K) {
    this.#onGet(key);
    return super.get(key);
  }
}

export function parseEntry(
  args: {
    dirpath: string;
    format: FormatInfo;
    schema: Record<string, ComponentSchema>;
    slug: { slug: string; field: string } | undefined;
    requireFrontmatter?: boolean;
  },
  files: Map<string, Uint8Array>,
) {
  const dataFilepath = getEntryDataFilepath(args.dirpath, args.format);
  const data = files.get(dataFilepath);
  if (!data) {
    throw new Error(`Could not find data file at ${dataFilepath}`);
  }
  const { loaded, extraFakeFile } = loadDataFile(
    data,
    args.format,
    args.requireFrontmatter,
  );
  const filesWithFakeFile = new Map(files);
  if (extraFakeFile) {
    filesWithFakeFile.set(
      `${args.dirpath}/${extraFakeFile.path}`,
      extraFakeFile.contents,
    );
  }
  const usedFiles = new Set([dataFilepath]);
  const rootSchema = fields.object(args.schema);
  let initialState;

  const getFile = (filepath: string) => {
    usedFiles.add(filepath);
    return filesWithFakeFile.get(filepath);
  };
  const getFilesForAssetsOrContentField = (
    rootPath: string,
    schema: ContentFormField<any, any, any> | AssetsFormField<any, any, any>,
  ) => {
    const otherFiles = new TrackedMap<string, Uint8Array>((key) => {
      usedFiles.add(`${rootPath}/${key}`);
    });
    const otherDirectories = new Map<string, TrackedMap<string, Uint8Array>>();

    for (const [filename] of filesWithFakeFile) {
      if (filename.startsWith(rootPath + "/")) {
        const relativePath = filename.slice(rootPath.length + 1);
        otherFiles.set(relativePath, filesWithFakeFile.get(filename)!);
      }
    }
    for (const dir of schema.directories ?? []) {
      const dirFiles = new TrackedMap<string, Uint8Array>((relativePath) =>
        usedFiles.add(start + relativePath),
      );
      const start = `${dir}${
        args.slug?.slug === undefined ? "" : `/${args.slug?.slug}`
      }/`;
      for (const [filename, val] of filesWithFakeFile) {
        if (filename.startsWith(start)) {
          const relativePath = filename.slice(start.length);
          dirFiles.set(relativePath, val);
        }
      }
      if (dirFiles.size) {
        otherDirectories.set(dir, dirFiles);
      }
    }
    return { other: otherFiles, external: otherDirectories };
  };
  try {
    initialState = parseProps(
      rootSchema,
      loaded,
      [],
      [],
      (schema, value, path, pathWithArrayFieldSlugs) => {
        if (path.length === 1 && path[0] === args.slug?.field) {
          if (schema.formKind !== "slug") {
            throw new Error(`slugField is not a slug field`);
          }
          return schema.parse(value, { slug: args.slug.slug });
        }
        if (schema.formKind === "asset") {
          const suggestedFilenamePrefix = pathWithArrayFieldSlugs.join("/");
          const filepath = schema.filename(value, {
            suggestedFilenamePrefix,
            slug: args.slug?.slug,
          });
          const asset = filepath
            ? getFile(
                `${
                  schema.directory
                    ? `${schema.directory}${
                        args.slug?.slug === undefined
                          ? ""
                          : `/${args.slug.slug}`
                      }`
                    : args.dirpath
                }/${filepath}`,
              )
            : undefined;

          return schema.parse(value, { asset, slug: args.slug?.slug });
        }
        if (schema.formKind === "content" || schema.formKind === "assets") {
          const rootPath = `${args.dirpath}/${pathWithArrayFieldSlugs.join(
            "/",
          )}`;
          // embedded assets (images, etc.) live in a directory shared by every
          // field in this entry, not split per field path - see the "This
          // entry" media scope in markdoc/ui.tsx and the matching write path
          // in serialize-props.ts
          const { external, other } = getFilesForAssetsOrContentField(
            `${args.dirpath}/assets`,
            schema,
          );

          const content = schema.contentExtension
            ? getFile(rootPath + schema.contentExtension)
            : undefined;
          return schema.parse(value, {
            content,
            other,
            external,
            slug: args.slug?.slug,
          });
        }

        return schema.parse(value, undefined);
      },
      false,
    );
  } catch (err) {
    throw toFormattedFormDataError(err);
  }

  if (extraFakeFile) {
    usedFiles.delete(`${args.dirpath}/${extraFakeFile.path}`);
  }

  return { initialState, initialFiles: [...usedFiles] };
}

type UseItemDataArgs = {
  config: Config;
  schema: Record<string, ComponentSchema>;
  dirpath: string;
  format: FormatInfo;
  slug: { slug: string; field: string } | undefined;
};

function getAllFilesInTree(tree: Map<string, TreeNode>): TreeEntry[] {
  return [...tree.values()].flatMap((val) =>
    val.children ? getAllFilesInTree(val.children) : [val.entry],
  );
}

export function useItemData(args: UseItemDataArgs) {
  const { current: currentBranch } = useTree();
  const { basePath } = useRouter();

  const rootTree =
    currentBranch.kind === "loaded" ? currentBranch.data.tree : undefined;
  const locationsForTreeKey = useMemo(
    () =>
      getDirectoriesForTreeKey(
        fields.object(args.schema),
        args.dirpath,
        args.slug?.slug,
        args.format,
      ),
    [args.dirpath, args.format, args.schema, args.slug?.slug],
  );
  const localTreeKey = useMemo(
    () => getTreeKey(locationsForTreeKey, rootTree ?? new Map()),
    [locationsForTreeKey, rootTree],
  );
  const tree = useMemo(() => {
    return rootTree ?? new Map();
    // eslint-disable-next-line react-compiler/react-compiler
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localTreeKey, locationsForTreeKey]);

  const hasLoaded = currentBranch.kind === "loaded";

  return useData(
    useCallback((): MaybePromise<
      | "not-found"
      | {
          initialState: Record<string, unknown>;
          initialFiles: string[];
          localTreeKey: string;
        }
    > => {
      if (!hasLoaded) return LOADING;
      const dataFilepathSha = getTreeNodeAtPath(
        tree,
        getEntryDataFilepath(args.dirpath, args.format),
      )?.entry.sha;
      if (dataFilepathSha === undefined) {
        return "not-found" as const;
      }
      const _args = {
        dirpath: args.dirpath,
        format: args.format,
        schema: args.schema,
        slug: args.slug,
      };
      const allBlobs = locationsForTreeKey
        .flatMap((dir) => {
          const node = getTreeNodeAtPath(tree, dir);
          if (!node) return [];
          return node.children
            ? getAllFilesInTree(node.children)
            : [node.entry];
        })
        .map((entry) => {
          const blob = fetchBlob(args.config, entry.sha, entry.path, basePath);
          if (blob instanceof Uint8Array) {
            return [entry.path, blob] as const;
          }
          return blob.then((blob) => [entry.path, blob] as const);
        });

      if (
        allBlobs.every((x): x is readonly [string, Uint8Array] =>
          Array.isArray(x),
        )
      ) {
        const { initialFiles, initialState } = parseEntry(
          _args,
          new Map(allBlobs),
        );

        return {
          initialState,
          initialFiles,
          localTreeKey,
        };
      }

      return Promise.all(allBlobs).then(async (data) => {
        const { initialState, initialFiles } = parseEntry(_args, new Map(data));
        return {
          initialState,
          initialFiles,
          localTreeKey,
        };
      });
    }, [
      hasLoaded,
      tree,
      args.dirpath,
      args.format,
      args.config,
      args.schema,
      args.slug,
      locationsForTreeKey,
      localTreeKey,
      basePath,
    ]),
  );
}

// Budget the in-memory blob cache by bytes rather than entry count: image
// blobs vary enormously in size, so a fixed 200-entry cap either wastes memory
// on many tiny files or evicts recently-viewed large images far too eagerly.
// Pending-promise entries count as 1 byte and are re-set with their real size
// once resolved (see the `blobCache.set(oid, array)` calls below).
const BLOB_CACHE_MAX_BYTES = 64 * 1024 * 1024;
const blobCache = new LRUCache<string, MaybePromise<Uint8Array>>({
  maxSize: BLOB_CACHE_MAX_BYTES,
  // Clamp so a single oversized blob can't exceed maxSize (which would make
  // lru-cache throw) - it just evicts everything else and stays resident.
  sizeCalculation: (value) =>
    value instanceof Uint8Array
      ? Math.min(BLOB_CACHE_MAX_BYTES, Math.max(1, value.byteLength))
      : 1,
});

export async function hydrateBlobCache(contents: Uint8Array) {
  const sha = await blobSha(contents);
  blobCache.set(sha, contents);
  await setBlobToPersistedCache(sha, contents);
  return sha;
}

// Caps how many blob fetches are in flight at once across the whole app -
// a File Manager directory of N thumbnails would otherwise fire N requests
// simultaneously on mount, which is both wasteful and unnecessary.
const BLOB_FETCH_CONCURRENCY = 6;
let activeBlobFetches = 0;
const blobFetchQueue: (() => void)[] = [];

function runBlobFetch<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      activeBlobFetches++;
      fn()
        .then(resolve, reject)
        .finally(() => {
          activeBlobFetches--;
          blobFetchQueue.shift()?.();
        });
    };
    if (activeBlobFetches < BLOB_FETCH_CONCURRENCY) run();
    else blobFetchQueue.push(run);
  });
}

export function fetchBlob(
  config: Config,
  oid: string,
  filepath: string,
  basePath: string,
): MaybePromise<Uint8Array> {
  if (blobCache.has(oid)) return blobCache.get(oid)!;

  const promise = (async () => {
    return runBlobFetch(() =>
      isDemoConfig(config)
        ? // No `/api/*/blob` route in a demo build - it's fully static. See
          // app/demo-source.ts. Wrapped in a real Response so it flows
          // through the exact same .ok/.arrayBuffer() handling below as r2.
          // Re-copied via the Uint8Array constructor first: `getDemoBlob`'s
          // array can come back typed as Uint8Array<ArrayBufferLike> (e.g. a
          // view over a fetched ArrayBuffer), which BodyInit's stricter
          // Uint8Array<ArrayBuffer> doesn't accept directly - copying
          // guarantees a plain ArrayBuffer backing it.
          getDemoBlob(filepath).then(
            (array) => new Response(new Uint8Array(array)),
          )
        : fetch(`/api${basePath}/blob/${oid}/${filepath}`, {
            headers: { "no-cors": "1" },
          }),
    )
      .then(async (x) => {
        if (!x.ok) {
          throw new Error(
            `Could not fetch blob ${oid} (${filepath}): ${
              x.status
            }\n${await x.text()}`,
          );
        }
        return x.arrayBuffer();
      })
      .then((x) => {
        const array = new Uint8Array(x);
        blobCache.set(oid, array);
        return array;
      })
      .catch((err) => {
        blobCache.delete(oid);
        throw err;
      });
  })();

  blobCache.set(oid, promise);
  return promise;
}

// Fetches many blobs at once. There's no bulk-read endpoint, so this just
// fans out to `fetchBlob` per entry (concurrency-limited there); kept as its
// own function so collection pages can await one Map of results.
export async function fetchBlobsBatch(
  config: Config,
  entries: { oid: string; filepath: string }[],
  basePath: string,
): Promise<Map<string, Uint8Array>> {
  const result = new Map<string, Uint8Array>();
  const uncached: typeof entries = [];
  for (const entry of entries) {
    const cached = blobCache.get(entry.oid);
    if (cached !== undefined) {
      result.set(entry.oid, await cached);
    } else {
      uncached.push(entry);
    }
  }
  if (!uncached.length) return result;

  await Promise.all(
    uncached.map(async (entry) => {
      result.set(
        entry.oid,
        await fetchBlob(config, entry.oid, entry.filepath, basePath),
      );
    }),
  );
  return result;
}
