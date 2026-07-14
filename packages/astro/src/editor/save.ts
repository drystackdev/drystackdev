import type { Config, ComponentSchema } from '@drystack/core';
import {
  getSingletonPath,
  getSingletonFormat,
  getEntryDataFilepath,
} from '@drystack/core/path-utils';
import { loadDataFile } from '@drystack/core/required-files';
import { dump } from '@drystack/core/yaml';
import {
  getSyncableFieldKind,
  type SyncableFieldKind,
} from '@drystack/core/edit-sync';
import { clientSideValidateProp } from '@drystack/core/field-editor';
// @ts-expect-error — provided by the drystack Astro integration's Vite plugin
import apiPath from 'virtual:drystack-path';
import { getAllEdits, publishClear, clearPendingBlobs } from './store';

const textEncoder = new TextEncoder();

export function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function getGithubToken(): string | null {
  const match = document.cookie.match(
    /(?:^|;\s*)drystack-gh-access-token=([^;]+)/
  );
  return match ? decodeURIComponent(match[1]) : null;
}

export function parseRepo(repo: string | { owner: string; name: string }) {
  if (typeof repo === 'string') {
    const [owner, name] = repo.split('/');
    return { owner, name };
  }
  return repo;
}

type FileToWrite = { path: string; contents: Uint8Array };
export type FileDiff = { path: string; before: string; after: string };

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
  variables: Record<string, unknown>
) {
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors?.length) {
    throw new GithubGraphQLError(
      json.errors.map((e: { message: string }) => e.message).join('; '),
      json.errors[0]?.type
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
  if (!ref) throw new Error(`Could not find the default branch of ${owner}/${name}`);
  return { branchName: ref.name as string, oid: ref.target.oid as string };
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
  githubBranchName?: string
): Promise<Uint8Array | null> {
  if (config.storage.kind === 'local') {
    const treeRes = await fetch(`/api/${apiPath}/tree`, {
      headers: { 'no-cors': '1' },
    });
    if (!treeRes.ok) throw new Error('Could not read the current file tree');
    const entries: { path: string; sha: string }[] = await treeRes.json();
    const entry = entries.find(e => e.path === filepath);
    if (!entry) return null;
    const blobRes = await fetch(`/api/${apiPath}/blob/${entry.sha}/${filepath}`, {
      headers: { 'no-cors': '1' },
    });
    if (!blobRes.ok) throw new Error('Could not read the current file contents');
    return new Uint8Array(await blobRes.arrayBuffer());
  }
  if (config.storage.kind === 'github') {
    const token = getGithubToken();
    if (!token) throw new Error('Not signed in to GitHub');
    const { owner, name } = parseRepo((config.storage as any).repo);
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${name}/contents/${filepath}?ref=${githubBranchName}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      }
    );
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Could not read the current file contents from GitHub');
    const json = await res.json();
    return decodeBase64ToBytes(json.content);
  }
  throw new Error(
    `dry(): MVP 1 does not support storage.kind "${(config.storage as any).kind}"`
  );
}

// Every pending edit must satisfy its own field's schema.validate before it's
// allowed to reach disk/GitHub — the visual editor writes raw DOM text/paths
// straight into YAML, so without this a required/min-length/pattern field
// could be saved empty or malformed. Mirrors the admin form's
// clientSideValidateProp gate (packages/drystack/src/form/errors.ts).
// Validates the *merged* value per base field (see mergeFieldEdits below), not
// each raw bus entry independently — a fields.array's min/max length check
// needs the whole array, not just whichever index/container edit happened to
// be pending.
//
// fields.array's schema (unlike fields.text/fields.image) has no `.validate`
// method of its own — length/element validation lives in
// form/errors.ts's validateValueWithSchema, reachable here only through the
// public clientSideValidateProp wrapper (re-exported at
// @drystack/core/field-editor for the visual editor's array dialog). It
// returns a bool and only console.warns the specific failure, so the
// message pushed here is a generic fallback rather than the precise reason.
function validateField(
  name: string,
  baseField: string,
  schema: Record<string, ComponentSchema>,
  kind: SyncableFieldKind | undefined,
  value: unknown,
  messages: string[]
): void {
  if (kind === 'array') {
    if (!clientSideValidateProp(schema[baseField], value, undefined)) {
      messages.push(`${name}.${baseField} is invalid`);
    }
    return;
  }
  try {
    (
      schema[baseField] as { validate?: (value: unknown, args?: unknown) => unknown }
    )?.validate?.(value, undefined);
  } catch (err) {
    messages.push(err instanceof Error ? err.message : `${name}.${baseField} is invalid`);
  }
}

