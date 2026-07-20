import { LRUCache } from "lru-cache";
import type { Client } from "urql";
import { toastQueue } from "@keystar/ui/toast";
import { useCallback, useMemo } from "react";
import {
  LocalizedStringDictionary,
  LocalizedStringFormatter,
} from "@internationalized/string";
import l10nMessages from "./l10n";
import { Config } from "../config";
import {
  AssetsFormField,
  ComponentSchema,
  ContentFormField,
  fields,
} from "../form/api";
import { parseProps } from "../form/parse-props";
import { getAuth } from "./auth";
import { loadDataFile } from "./required-files";
import { useRouter } from "./router";
import { useBaseCommit, useRepoInfo, useTree } from "./shell/data";
import { getDirectoriesForTreeKey, getTreeKey } from "./tree-key";
import { TreeNode, getTreeNodeAtPath, TreeEntry, blobSha } from "./trees";
import { LOADING, useData } from "./useData";
import { FormatInfo, getEntryDataFilepath, MaybePromise } from "./utils";
import { toFormattedFormDataError } from "../form/error-formatting";
import { parseRepoConfig, serializeRepoConfig } from "./repo-config";
import { isDemoConfig } from "./storage-mode";
import { getDemoBlob } from "./demo-source";
import {
  getBlobFromPersistedCache,
  setBlobToPersistedCache,
} from "./object-cache";

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
  const baseCommit = useBaseCommit();
  const repoInfo = useRepoInfo();
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
          const blob = fetchBlob(
            args.config,
            entry.sha,
            entry.path,
            baseCommit,
            repoInfo,
            basePath,
          );
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
      baseCommit,
      repoInfo,
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

// A blob fetch that's actively being rate-limited by GitHub - surfaced
// separately from a generic fetch failure so callers can show one shared
// "try again later" message instead of N per-thumbnail errors.
export class GitHubRateLimitError extends Error {
  resetAt: Date | null;
  constructor(resetAt: Date | null) {
    super("GitHub API rate limit reached");
    this.name = "GitHubRateLimitError";
    this.resetAt = resetAt;
  }
}

function rateLimitResetFromHeaders(headers: Headers): Date | null {
  const reset = headers.get("x-ratelimit-reset");
  if (!reset) return null;
  const seconds = Number(reset);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

const l10nDictionary = new LocalizedStringDictionary(l10nMessages);

// Non-hook fallback - notifyRateLimit runs deep in a shared blob-fetching
// path with no render-time hook access. Takes a locale snapshot rather than
// reacting to changes, fine for a one-off toast.
function getDefaultFormatter(): {
  format(key: string, variables?: Record<string, string>): string;
} {
  const locale =
    (typeof document !== "undefined" && document.documentElement.lang) ||
    (typeof navigator !== "undefined" && navigator.language) ||
    "en-US";
  return new LocalizedStringFormatter(locale, l10nDictionary);
}

// A directory of thumbnails can hit the rate limit dozens of times at once -
// show one toast per 30s window instead of one per failed blob.
let lastRateLimitToastAt = 0;
function notifyRateLimit(resetAt: Date | null) {
  const now = Date.now();
  if (now - lastRateLimitToastAt < 30_000) return;
  lastRateLimitToastAt = now;
  const stringFormatter = getDefaultFormatter();
  toastQueue.critical(
    resetAt
      ? stringFormatter.format("rateLimitReachedWithReset", {
          time: resetAt.toLocaleTimeString(),
        })
      : stringFormatter.format("rateLimitReachedNoReset"),
    { timeout: 8000 },
  );
}

// Raw content is always fetched through an authenticated REST call, even for
// public repos - an earlier version used unauthenticated
// raw.githubusercontent.com for public repos, but that endpoint is capped at
// ~60 requests/hour per browser IP, which a single directory of thumbnails
// in the File Manager can exhaust immediately. The authenticated
// `git/blobs/{oid}` endpoint shares the same binary-safe `Accept:
// application/vnd.github.raw` response shape and gets the much higher
// authenticated REST rate limit instead.
async function fetchGitHubBlob(
  config: Config,
  oid: string,
  basePath: string,
): Promise<Response> {
  const auth = await getAuth(config, basePath);
  if (config.storage.kind !== "github") {
    throw new Error("fetchGitHubBlob requires GitHub storage");
  }
  const res = await fetch(
    `https://api.github.com/repos/${serializeRepoConfig(
      config.storage.repo,
    )}/git/blobs/${oid}`,
    {
      headers: {
        Authorization: `Bearer ${auth!.accessToken}`,
        Accept: "application/vnd.github.raw",
      },
    },
  );
  if (
    !res.ok &&
    (res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0"))
  ) {
    throw new GitHubRateLimitError(rateLimitResetFromHeaders(res.headers));
  }
  return res;
}

// Caps how many blob fetches are in flight at once across the whole app -
// a File Manager directory of N thumbnails would otherwise fire N requests
// simultaneously on mount, which is both wasteful and makes hitting a rate
// limit far more likely.
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
  commitSha: string,
  repoInfo: { owner: string; name: string; isPrivate: boolean } | null,
  basePath: string,
): MaybePromise<Uint8Array> {
  if (blobCache.has(oid)) return blobCache.get(oid)!;

  const promise = (async () => {
    const isLocal = config.storage.kind === "local";
    if (!isLocal) {
      const stored = await getBlobFromPersistedCache(oid);
      if (stored) {
        blobCache.set(oid, stored);
        return stored;
      }
    }
    return runBlobFetch(() =>
      isDemoConfig(config)
        ? // No `/api/*/blob` route in a demo build - it's fully static. See
          // app/demo-source.ts. Wrapped in a real Response so it flows
          // through the exact same .ok/.arrayBuffer() handling below as the
          // other two storage kinds. Re-copied via the Uint8Array
          // constructor first: `getDemoBlob`'s array can come back typed as
          // Uint8Array<ArrayBufferLike> (e.g. a view over a fetched
          // ArrayBuffer), which BodyInit's stricter Uint8Array<ArrayBuffer>
          // doesn't accept directly - copying guarantees a plain ArrayBuffer
          // backing it.
          getDemoBlob(filepath).then(
            (array) => new Response(new Uint8Array(array)),
          )
        : isLocal
          ? fetch(`/api${basePath}/blob/${oid}/${filepath}`, {
              headers: { "no-cors": "1" },
            })
          : fetchGitHubBlob(config, oid, basePath),
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
        if (config.storage.kind !== "local") {
          setBlobToPersistedCache(oid, array);
        }
        return array;
      })
      .catch((err) => {
        blobCache.delete(oid);
        if (err instanceof GitHubRateLimitError) notifyRateLimit(err.resetAt);
        throw err;
      });
  })();

  blobCache.set(oid, promise);
  return promise;
}

