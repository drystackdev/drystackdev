import type {
  ArrayField,
  Config,
  ComponentSchema,
  ObjectField,
} from "@drystack/core";
import {
  getSingletonPath,
  getSingletonFormat,
  getEntryDataFilepath,
} from "@drystack/core/path-utils";
import { loadDataFile } from "@drystack/core/required-files";
import { dump } from "@drystack/core/yaml";
import {
  contentAssetsDir,
  contentEntryDir,
  getSyncableFieldKind,
  isAssetKind,
  resolveSchemaAtFieldPath,
  spliceValueEdit,
} from "@drystack/core/edit-sync";
import { clientSideValidateProp } from "@drystack/core/field-editor";
import { getAuth } from "@drystack/core/auth";
// @ts-expect-error - provided by the drystack Astro integration's Vite plugin
import apiPath from "virtual:drystack-path";
import {
  getAllEdits,
  publishClear,
  clearPendingBlobs,
  getPendingBlobsUnder,
} from "./store";
import {
  readBrandRecord,
  writeBrandRecord,
  type BrandRecord,
} from "@drystack/core/brand-store";
import { formatBrandLabel, formatBrandRef } from "@drystack/core/brand-label";

const textEncoder = new TextEncoder();

export function base64Encode(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++)
    binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\n/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function getGithubToken(): string | null {
  const match = document.cookie.match(
    /(?:^|;\s*)drystack-gh-access-token=([^;]+)/,
  );
  return match ? decodeURIComponent(match[1]) : null;
}

// The access-token cookie is short-lived (GitHub's OAuth expiry, a few
// hours) and nothing refreshes it while a user only ever interacts with this
// live-site toolbar - the admin SPA's urql authExchange, which normally
// keeps it alive, is never mounted in that case. Try the still-valid,
// much-longer-lived refresh-token cookie before treating the session as
// gone, so a save/publish that lands after a long idle stretch on this page
// doesn't fail outright.
export async function getGithubTokenWithRefresh(
  config: Config<any, any>,
): Promise<string | null> {
  const token = getGithubToken();
  if (token) return token;
  const auth = await getAuth(config, `/${apiPath}`);
  return auth?.accessToken ?? null;
}

export function parseRepo(repo: string | { owner: string; name: string }) {
  if (typeof repo === "string") {
    const [owner, name] = repo.split("/");
    return { owner, name };
  }
  return repo;
}

type FileToWrite = { path: string; contents: Uint8Array };
export type FileDiff = {
  path: string;
  before: string;
  after: string;
  // The exact bytes to write, when they can't be recovered by encoding
  // `after` - an image embedded in a fields.content body. `before`/`after`
  // are left as human-readable placeholders for the diff UI in that case.
  contents?: Uint8Array;
};

const textDecoder = new TextDecoder();

// Carries GitHub's machine-readable error `type` (e.g. "STALE_DATA",
// "BRANCH_PROTECTION_RULE_VIOLATION") so callers can react to specific
// failure modes instead of only having a joined message string.
export class GithubGraphQLError extends Error {
  type?: string;
  constructor(message: string, type?: string) {
    super(message);
    this.type = type;
  }
}

export async function githubGraphQL(
  token: string,
  query: string,
  variables: Record<string, unknown>,
) {
  const res = await fetch("https://api.github.com/graphql", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new GithubGraphQLError(
      json.errors.map((e: { message: string }) => e.message).join("; "),
      json.errors[0]?.type,
    );
  }
  return json.data;
}

const refQuery = `
  query GetRef($owner: String!, $name: String!) {
    repository(owner: $owner, name: $name) {
      defaultBranchRef {
        name
        target { oid }
      }
    }
  }
`;

async function getDefaultBranch(token: string, owner: string, name: string) {
  const data = await githubGraphQL(token, refQuery, { owner, name });
  const ref = data?.repository?.defaultBranchRef;
  if (!ref)
    throw new Error(`Could not find the default branch of ${owner}/${name}`);
  return { branchName: ref.name as string, oid: ref.target.oid as string };
}

const branchRefQuery = `
  query GetBranchRef($owner: String!, $name: String!, $qualifiedName: String!) {
    repository(owner: $owner, name: $name) {
      ref(qualifiedName: $qualifiedName) {
        name
        target { oid }
      }
    }
  }
`;

// Like getDefaultBranch, but for an arbitrary ref (e.g. a brand branch) -
// returns null (rather than throwing) when the ref doesn't exist, since
// callers use that to detect a deleted/rotated brand and recreate one.
async function getBranchRef(
  token: string,
  owner: string,
  name: string,
  qualifiedName: string,
): Promise<{ branchName: string; oid: string } | null> {
  const data = await githubGraphQL(token, branchRefQuery, {
    owner,
    name,
    qualifiedName,
  });
  const ref = data?.repository?.ref;
  if (!ref) return null;
  return { branchName: ref.name as string, oid: ref.target.oid as string };
}

