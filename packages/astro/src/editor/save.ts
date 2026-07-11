import type { Config } from '@drystack/core';
import {
  getSingletonPath,
  getSingletonFormat,
  getEntryDataFilepath,
} from '@drystack/core/path-utils';
import { loadDataFile } from '@drystack/core/required-files';
import { dump } from '@drystack/core/yaml';
// @ts-expect-error — provided by the drystack Astro integration's Vite plugin
import apiPath from 'virtual:keystatic-path';
import { getAllEdits, clearEdits } from './store';

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
    throw new Error(json.errors.map((e: { message: string }) => e.message).join('; '));
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
  if (!ref) throw new Error(`Không tìm thấy nhánh mặc định của ${owner}/${name}`);
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
    if (!treeRes.ok) throw new Error('Không đọc được cây thư mục hiện tại');
    const entries: { path: string; sha: string }[] = await treeRes.json();
    const entry = entries.find(e => e.path === filepath);
    if (!entry) return null;
    const blobRes = await fetch(`/api/${apiPath}/blob/${entry.sha}/${filepath}`, {
      headers: { 'no-cors': '1' },
    });
    if (!blobRes.ok) throw new Error('Không đọc được nội dung file hiện tại');
    return new Uint8Array(await blobRes.arrayBuffer());
  }
  if (config.storage.kind === 'github') {
    const token = getGithubToken();
    if (!token) throw new Error('Chưa đăng nhập GitHub');
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
    if (!res.ok) throw new Error('Không đọc được nội dung file hiện tại từ GitHub');
    const json = await res.json();
    return decodeBase64ToBytes(json.content);
  }
  throw new Error(
    `dry(): MVP 1 chưa hỗ trợ storage.kind "${(config.storage as any).kind}"`
  );
}

async function buildFileChanges(
  config: Config<any, any>,
  githubBranchName?: string
): Promise<FileToWrite[]> {
  const edits = await getAllEdits();
  const bySingleton = new Map<string, Map<string, string>>();
  for (const edit of edits) {
    const [type, name, field] = edit.key.split('::');
    if (type !== 'singleton' || !name || !field) continue;
    if (!config.singletons?.[name]) continue;
    if (!bySingleton.has(name)) bySingleton.set(name, new Map());
    bySingleton.get(name)!.set(field, edit.value);
  }

  const files: FileToWrite[] = [];
  for (const [name, fields] of bySingleton) {
    const format = getSingletonFormat(config, name);
    if (format.contentField) {
      throw new Error(
        `dry(): singleton "${name}" có contentField — chưa hỗ trợ trong MVP 1.`
      );
    }
    const filepath = getEntryDataFilepath(getSingletonPath(config, name), format);
    const raw = await readCurrentFile(config, filepath, githubBranchName);
    const data = (
      raw ? (loadDataFile(raw, format).loaded ?? {}) : {}
    ) as Record<string, unknown>;
    for (const [field, value] of fields) {
      data[field] = value;
    }
    files.push({ path: filepath, contents: textEncoder.encode(dump(data)) });
  }
  return files;
}

export async function saveEdits(config: Config<any, any>): Promise<void> {
  const isGithub = config.storage.kind === 'github';
  if (isGithub) {
    const token = getGithubToken();
    if (!token) throw new Error('Chưa đăng nhập GitHub');
    const { owner, name } = parseRepo((config.storage as any).repo);
    const branch = await getDefaultBranch(token, owner, name);
    const files = await buildFileChanges(config, branch.branchName);
    if (files.length === 0) return;
    await githubGraphQL(token, createCommitMutation, {
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
      `dry(): MVP 1 chưa hỗ trợ storage.kind "${(config.storage as any).kind}"`
    );
  }
  // GitHub mode: keep the edits in IndexedDB. The commit still needs to land
  // in a Cloudflare Pages build before it's visible, so clearing here would
  // let a reload show a stale DOM in the gap between commit and deploy.
  // discardEditsIfBuildIsNewer (bind.ts) clears them once that build ships.
  if (!isGithub) {
    await clearEdits();
  }
}