const textEncoderForBatch = new TextEncoder();

// GitHub caps query cost/complexity - chunking keeps a single collection
// page from ever sending one enormous request, and keeps each request well
// under that limit regardless of collection size.
const BATCH_BLOB_CHUNK_SIZE = 100;

// Fetches many blobs in as few requests as possible. Only `storage.kind ===
// 'github'` gets real batching: it builds one GraphQL query per chunk with
// an aliased `object(oid: ...)` field per blob (GitHub's REST blob/tree
// endpoints have no bulk-read equivalent, and the root `nodes(ids:)` batch
// field takes GraphQL global ids, not git blob oids, so aliasing is the only
// way to fold N blob reads into one request). This query is intentionally
// built as a raw string rather than a `ts-gql` document - the number of
// aliases varies per call, which a statically codegen'd operation can't
// express. `local` mode has no GraphQL endpoint at all, so it falls back to
// one request per blob via `fetchBlob`.
export async function fetchBlobsBatch(
  config: Config,
  client: Client,
  entries: { oid: string; filepath: string }[],
  commitSha: string,
  repoInfo: { owner: string; name: string; isPrivate: boolean } | null,
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

  if (config.storage.kind !== "github") {
    await Promise.all(
      uncached.map(async (entry) => {
        result.set(
          entry.oid,
          await fetchBlob(
            config,
            entry.oid,
            entry.filepath,
            commitSha,
            repoInfo,
            basePath,
          ),
        );
      }),
    );
    return result;
  }

  const stillUncached: typeof entries = [];
  for (const entry of uncached) {
    const stored = await getBlobFromPersistedCache(entry.oid);
    if (stored) {
      blobCache.set(entry.oid, stored);
      result.set(entry.oid, stored);
    } else {
      stillUncached.push(entry);
    }
  }
  if (!stillUncached.length) return result;

  const repo = parseRepoConfig(config.storage.repo);

  for (
    let start = 0;
    start < stillUncached.length;
    start += BATCH_BLOB_CHUNK_SIZE
  ) {
    const chunk = stillUncached.slice(start, start + BATCH_BLOB_CHUNK_SIZE);
    const variableDefs = chunk
      .map((_, i) => `$oid${i}: GitObjectID!`)
      .join(", ");
    const selections = chunk
      .map((_, i) => `e${i}: object(oid: $oid${i}) { ... on Blob { text } }`)
      .join("\n");
    const query = `query BatchBlobs($owner: String!, $name: String!, ${variableDefs}) {
      repository(owner: $owner, name: $name) {
        ${selections}
      }
    }`;
    const variables: Record<string, string> = {
      owner: repo.owner,
      name: repo.name,
    };
    chunk.forEach((entry, i) => {
      variables[`oid${i}`] = entry.oid;
    });

    const res = await client.query(query, variables).toPromise();
    if (res.error) throw res.error;
    const repository = res.data?.repository as
      | Record<string, { text?: string | null } | null>
      | undefined;
    chunk.forEach((entry, i) => {
      const text = repository?.[`e${i}`]?.text ?? "";
      const bytes = textEncoderForBatch.encode(text);
      blobCache.set(entry.oid, bytes);
      setBlobToPersistedCache(entry.oid, bytes);
      result.set(entry.oid, bytes);
    });
  }

  return result;
}