const createBrandRefMutation = `
  mutation CreateBrandRef($input: CreateRefInput!) {
    createRef(input: $input) { ref { id } }
  }
`;

// Raw-GraphQL brand creation, shared by ensureBrand (below) and deploy.ts's
// post-merge brand rotation - the VEI has no urql client, so unlike the
// admin's createBrand (brand.tsx) this talks to GitHub directly.
export async function createBrandRaw(
  config: Config<any, any>,
  args: {
    token: string;
    repositoryId: string;
    login: string;
    viewerName: string;
    branchPrefix?: string;
    fromOid: string;
  },
): Promise<BrandRecord | null> {
  const now = new Date();
  const ref = formatBrandRef(args.branchPrefix, now);
  const label = formatBrandLabel(now, args.viewerName, "Editor");
  const created = await githubGraphQL(args.token, createBrandRefMutation, {
    input: {
      name: `refs/heads/${ref}`,
      oid: args.fromOid,
      repositoryId: args.repositoryId,
    },
  });
  if (!created?.createRef?.ref?.id) return null;
  const record: BrandRecord = {
    ref,
    label,
    login: args.login,
    createdAt: now.getTime(),
  };
  await writeBrandRecord(config as any, record);
  return record;
}

const repoAndViewerQuery = `
  query VeiEnsureBrand($owner: String!, $name: String!) {
    viewer { login name }
    repository(owner: $owner, name: $name) {
      id
      defaultBranchRef { target { oid } }
    }
  }
`;

// The brand branch Save commits to. Reuses the locally-remembered brand if
// GitHub still has it (mirrors useBrandGuard's adopt-or-recreate logic in
// brand.tsx), otherwise creates a fresh one off the current default-branch
// HEAD - unlike the admin app, nothing guarantees a brand already exists
// before the VEI's Save runs (a user editing straight from the live site may
// never have opened /drystack), so Save must be able to create its own.
export async function ensureBrand(
  config: Config<any, any>,
  token: string,
  owner: string,
  name: string,
): Promise<BrandRecord> {
  const existing = await readBrandRecord(config as any);
  if (existing) {
    const stillExists = await getBranchRef(
      token,
      owner,
      name,
      `refs/heads/${existing.ref}`,
    );
    if (stillExists) return existing;
  }
  const data = await githubGraphQL(token, repoAndViewerQuery, { owner, name });
  const repo = data?.repository;
  const login: string | undefined = data?.viewer?.login;
  const viewerName: string = data?.viewer?.name ?? login ?? "editor";
  if (!repo?.id || !repo?.defaultBranchRef?.target?.oid || !login) {
    throw new Error(
      "Could not resolve the repository or GitHub viewer to create a brand branch.",
    );
  }
  const storage = config.storage as { branchPrefix?: string };
  const created = await createBrandRaw(config, {
    token,
    repositoryId: repo.id,
    login,
    viewerName,
    branchPrefix: storage.branchPrefix,
    fromOid: repo.defaultBranchRef.target.oid,
  });
  if (!created) throw new Error("Could not create a brand branch.");
  return created;
}

const createCommitMutation = `
  mutation CreateCommit($input: CreateCommitOnBranchInput!) {
    createCommitOnBranch(input: $input) {
      ref { id target { id oid } }
    }
  }
`;

async function readCurrentFile(
  config: Config<any, any>,
  filepath: string,
  githubBranchName?: string,
): Promise<Uint8Array | null> {
  if (config.storage.kind === "local") {
    const treeRes = await fetch(`/api/${apiPath}/tree`, {
      headers: { "no-cors": "1" },
    });
    if (!treeRes.ok) throw new Error("Could not read the current file tree");
    const entries: { path: string; sha: string }[] = await treeRes.json();
    const entry = entries.find((e) => e.path === filepath);
    if (!entry) return null;
    const blobRes = await fetch(
      `/api/${apiPath}/blob/${entry.sha}/${filepath}`,
      {
        headers: { "no-cors": "1" },
      },
    );
    if (!blobRes.ok)
      throw new Error("Could not read the current file contents");
    return new Uint8Array(await blobRes.arrayBuffer());
  }
  if (config.storage.kind === "github") {
    const token = await getGithubTokenWithRefresh(config);
    if (!token) throw new Error("Not signed in to GitHub");
    const { owner, name } = parseRepo((config.storage as any).repo);
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/contents/${filepath}?ref=${githubBranchName}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
      },
    );
    if (res.status === 404) return null;
    if (!res.ok)
      throw new Error("Could not read the current file contents from GitHub");
    const json = await res.json();
    return decodeBase64ToBytes(json.content);
  }
  throw new Error(
    `dry(): MVP 1 does not support storage.kind "${(config.storage as any).kind}"`,
  );
}

