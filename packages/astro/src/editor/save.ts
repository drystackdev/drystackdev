import type { Config } from '@drystack/core';
import {
  getSingletonPath,
  getSingletonFormat,
  getEntryDataFilepath,
} from '@drystack/core/path-utils';
import { loadDataFile } from '@drystack/core/required-files';
import { dump } from '@drystack/core/yaml';
// @ts-expect-error — provided by the drystack Astro integration's Vite plugin
import apiPath from 'virtual:drystack-path';
import { getAllEdits, publishClear } from './store';

const textEncoder = new TextEncoder();

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\n/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function getGithubToken(): string | null {
  const match = document.cookie.match(
    /(?:^|;\s*)drystack-gh-access-token=([^;]+)/
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function parseRepo(repo: string | { owner: string; name: string }) {
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
class GithubGraphQLError extends Error {
  type?: string;
  constructor(message: string, type?: string) {
    super(message);
    this.type = type;
  }
}

async function githubGraphQL(
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
// allowed to reach disk/GitHub — the visual editor writes raw DOM text
// straight into YAML, so without this a required/min-length/pattern field
// could be saved empty or malformed. Mirrors the admin form's
// clientSideValidateProp gate (packages/drystack/src/form/errors.ts), scoped
// down to flat fields.text values since that's all MVP 1 edits.
function validateEdits(
  config: Config<any, any>,
  bySingleton: Map<string, Map<string, string>>
): void {
  const messages: string[] = [];
  for (const [name, fields] of bySingleton) {
    const schema = config.singletons![name].schema as Record<
      string,
      { validate?: (value: string, args?: unknown) => unknown }
    >;
    for (const [field, value] of fields) {
      try {
        schema[field]?.validate?.(value, undefined);
      } catch (err) {
        messages.push(err instanceof Error ? err.message : `${name}.${field} is invalid`);
      }
    }
  }
  if (messages.length > 0) {
    throw new Error(messages.join('; '));
  }
}

// Reads each singleton file the pending edits touch and returns its current
// (before) text alongside the text it would become once edits are applied.
// Powers both saving (encode `after`) and the review diff dialog.
async function collectFileDiffs(
  config: Config<any, any>,
  githubBranchName?: string
): Promise<FileDiff[]> {
  const edits = await getAllEdits();
  const bySingleton = new Map<string, Map<string, string>>();
  for (const edit of edits) {
    const [type, name, field] = edit.key.split('::');
    if (type !== 'singleton' || !name || !field) continue;
    if (!config.singletons?.[name]) continue;
    if (!bySingleton.has(name)) bySingleton.set(name, new Map());
    bySingleton.get(name)!.set(field, edit.value);
  }

  validateEdits(config, bySingleton);

  const diffs: FileDiff[] = [];
  for (const [name, fields] of bySingleton) {
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
    for (const [field, value] of fields) {
      data[field] = value;
    }
    diffs.push({ path: filepath, before, after: dump(data) });
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
// caught up with the latest deploy yet. Only string-valued (fields.text)
// entries are returned, matching MVP 1's scope (see dry.ts).
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
  const result: Record<string, string> = {};
  for (const [field, value] of Object.entries(data)) {
    if (typeof value === 'string') result[field] = value;
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
  } else {
    throw new Error(
      `dry(): MVP 1 does not support storage.kind "${(config.storage as any).kind}"`
    );
  }
  await publishClear();
  return commitOid;
}