// Merges every pending edit for one base field into the value that should be
// written to `data[baseField]`. A fields.text/fields.image edit is always a
// single flat entry (field === baseField). A fields.array edit can be a
// whole-array replace (the dialog's container-level edit, field ===
// baseField, value is JSON) and/or one-or-more per-item edits (typed inline,
// field === "baseField.N") — the container edit (or, absent that, the
// current on-disk array) supplies the starting array, and per-item edits
// then override individual indices on top, so an inline tweak made after the
// dialog was used always wins for that index.
function mergeFieldEdits(
  kind: SyncableFieldKind | undefined,
  baseField: string,
  fieldEdits: Map<string, string>,
  currentValue: unknown,
  fieldSchema: ComponentSchema | undefined
): unknown {
  if (kind === 'array') {
    const containerEdit = fieldEdits.get(baseField);
    const base =
      containerEdit !== undefined
        ? (JSON.parse(containerEdit) as unknown[])
        : Array.isArray(currentValue)
          ? [...currentValue]
          : [];
    const elementSchema = (fieldSchema as { element?: ComponentSchema } | undefined)
      ?.element;
    for (const [field, value] of fieldEdits) {
      if (field === baseField) continue;
      const rest = field.slice(baseField.length + 1); // "N" or "N.sub"
      const dot = rest.indexOf('.');
      if (dot === -1) {
        // Array-of-primitive item edit — the whole item value.
        const idx = Number(rest);
        if (Number.isInteger(idx) && idx >= 0) base[idx] = value;
        continue;
      }
      // Array-of-object sub-field edit ("N.sub") — override just that field of
      // the object at index N, layered on top of the container edit (or the
      // current on-disk object).
      const idx = Number(rest.slice(0, dot));
      const sub = rest.slice(dot + 1);
      if (!Number.isInteger(idx) || idx < 0 || sub.includes('.')) continue;
      const prev = base[idx];
      base[idx] = {
        ...(typeof prev === 'object' && prev !== null
          ? (prev as Record<string, unknown>)
          : {}),
        [sub]: value,
      };
    }
    // Mirror fields.image's serialize (omit the key when there's no image, see
    // form/fields/image/index.tsx) for image sub-fields of an array-of-object:
    // the reader's image.parse throws on a literal `null`, so an empty image
    // must be absent from the YAML, not written as null/''.
    if (elementSchema?.kind === 'object') {
      const subFields = (elementSchema as {
        fields: Record<string, ComponentSchema>;
      }).fields;
      const imageSubs = Object.entries(subFields)
        .filter(([, s]) => getSyncableFieldKind(s) === 'image')
        .map(([k]) => k);
      return base.map(item => {
        if (typeof item !== 'object' || item === null) return item;
        const obj = { ...(item as Record<string, unknown>) };
        for (const sub of imageSubs) {
          if (obj[sub] === null || obj[sub] === '' || obj[sub] === undefined) {
            delete obj[sub];
          }
        }
        return obj;
      });
    }
    return base;
  }
  // fields.text / fields.image never have a nested path — one entry, keyed
  // by the base field itself.
  return fieldEdits.get(baseField);
}