// Every file under a singleton's own `assets/` directory, keyed the way a
// fields.content field's `other` map expects: a path relative to that
// directory (mirrors the admin's own getFilesForAssetsOrContentField in
// app/useItemData.ts).
//
// The visual editor must hydrate this *before* parsing a content field's HTML
// into an editor state. An <img src="foo.png"> whose bytes aren't in the map
// parses into a node carrying 0 bytes (html/parse.ts's UNHYDRATED_IMAGE_BYTES),
// and serializing that node back writes `src="/media-library/foo.png"`
// instead (html/serialize.ts only keeps the entry-scoped path when it has
// real bytes to write beside it) - so skipping this would silently repoint
// every embedded image to the shared library the first time anyone typed in
// the field.
//
// Flat listing only: the admin writes embedded images directly into
// `assets/`, never a subdirectory of it.
export async function listAssetFiles(
  config: Config<any, any>,
  singletonName: string,
  githubBranchName?: string,
  // The content field's own dotted path (e.g. "brand.name") - a nested
  // content field's embedded images live under their own subdirectory
  // (contentAssetsDir) rather than the singleton's shared `assets/`, so two
  // content fields never collide on a same-named image. Omitted (or a
  // top-level field with no dots) keeps the flat singleton-wide directory.
  dottedField?: string,
): Promise<Map<string, Uint8Array>> {
  const dir = dottedField
    ? contentAssetsDir(getSingletonPath(config, singletonName), dottedField)
    : `${getSingletonPath(config, singletonName)}/assets`;
  const out = new Map<string, Uint8Array>();
  if (config.storage.kind === "local") {
    const treeRes = await fetch(`/api/${apiPath}/tree`, {
      headers: { "no-cors": "1" },
    });
    if (!treeRes.ok) throw new Error("Could not read the current file tree");
    const entries: { path: string; sha: string }[] = await treeRes.json();
    await Promise.all(
      entries
        .filter((e) => e.path.startsWith(`${dir}/`))
        .map(async (e) => {
          const res = await fetch(`/api/${apiPath}/blob/${e.sha}/${e.path}`, {
            headers: { "no-cors": "1" },
          });
          if (!res.ok) return;
          out.set(
            e.path.slice(dir.length + 1),
            new Uint8Array(await res.arrayBuffer()),
          );
        }),
    );
    return out;
  }
  if (config.storage.kind === "github") {
    const token = await getGithubTokenWithRefresh(config);
    if (!token) throw new Error("Not signed in to GitHub");
    const { owner, name } = parseRepo((config.storage as any).repo);
    const headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    };
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/contents/${dir}?ref=${githubBranchName}`,
      { headers },
    );
    // A singleton with no embedded images has no assets/ directory at all -
    // an expected state, not a failure.
    if (res.status === 404) return out;
    if (!res.ok) throw new Error("Could not list assets from GitHub");
    const listing = await res.json();
    if (!Array.isArray(listing)) return out;
    await Promise.all(
      listing
        .filter((e: any) => e.type === "file")
        .map(async (e: any) => {
          // The contents API inlines base64 only below 1MB and omits it
          // above; the blobs API has no such cutoff, so go straight there.
          const blobRes = await fetch(
            `https://api.github.com/repos/${owner}/${name}/git/blobs/${e.sha}`,
            { headers: { ...headers, Accept: "application/vnd.github.raw" } },
          );
          if (!blobRes.ok) return;
          out.set(e.name, new Uint8Array(await blobRes.arrayBuffer()));
        }),
    );
    return out;
  }
  throw new Error(
    `dry(): MVP 1 does not support storage.kind "${(config.storage as any).kind}"`,
  );
}

// Every pending edit must satisfy its own field's schema.validate before it's
// allowed to reach disk/GitHub - the visual editor writes raw DOM text/paths
// straight into YAML, so without this a required/min-length/pattern field
// could be saved empty or malformed. Mirrors the admin form's
// clientSideValidateProp gate (packages/drystack/src/form/errors.ts).
// Validates the *merged* value per base field (see mergeFieldEdits below), not
// each raw bus entry independently - a fields.array's min/max length check
// needs the whole array, not just whichever index/container edit happened to
// be pending.
//
// fields.array/fields.object's schema (unlike fields.text/fields.image) has
// no `.validate` method of its own - length/element/nested-field validation
// lives in form/errors.ts's validateValueWithSchema, reachable here only
// through the public clientSideValidateProp wrapper (re-exported at
// @drystack/core/field-editor for the visual editor's container dialog). It
// returns a bool and only console.warns the specific failure, so the
// message pushed here is a generic fallback rather than the precise reason.
function validateField(
  name: string,
  baseField: string,
  schema: Record<string, ComponentSchema>,
  value: unknown,
  messages: string[],
): void {
  const baseSchema = schema[baseField];
  if (baseSchema?.kind === "array" || baseSchema?.kind === "object") {
    if (!clientSideValidateProp(baseSchema, value, undefined)) {
      messages.push(`${name}.${baseField} is invalid`);
    }
    return;
  }
  try {
    (
      baseSchema as
        | { validate?: (value: unknown, args?: unknown) => unknown }
        | undefined
    )?.validate?.(value, undefined);
  } catch (err) {
    messages.push(
      err instanceof Error ? err.message : `${name}.${baseField} is invalid`,
    );
  }
}

// Mirrors fields.image/fields.file's serialize (omit the key when there's no
// value, see form/fields/image|file/index.tsx), recursively through nested
// array/object structure - the reader's image.parse/file.parse throws on a
// literal `null`, so an empty asset leaf must be absent from the YAML, not
// written as null/''. Runs once over the whole merged container value after
// every edit has been spliced in (mergeFieldEdits below), since a leaf's
// presence/absence only matters in the final shape, not per edit.
function stripEmptyAssetLeaves(
  value: unknown,
  schema: ComponentSchema,
): unknown {
  if (schema.kind === "array") {
    if (!Array.isArray(value)) return value;
    const element = (schema as ArrayField<ComponentSchema>).element;
    return value.map((item) => stripEmptyAssetLeaves(item, element));
  }
  if (schema.kind === "object") {
    if (typeof value !== "object" || value === null) return value;
    const obj = { ...(value as Record<string, unknown>) };
    for (const [sub, subSchema] of Object.entries(
      (schema as ObjectField).fields,
    )) {
      if (
        isAssetKind(getSyncableFieldKind(subSchema)) &&
        (obj[sub] === null || obj[sub] === "" || obj[sub] === undefined)
      ) {
        delete obj[sub];
      } else if (sub in obj) {
        obj[sub] = stripEmptyAssetLeaves(obj[sub], subSchema);
      }
    }
    return obj;
  }
  return value;
}

// Merges every pending edit for one base field into the value that should be
// written to `data[baseField]`. A fields.text/fields.image edit is always a
// single flat entry (field === baseField). A fields.array/fields.object edit
// can be a whole-container replace (the dialog's container-level edit, field
// === baseField, value is JSON) and/or one-or-more per-path edits (typed
// inline at any depth, field === "baseField.<path>") - the container edit
// (or, absent that, the current on-disk value) supplies the starting
// array/object, and per-path edits then splice on top via spliceValueEdit
// (edit-sync.ts), so an inline tweak made after the dialog was used always
// wins for that path.
function mergeFieldEdits(
  baseSchema: ComponentSchema | undefined,
  baseField: string,
  fieldEdits: Map<string, string>,
  currentValue: unknown,
): unknown {
  if (
    !baseSchema ||
    (baseSchema.kind !== "array" && baseSchema.kind !== "object")
  ) {
    // fields.text / fields.image / fields.file never have a nested path -
    // one entry, keyed by the base field itself.
    return fieldEdits.get(baseField);
  }
  const containerEdit = fieldEdits.get(baseField);
  let base: unknown =
    containerEdit !== undefined
      ? JSON.parse(containerEdit)
      : (currentValue ?? (baseSchema.kind === "array" ? [] : {}));
  for (const [field, value] of fieldEdits) {
    if (field === baseField) continue;
    const path = field.slice(baseField.length + 1).split(".");
    // A path edit's terminal schema is usually a flat leaf (text/image/file)
    // - save.ts writes those straight to YAML as the raw bus string, so an
    // asset leaf's '' sentinel is stripped (not decoded to null) by
    // stripEmptyAssetLeaves below rather than at splice time. But at any
    // nesting depth (array>object>array, …) a path can also terminate on a
    // NESTED array/object - e.g. "sections.0.items" is itself a whole-
    // container replace for the array nested inside a sections item - whose
    // bus value is JSON-encoded the same way the outer container edit above
    // is (see bind.ts's parseArrayValue/parseObjectValue,
    // SingletonPage.tsx's fromBusValue). Passing that JSON *string* through
    // unparsed would leave a string sitting where the schema expects a real
    // array/object, which crashes clientSideValidateProp below instead of
    // failing loudly - see plan/de-quy-object.md.
    base = spliceValueEdit(base, path, baseSchema, (leafSchema) => {
      const leafKind = getSyncableFieldKind(leafSchema);
      if (leafKind !== "array" && leafKind !== "object") return value;
      try {
        const parsed = JSON.parse(value);
        if (leafKind === "array") return Array.isArray(parsed) ? parsed : [];
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? parsed
          : {};
      } catch {
        return leafKind === "array" ? [] : {};
      }
    });
  }
  return stripEmptyAssetLeaves(base, baseSchema);
}