// Reads each singleton file the pending edits touch and returns its current
// (before) text alongside the text it would become once edits are applied.
// Powers both saving (encode `after`) and the review diff dialog.
async function collectFileDiffs(
  config: Config<any, any>,
  githubBranchName?: string
): Promise<FileDiff[]> {
  const edits = await getAllEdits();
  // name -> baseField -> (field -> raw bus value) — field may be nested
  // (e.g. "array.3") but always shares a singleton with its base field.
  const bySingleton = new Map<string, Map<string, Map<string, string>>>();
  for (const edit of edits) {
    const [type, name, field] = edit.key.split('::');
    if (type !== 'singleton' || !name || !field) continue;
    if (!config.singletons?.[name]) continue;
    const baseField = field.split('.')[0];
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
        `dry(): singleton "${name}" has a contentField — not supported in MVP 1.`
      );
    }
    const filepath = getEntryDataFilepath(getSingletonPath(config, name), format);
    const raw = await readCurrentFile(config, filepath, githubBranchName);
    const before = raw ? textDecoder.decode(raw) : '';
    const data = (
      raw ? (loadDataFile(raw, format).loaded ?? {}) : {}
    ) as Record<string, unknown>;
    const schema = config.singletons![name].schema as Record<
      string,
      ComponentSchema
    >;
    for (const [baseField, fieldEdits] of byBaseField) {
      const kind = getSyncableFieldKind(schema[baseField] as any);
      const merged = mergeFieldEdits(
        kind,
        baseField,
        fieldEdits,
        data[baseField],
        schema[baseField]
      );
      // fields.image's serialize() omits the key entirely when the value is
      // null (see form/fields/image/index.tsx) — mirror that here so a
      // cleared image doesn't get written back as `image: ''`.
      if (kind === 'image' && merged === '') {
        delete data[baseField];
      } else {
        data[baseField] = merged;
      }
      const validatedValue = kind === 'image' && merged === '' ? null : merged;
      validateField(name, baseField, schema, kind, validatedValue, messages);
    }
    diffs.push({ path: filepath, before, after: dump(data) });
  }
  if (messages.length > 0) {
    throw new Error(messages.join('; '));
  }
  return diffs;
}

async function buildFileChanges(
  config: Config<any, any>,
  githubBranchName?: string
): Promise<FileToWrite[]> {
  const diffs = await collectFileDiffs(config, githubBranchName);
  return diffs.map(d => ({
    path: d.path,
    contents: textEncoder.encode(d.after),
  }));
}

// The branch segment the admin app's routes expect (e.g. "branch/main/") —
// GitHub mode is branch-scoped, local mode has no branch in its URLs.
export async function getCurrentBranchName(
  config: Config<any, any>
): Promise<string | undefined> {
  if (config.storage.kind !== 'github') return undefined;
  const token = getGithubToken();
  if (!token) throw new Error('Not signed in to GitHub');
  const { owner, name } = parseRepo((config.storage as any).repo);
  const branch = await getDefaultBranch(token, owner, name);
  return branch.branchName;
}

// The singleton's current on-disk field values, read straight from the
// source (local API, or GitHub Contents API at the default branch) rather
// than trusting whatever HTML the page happened to render with — that HTML
// can be stale in github mode if this visitor's Cloudflare CDN edge hasn't
// caught up with the latest deploy yet. String-valued (fields.text) entries
// pass through as-is; fields.array entries are JSON-encoded to fit this
// function's Record<string, string> shape, matching the encoding used
// everywhere else on the edit-sync bus (see bind.ts's parseArrayValue and the
// array dialog's publishEdit in Toolbar.tsx) — MVP scope, see dry.ts.
export async function getLatestFieldValues(
  config: Config<any, any>,
  singletonName: string
): Promise<Record<string, string>> {
  let branch: string | undefined;
  if (config.storage.kind === 'github') {
    const token = getGithubToken();
    if (!token) throw new Error('Not signed in to GitHub');
    const { owner, name } = parseRepo((config.storage as any).repo);
    branch = (await getDefaultBranch(token, owner, name)).branchName;
  }
  const format = getSingletonFormat(config, singletonName);
  const filepath = getEntryDataFilepath(
    getSingletonPath(config, singletonName),
    format
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
    if (typeof value === 'string') {
      result[field] = value;
      continue;
    }
    if (Array.isArray(value) && getSyncableFieldKind(schema[field] as any) === 'array') {
      result[field] = JSON.stringify(value);
    }
  }
  return result;
}