function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

// The slice of a fields.content schema the save path drives - see the
// matching structural type in InlineContentEditors.tsx.
type ContentFieldSchema = {
  parse(
    value: unknown,
    extra: {
      content: Uint8Array | undefined;
      other: ReadonlyMap<string, Uint8Array>;
      external: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
      slug: string | undefined;
    },
  ): unknown;
  serialize(
    value: unknown,
    extra?: { slug?: undefined; entryDirectory?: string },
  ): {
    value: unknown;
    content?: Uint8Array;
    other: Map<string, Uint8Array>;
  };
  // Unset for `fields.content({ inline: true })` - its body lives in `value`
  // (the entry's own YAML) instead of a sibling file, see below.
  contentExtension?: string;
};

// A fields.content edit spans more than one file, unlike every other kind.
// Its HTML body lives in its own `<singletonDir>/<dottedField>.html` (the
// field's `contentExtension`), the entry's YAML gets only the lightweight
// { wordCount, charCount } summary, and any image embedded in the body is a
// third file under its own `<singletonDir>/<dottedField>/assets/` (top-level:
// `<singletonDir>/assets/`, unchanged - see contentEntryDir/contentAssetsDir).
// All of them are returned here and committed together - both the local
// /update API and GitHub's createCommitOnBranch already take a multi-file
// write.
//
// The bus carries the body as raw HTML, but the summary and the embedded
// image bytes only exist on the far side of a parse → serialize round trip
// through the field's own schema, so that's what this does rather than
// hand-rolling a word count. `other` must be hydrated first - see
// listAssetFiles for what silently breaks otherwise.
//
// `dottedField` may be nested (e.g. "brand.name") - `containerSchema` is the
// TOP-level field's own schema (e.g. `brand`'s ObjectField), needed to splice
// the leaf's value into `data[topBaseField]` at the right path via
// spliceValueEdit rather than overwriting the whole top-level key. Undefined
// (and unused) when `dottedField` has no dots - the leaf IS the top-level
// field then, and `data[dottedField]` is written directly.
async function collectContentFieldDiffs(
  config: Config<any, any>,
  singletonName: string,
  dottedField: string,
  html: string,
  fieldSchema: ContentFieldSchema,
  data: Record<string, unknown>,
  containerSchema: ComponentSchema | undefined,
  githubBranchName?: string,
): Promise<FileDiff[]> {
  const dir = getSingletonPath(config, singletonName);
  const entryDir = contentEntryDir(dir, dottedField);
  const assetsDir = contentAssetsDir(dir, dottedField);
  // Both the saved-on-disk bytes AND any freshly-embedded image that only
  // exists in the pending-blob store (IndexedDB) yet - mirrors the inline
  // editor's own mount hydration (InlineContentEditors.tsx). Without the
  // pending half, an image inserted this session parses back with 0 bytes,
  // and serialize() then silently repoints it to /media-library/ and drops
  // its bytes instead of writing them beside the entry (see listAssetFiles).
  const [saved, pending] = await Promise.all([
    listAssetFiles(config, singletonName, githubBranchName, dottedField),
    getPendingBlobsUnder(assetsDir).catch(() => new Map<string, Uint8Array>()),
  ]);
  // Pending wins: it's the newer copy of any name present in both.
  const assets = new Map([...saved, ...pending]);
  const state = fieldSchema.parse(undefined, {
    content: textEncoder.encode(html),
    other: assets,
    external: new Map(),
    slug: undefined,
  });
  // entryDirectory so embedded-image srcs are written as live-resolvable
  // public paths (`/<entryDir>/assets/<name>`) rather than bare filenames.
  const out = fieldSchema.serialize(state, { entryDirectory: entryDir });

  const [topBaseField, ...pathWithinTop] = dottedField.split(".");
  if (pathWithinTop.length === 0) {
    data[topBaseField] = out.value;
  } else if (containerSchema) {
    // INV-2: writes the leaf at its nested path without disturbing the rest
    // of the container - `data[topBaseField]` already carries whatever the
    // sibling non-content sub-edits (or a whole-container replace) just
    // merged into it (see collectFileDiffs), and this splice preserves that.
    data[topBaseField] = spliceValueEdit(
      data[topBaseField],
      pathWithinTop,
      containerSchema,
      () => out.value,
    );
  }

  const diffs: FileDiff[] = [];
  // An inline content field (no contentExtension) has no sibling file at
  // all - its body just went into data[topBaseField] above, so there's
  // nothing more to diff here.
  if (fieldSchema.contentExtension) {
    const contentPath = `${dir}/${dottedField}${fieldSchema.contentExtension}`;
    const rawBefore = await readCurrentFile(
      config,
      contentPath,
      githubBranchName,
    );
    diffs.push({
      path: contentPath,
      before: rawBefore ? textDecoder.decode(rawBefore) : "",
      after: textDecoder.decode(out.content ?? new Uint8Array()),
    });
  }

  // Only images whose bytes actually changed (or are new). Every existing
  // image round-trips back out of serialize() byte-identical now that its
  // bytes were hydrated on the way in, so without this filter each save would
  // rewrite every asset the body references.
  //
  // Removing an image from the body leaves its file orphaned rather than
  // deleting it: harmless, and pruning it safely would mean proving no other
  // field references it (what the admin's own required-files pass does).
  for (const [key, bytes] of out.other) {
    const existing = assets.get(key);
    if (existing && bytesEqual(existing, bytes)) continue;
    diffs.push({
      path: `${assetsDir}/${key}`,
      before: existing ? `(image, ${existing.length} bytes)` : "",
      after: `(image, ${bytes.length} bytes)`,
      contents: bytes,
    });
  }
  return diffs;
}

// Reads each singleton file the pending edits touch and returns its current
// (before) text alongside the text it would become once edits are applied.
// Powers both saving (encode `after`) and the review diff dialog.
async function collectFileDiffs(
  config: Config<any, any>,
  githubBranchName?: string,
): Promise<FileDiff[]> {
  const edits = await getAllEdits();
  // name -> baseField -> (field -> raw bus value) - field may be nested
  // (e.g. "array.3") but always shares a singleton with its base field.
  const bySingleton = new Map<string, Map<string, Map<string, string>>>();
  for (const edit of edits) {
    const [type, name, field] = edit.key.split("::");
    if (type !== "singleton" || !name || !field) continue;
    if (!config.singletons?.[name]) continue;
    const baseField = field.split(".")[0];
    if (!bySingleton.has(name)) bySingleton.set(name, new Map());
    const byBaseField = bySingleton.get(name)!;
    if (!byBaseField.has(baseField)) byBaseField.set(baseField, new Map());
    byBaseField.get(baseField)!.set(field, edit.value);
  }

  const messages: string[] = [];
  const diffs: FileDiff[] = [];
  for (const [name, byBaseField] of bySingleton) {
    const format = getSingletonFormat(config, name);
    if (format.contentField) {
      throw new Error(
        `dry(): singleton "${name}" has a contentField - not supported in MVP 1.`,
      );
    }
    const filepath = getEntryDataFilepath(
      getSingletonPath(config, name),
      format,
    );
    const raw = await readCurrentFile(config, filepath, githubBranchName);
    const before = raw ? textDecoder.decode(raw) : "";
    const data = (
      raw ? (loadDataFile(raw, format).loaded ?? {}) : {}
    ) as Record<string, unknown>;
    const schema = config.singletons![name].schema as Record<
      string,
      ComponentSchema
    >;
    // Collected separately from the entry's own data file: a content edit
    // also writes its .html body (and any embedded image) alongside it.
    const extraDiffs: FileDiff[] = [];
    for (const [baseField, fieldEdits] of byBaseField) {
      const kind = getSyncableFieldKind(schema[baseField] as any);
      if (kind === "content") {
        // Only a whole-field edit is possible - the inline editor owns the
        // element as one unit and publishes the body under the base field's
        // own key, never a nested path.
        const html = fieldEdits.get(baseField);
        if (html === undefined) continue;
        extraDiffs.push(
          ...(await collectContentFieldDiffs(
            config,
            name,
            baseField,
            html,
            schema[baseField] as unknown as ContentFieldSchema,
            data,
            undefined,
            githubBranchName,
          )),
        );
        continue;
      }
      // A container base field can carry a nested content leaf's edit too
      // (e.g. "brand.name") - split those out before the generic splice
      // below, which only knows how to write a raw bus string/JSON at a
      // path, not round-trip a content body through its own schema (see
      // collectContentFieldDiffs). Applied *after* the container merge so
      // each leaf's parse/serialize sees (and writes on top of) whatever the
      // merge just settled on for the rest of the container.
      const contentSubEdits = new Map<string, string>();
      const nonContentEdits = new Map<string, string>();
      for (const [field, value] of fieldEdits) {
        const leafSchema =
          field === baseField
            ? undefined
            : resolveSchemaAtFieldPath(schema, field);
        if (leafSchema && getSyncableFieldKind(leafSchema) === "content") {
          contentSubEdits.set(field, value);
        } else {
          nonContentEdits.set(field, value);
        }
      }
      const merged = mergeFieldEdits(
        schema[baseField],
        baseField,
        nonContentEdits,
        data[baseField],
      );
      // fields.image/fields.file's serialize() omits the key entirely when
      // the value is null (see form/fields/image|file/index.tsx) - mirror
      // that here so a cleared image/file doesn't get written back as
      // `field: ''`.
      const isAsset = isAssetKind(kind);
      if (isAsset && merged === "") {
        delete data[baseField];
      } else {
        data[baseField] = merged;
      }
      const validatedValue = isAsset && merged === "" ? null : merged;
      validateField(name, baseField, schema, validatedValue, messages);

      for (const [dottedField, html] of contentSubEdits) {
        const leafSchema = resolveSchemaAtFieldPath(schema, dottedField);
        if (!leafSchema) continue;
        extraDiffs.push(
          ...(await collectContentFieldDiffs(
            config,
            name,
            dottedField,
            html,
            leafSchema as unknown as ContentFieldSchema,
            data,
            schema[baseField],
            githubBranchName,
          )),
        );
      }
    }
    diffs.push({ path: filepath, before, after: dump(data) });
    diffs.push(...extraDiffs);
  }
  if (messages.length > 0) {
    throw new Error(messages.join("; "));
  }
  return diffs;
}