// Before/after text for every file the pending edits would change — resolves
// the GitHub default branch first when needed, mirroring the save path.
export async function getPendingDiffs(
  config: Config<any, any>
): Promise<FileDiff[]> {
  if (config.storage.kind === 'github') {
    const token = getGithubToken();
    if (!token) throw new Error('Not signed in to GitHub');
    const { owner, name } = parseRepo((config.storage as any).repo);
    const branch = await getDefaultBranch(token, owner, name);
    return collectFileDiffs(config, branch.branchName);
  }
  return collectFileDiffs(config);
}

// Returns the new commit's oid in github mode, or undefined when there was
// nothing to commit or when in local mode. Either way, the source of truth
// (git blob via the GitHub Contents API, or the local file) reflects the
// write immediately — the caller re-fetches it via getLatestFieldValues right
// after, so pending edits are cleared here without waiting for a Cloudflare
// deploy to actually ship the change to the public site.
export async function saveEdits(config: Config<any, any>): Promise<string | undefined> {
  const isGithub = config.storage.kind === 'github';
  let commitOid: string | undefined;
  if (isGithub) {
    const token = getGithubToken();
    if (!token) throw new Error('Not signed in to GitHub');
    const { owner, name } = parseRepo((config.storage as any).repo);
    let branch = await getDefaultBranch(token, owner, name);
    let files = await buildFileChanges(config, branch.branchName);
    if (files.length === 0) return undefined;

    const commit = () =>
      githubGraphQL(token, createCommitMutation, {
        input: {
          branch: {
            branchName: branch.branchName,
            repositoryNameWithOwner: `${owner}/${name}`,
          },
          expectedHeadOid: branch.oid,
          message: { headline: 'Update content via visual editor' },
          fileChanges: {
            additions: files.map(f => ({
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
      if (err.type === 'BRANCH_PROTECTION_RULE_VIOLATION') {
        throw new Error(
          `"${branch.branchName}" is a protected branch — changes must go through a pull request. Open the admin panel to create a branch for this edit instead.`
        );
      }
      if (err.type !== 'STALE_DATA') throw err;
      // Someone else committed to the branch since we read it. Refetch the
      // branch tip and re-read the files against it (picking up any
      // unrelated concurrent commit, and re-applying our pending edits on
      // top) then retry exactly once — a second failure means we're racing
      // too fast to safely auto-resolve, so surface it instead of retrying
      // forever.
      branch = await getDefaultBranch(token, owner, name);
      files = await buildFileChanges(config, branch.branchName);
      if (files.length === 0) return undefined;
      try {
        data = await commit();
      } catch {
        throw new Error(
          'This content changed on GitHub while you were editing. Reload the page and try saving again.'
        );
      }
    }
    commitOid = data?.createCommitOnBranch?.ref?.target?.oid;
  } else if (config.storage.kind === 'local') {
    const files = await buildFileChanges(config);
    if (files.length === 0) return;
    const res = await fetch(`/api/${apiPath}/update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'no-cors': '1' },
      body: JSON.stringify({
        additions: files.map(f => ({
          path: f.path,
          contents: base64Encode(f.contents),
        })),
        deletions: [],
      }),
    });
    if (!res.ok) throw new Error(await res.text());
    // Local writes are immediately real/servable — unlike github mode (which
    // needs a deploy to catch up, see discardEditsIfBuildIsNewer), there's no
    // lag to bridge, so the bytes cached for previewing pending images can be
    // dropped now instead of leaking in IndexedDB forever (the only other
    // place that clears them is Reset, which is disabled once nothing's
    // pending — i.e. never reachable right after a successful save).
    await clearPendingBlobs();
  } else {
    throw new Error(
      `dry(): MVP 1 does not support storage.kind "${(config.storage as any).kind}"`
    );
  }
  await publishClear();
  return commitOid;
}