async function buildFileChanges(
  config: Config<any, any>,
  githubBranchName?: string,
): Promise<FileToWrite[]> {
  const diffs = await collectFileDiffs(config, githubBranchName);
  return diffs.map((d) => ({
    path: d.path,
    contents: d.contents ?? textEncoder.encode(d.after),
  }));
}

// The branch segment the admin app's routes expect (e.g. "branch/main/") -
// GitHub mode is branch-scoped, local mode has no branch in its URLs.
export async function getCurrentBranchName(
  config: Config<any, any>,
): Promise<string | undefined> {
  if (config.storage.kind !== "github") return undefined;
  const token = await getGithubTokenWithRefresh(config);
  if (!token) throw new Error("Not signed in to GitHub");
  const { owner, name } = parseRepo((config.storage as any).repo);
  const branch = await getDefaultBranch(token, owner, name);
  return branch.branchName;
}

// The singleton's current on-disk field values, read straight from the
// source (local API, or GitHub Contents API at the default branch) rather
// than trusting whatever HTML the page happened to render with - that HTML
// can be stale in github mode if this visitor's Cloudflare CDN edge hasn't
// caught up with the latest deploy yet. String-valued (fields.text) entries
// pass through as-is; fields.array entries are JSON-encoded to fit this
// function's Record<string, string> shape, matching the encoding used
// everywhere else on the edit-sync bus (see bind.ts's parseArrayValue and the
// array dialog's publishEdit in Toolbar.tsx) - MVP scope, see dry.ts.
export async function getLatestFieldValues(
  config: Config<any, any>,
  singletonName: string,
): Promise<Record<string, string>> {
  let branch: string | undefined;
  if (config.storage.kind === "github") {
    const token = await getGithubTokenWithRefresh(config);
    if (!token) throw new Error("Not signed in to GitHub");
    const { owner, name } = parseRepo((config.storage as any).repo);
    branch = (await getDefaultBranch(token, owner, name)).branchName;
  }
  const format = getSingletonFormat(config, singletonName);
  const filepath = getEntryDataFilepath(
    getSingletonPath(config, singletonName),
    format,
  );
  const raw = await readCurrentFile(config, filepath, branch);
  if (!raw) return {};
  const data = (loadDataFile(raw, format).loaded ?? {}) as Record<
    string,
    unknown
  >;
  const schema = config.singletons![singletonName].schema as Record<
    string,
    unknown
  >;
  const result: Record<string, string> = {};
  for (const [field, value] of Object.entries(data)) {
    if (typeof value === "string") {
      result[field] = value;
      continue;
    }
    const kind = getSyncableFieldKind(schema[field] as any);
    if (Array.isArray(value) && kind === "array") {
      result[field] = JSON.stringify(value);
    } else if (
      kind === "object" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      result[field] = JSON.stringify(value);
    }
  }

  // A content field's real value isn't in the data file at all - that only
  // holds its { wordCount, charCount } summary - so it needs its own read of
  // the sibling .html body. Driven off the schema rather than `data`'s keys:
  // a body can exist before the summary does.
  const dir = getSingletonPath(config, singletonName);
  await Promise.all(
    Object.entries(schema).map(async ([field, fieldSchema]) => {
      if (getSyncableFieldKind(fieldSchema as any) !== "content") return;
      const raw = await readCurrentFile(config, `${dir}/${field}.html`, branch);
      if (raw) result[field] = textDecoder.decode(raw);
    }),
  );
  return result;
}

// Before/after text for every file the pending edits would change - resolves
// the GitHub default branch first when needed, mirroring the save path.
export async function getPendingDiffs(
  config: Config<any, any>,
): Promise<FileDiff[]> {
  if (config.storage.kind === "github") {
    const token = await getGithubTokenWithRefresh(config);
    if (!token) throw new Error("Not signed in to GitHub");
    const { owner, name } = parseRepo((config.storage as any).repo);
    const branch = await getDefaultBranch(token, owner, name);
    return collectFileDiffs(config, branch.branchName);
  }
  return collectFileDiffs(config);
}

// Returns the new commit's oid, or undefined when there was nothing to
// commit. In local mode the write lands on the served file immediately, so
// the caller can re-fetch via getLatestFieldValues right after. In github
// mode this only commits to the caller's brand branch - the default branch
// (what getLatestFieldValues/getCurrentBranchName read) doesn't see the
// change until that brand is merged in (see deploy.ts's runDeploy, invoked
// by the caller right after a successful save).
export async function saveEdits(
  config: Config<any, any>,
): Promise<string | undefined> {
  const isGithub = config.storage.kind === "github";
  let commitOid: string | undefined;
  if (isGithub) {
    const token = await getGithubTokenWithRefresh(config);
    if (!token) throw new Error("Not signed in to GitHub");
    const { owner, name } = parseRepo((config.storage as any).repo);
    const brand = await ensureBrand(config, token, owner, name);
    const brandQualifiedName = `refs/heads/${brand.ref}`;
    let branch = await getBranchRef(token, owner, name, brandQualifiedName);
    if (!branch)
      throw new Error(`Could not find brand branch "${brand.ref}" on GitHub.`);
    let files = await buildFileChanges(config, branch.branchName);
    if (files.length === 0) return undefined;

    const commit = () =>
      githubGraphQL(token, createCommitMutation, {
        input: {
          branch: {
            branchName: branch!.branchName,
            repositoryNameWithOwner: `${owner}/${name}`,
          },
          expectedHeadOid: branch!.oid,
          message: { headline: "Update content via visual editor" },
          fileChanges: {
            additions: files.map((f) => ({
              path: f.path,
              contents: base64Encode(f.contents),
            })),
            deletions: [],
          },
        },
      });

    let data: Awaited<ReturnType<typeof commit>>;
    try {
      data = await commit();
    } catch (err) {
      if (!(err instanceof GithubGraphQLError)) throw err;
      if (err.type === "BRANCH_PROTECTION_RULE_VIOLATION") {
        throw new Error(
          `"${branch.branchName}" is a protected branch - changes must go through a pull request.`,
        );
      }
      if (err.type !== "STALE_DATA") throw err;
      // Someone else committed to the brand branch since we read it (e.g.
      // another tab). Refetch the branch tip and re-read the files against
      // it, then retry exactly once - a second failure means we're racing
      // too fast to safely auto-resolve, so surface it instead of retrying
      // forever.
      branch = await getBranchRef(token, owner, name, brandQualifiedName);
      if (!branch)
        throw new Error(
          `Could not find brand branch "${brand.ref}" on GitHub.`,
        );
      files = await buildFileChanges(config, branch.branchName);
      if (files.length === 0) return undefined;
      try {
        data = await commit();
      } catch {
        throw new Error(
          "This content changed on GitHub while you were editing. Reload the page and try saving again.",
        );
      }
    }
    commitOid = data?.createCommitOnBranch?.ref?.target?.oid;
  } else if (config.storage.kind === "local") {
    const files = await buildFileChanges(config);
    if (files.length === 0) return;
    const res = await fetch(`/api/${apiPath}/update`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "no-cors": "1" },
      body: JSON.stringify({
        additions: files.map((f) => ({
          path: f.path,
          contents: base64Encode(f.contents),
        })),
        deletions: [],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    // Local writes are immediately real/servable - unlike github mode (which
    // needs a deploy to catch up, see discardEditsIfBuildIsNewer), there's no
    // lag to bridge, so the bytes cached for previewing pending images can be
    // dropped now instead of leaking in IndexedDB forever (the only other
    // place that clears them is Reset, which is disabled once nothing's
    // pending - i.e. never reachable right after a successful save).
    await clearPendingBlobs();
  } else {
    throw new Error(
      `dry(): MVP 1 does not support storage.kind "${(config.storage as any).kind}"`,
    );
  }
  await publishClear();
  return commitOid;
}
