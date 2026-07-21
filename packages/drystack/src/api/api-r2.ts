import * as s from 'superstruct';
import * as cookie from 'cookie';
import { Config } from '../config';
import { blobSha, updateTreeWithChanges } from '../app/trees';
import { base64UrlDecode } from '#base64';
import { DrystackRequest, DrystackResponse } from './internal-utils';
import { getAllowedDirectories } from './allowed-directories';
import {
  AUTH_DIRECTORY,
  AUTH_NATIVE_PREFIX,
  NativeAuthUserFile,
  clearSessionCookieHeaders,
  createUserFile,
  decryptProfile,
  getSessionFromCookieHeader,
  normalizeEmail,
  sessionCookieHeaders,
  signSession,
  userFileKey,
  verifyPassword,
} from './native-auth';

// R2-backed twin of api-node.ts: same routes, same request/response shapes,
// with the filesystem swapped for an R2 bucket and the whole thing runnable
// in workerd (WebCrypto only, no node builtins). Two deliberate differences
// from local mode, both from the auth plan (plan/auth.md):
//   - `update` requires a valid native session (the deployment is public,
//     unlike a dev machine), as do the `auth/me`-style routes below.
//   - the `auth/` prefix is invisible: never listed by `tree`, never served
//     by `blob`, never writable via `update`. Password hashes live there.

// Structural subset of Cloudflare's R2Bucket - typed locally so @drystack/core
// doesn't depend on workers-types. The real binding satisfies this as-is; the
// tests run an in-memory implementation of the same shape.
export type R2ObjectMetaLike = {
  key: string;
  size: number;
  customMetadata?: Record<string, string>;
};

export type R2BucketLike = {
  get(
    key: string
  ): Promise<(R2ObjectMetaLike & { arrayBuffer(): Promise<ArrayBuffer> }) | null>;
  put(
    key: string,
    value: Uint8Array | ArrayBuffer,
    options?: { customMetadata?: Record<string, string> }
  ): Promise<unknown>;
  delete(keys: string | string[]): Promise<void>;
  list(options?: {
    prefix?: string;
    cursor?: string;
    include?: 'customMetadata'[];
  }): Promise<{
    objects: R2ObjectMetaLike[];
    truncated: boolean;
    cursor?: string;
  }>;
};

const SHA_METADATA_KEY = 'drystack-blob-sha';

async function listAll(bucket: R2BucketLike, prefix?: string) {
  const objects: R2ObjectMetaLike[] = [];
  let cursor: string | undefined;
  do {
    const page = await bucket.list({
      prefix,
      cursor,
      include: ['customMetadata'],
    });
    objects.push(...page.objects);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
  return objects;
}

// Git blob sha for an object, from write-time metadata when present. Objects
// that arrived without it (seed script, `wrangler r2 object put`, the R2
// dashboard) get read once, hashed, and rewritten with the metadata attached
// so the next tree call is cheap again.
async function shaForObject(
  bucket: R2BucketLike,
  obj: R2ObjectMetaLike
): Promise<{ sha: string; size: number } | null> {
  const cached = obj.customMetadata?.[SHA_METADATA_KEY];
  if (cached) return { sha: cached, size: obj.size };
  const body = await bucket.get(obj.key);
  if (!body) return null;
  const contents = new Uint8Array(await body.arrayBuffer());
  const sha = await blobSha(contents);
  await bucket.put(obj.key, contents, {
    customMetadata: { [SHA_METADATA_KEY]: sha },
  });
  return { sha, size: contents.byteLength };
}

// Only content + asset directories are ever served: the same allowlist the
// blob/update routes enforce (collection/singleton paths from the config,
// plus the media library and trash), applied to the listing too. Anything
// else in the bucket - `auth/` above all, but also any unrelated objects -
// simply doesn't exist as far as the content API is concerned.
async function bucketToTreeEntries(bucket: R2BucketLike, config: Config) {
  const isPathValid = getIsPathValid(config);
  const objects = (await listAll(bucket)).filter(obj => isPathValid(obj.key));
  const additions = [];
  for (const obj of objects) {
    const hashed = await shaForObject(bucket, obj);
    if (!hashed) continue;
    additions.push({
      path: obj.key,
      contents: { byteLength: hashed.size, sha: hashed.sha },
    });
  }
  const { entries } = await updateTreeWithChanges(new Map(), {
    additions,
    deletions: [],
  });
  return entries;
}

function getIsPathValid(config: Config) {
  const allowedDirectories = getAllowedDirectories(config);
  return (filepath: string) =>
    !filepath.includes('\\') &&
    filepath.split('/').every(x => x !== '.' && x !== '..' && x !== '') &&
    !filepath.startsWith(`${AUTH_DIRECTORY}/`) &&
    allowedDirectories.some(x => filepath.startsWith(x));
}

function json(body: unknown, status = 200): DrystackResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const base64Schema = s.coerce(s.instance(Uint8Array), s.string(), val =>
  base64UrlDecode(val)
);

export function r2ModeApiHandler(
  config: Config,
  bucket: R2BucketLike | undefined,
  secret: string | undefined
) {
  return async (
    req: DrystackRequest,
    params: string[]
  ): Promise<DrystackResponse> => {
    if (!bucket) {
      return {
        status: 500,
        body: "storage: { kind: 'r2' } requires an R2 bucket binding named DRYSTACK_R2 (add an `r2_buckets` entry to wrangler.jsonc)",
      };
    }
    if (!secret) {
      return {
        status: 500,
        body: "storage: { kind: 'r2' } requires DRYSTACK_SECRET to be set - it signs login sessions and encrypts user profiles",
      };
    }
    const session = () =>
      getSessionFromCookieHeader(req.headers.get('cookie'), secret);

    const joined = params.join('/');
    if (params[0] === 'auth') {
      return authRoutes(req, params.slice(1), bucket, secret, session);
    }
    if (req.method === 'GET' && joined === 'tree') {
      if (req.headers.get('no-cors') !== '1') {
        return { status: 400, body: 'Bad Request' };
      }
      return json(await bucketToTreeEntries(bucket, config));
    }
    if (req.method === 'GET' && params[0] === 'blob') {
      return blob(req, config, params, bucket);
    }
    if (req.method === 'POST' && joined === 'update') {
      if (!(await session())) {
        return { status: 401, body: 'Not authorized' };
      }
      return update(req, config, bucket);
    }
    return { status: 404, body: 'Not Found' };
  };
}

async function blob(
  req: DrystackRequest,
  config: Config,
  params: string[],
  bucket: R2BucketLike
): Promise<DrystackResponse> {
  if (req.headers.get('no-cors') !== '1') {
    return { status: 400, body: 'Bad Request' };
  }
  const expectedSha = params[1];
  const filepath = params.slice(2).join('/');
  if (!getIsPathValid(config)(filepath)) {
    return { status: 400, body: 'Bad Request' };
  }
  const object = await bucket.get(filepath);
  if (!object) {
    return { status: 404, body: 'Not Found' };
  }
  const contents = new Uint8Array(await object.arrayBuffer());
  const sha = await blobSha(contents);
  if (sha !== expectedSha) {
    return { status: 404, body: 'Not Found' };
  }
  return { status: 200, body: contents };
}

async function update(
  req: DrystackRequest,
  config: Config,
  bucket: R2BucketLike
): Promise<DrystackResponse> {
  if (
    req.headers.get('no-cors') !== '1' ||
    req.headers.get('content-type') !== 'application/json'
  ) {
    return { status: 400, body: 'Bad Request' };
  }
  const isFilepathValid = getIsPathValid(config);
  const filepath = s.refine(s.string(), 'filepath', isFilepathValid);
  let updates;
  try {
    updates = s.create(
      await req.json(),
      s.object({
        additions: s.array(
          s.object({
            path: filepath,
            contents: base64Schema,
          })
        ),
        deletions: s.array(s.object({ path: filepath })),
      })
    );
  } catch {
    return { status: 400, body: 'Bad data' };
  }
  for (const addition of updates.additions) {
    const sha = await blobSha(addition.contents);
    await bucket.put(addition.path, addition.contents, {
      customMetadata: { [SHA_METADATA_KEY]: sha },
    });
  }
  for (const deletion of updates.deletions) {
    // Local mode's `fs.rm(..., { recursive: true })` accepts both a file and
    // a directory; mirror that by deleting the exact key plus everything
    // under it as a prefix.
    await bucket.delete(deletion.path);
    const nested = await listAll(bucket, `${deletion.path}/`);
    if (nested.length) {
      await bucket.delete(nested.map(obj => obj.key));
    }
  }
  return json(await bucketToTreeEntries(bucket, config));
}

// ---------------------------------------------------------------------------
// auth/* routes
// ---------------------------------------------------------------------------

const credentialsSchema = s.object({
  email: s.string(),
  password: s.string(),
  profile: s.optional(s.record(s.string(), s.unknown())),
});

// One shared failure body for "no such user" and "wrong password" so the
// route can't be used to enumerate which emails have accounts.
const badCredentials = () => json({ error: 'invalid-credentials' }, 401);

async function readUserFile(
  bucket: R2BucketLike,
  email: string
): Promise<NativeAuthUserFile | null> {
  const object = await bucket.get(userFileKey(email));
  if (!object) return null;
  try {
    const parsed = JSON.parse(
      new TextDecoder().decode(await object.arrayBuffer())
    );
    if (typeof parsed?.password !== 'string') return null;
    return parsed as NativeAuthUserFile;
  } catch {
    return null;
  }
}

async function hasAnyUser(bucket: R2BucketLike) {
  const page = await bucket.list({ prefix: AUTH_NATIVE_PREFIX });
  return page.objects.length > 0;
}

async function authRoutes(
  req: DrystackRequest,
  params: string[],
  bucket: R2BucketLike,
  secret: string,
  session: () => Promise<{ email: string } | null>
): Promise<DrystackResponse> {
  const route = params.join('/');

  if (req.method === 'GET' && route === 'status') {
    // Drives the /login page: an empty auth/native/ directory means this is a
    // fresh deployment and the page shows the create-first-admin form
    // instead. `authenticated` is verified server-side, not read off the hint
    // cookie.
    return json({
      needsSetup: !(await hasAnyUser(bucket)),
      authenticated: !!(await session()),
    });
  }

  if (req.method === 'GET' && route === 'me') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    const file = await readUserFile(bucket, current.email);
    if (!file) return { status: 401, body: 'Not authorized' };
    return json({
      email: current.email,
      profile: await decryptProfile(file, secret),
    });
  }

  if (req.method === 'POST' && route === 'logout') {
    return {
      status: 200,
      headers: [
        ...clearSessionCookieHeaders(),
        ['content-type', 'application/json'],
      ],
      body: JSON.stringify({ ok: true }),
    };
  }

  if (req.method === 'POST' && (route === 'login' || route === 'setup')) {
    let credentials;
    try {
      credentials = s.create(await req.json(), credentialsSchema);
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    const email = normalizeEmail(credentials.email);
    if (!email) return badCredentials();

    let file: NativeAuthUserFile | null;
    if (route === 'setup') {
      // First-run bootstrap: only ever works while auth/native/ is empty, so
      // a deployed site with any user at all exposes nothing here. Races
      // between two concurrent setups are harmless - last write wins on a
      // bucket that by definition has no real users yet.
      if (await hasAnyUser(bucket)) {
        return json({ error: 'already-set-up' }, 403);
      }
      if (credentials.password.length < 8) {
        return json({ error: 'password-too-short' }, 400);
      }
      file = await createUserFile(
        credentials.password,
        credentials.profile ?? {},
        secret
      );
      await bucket.put(
        userFileKey(email),
        new TextEncoder().encode(JSON.stringify(file, null, 2))
      );
    } else {
      file = await readUserFile(bucket, email);
      if (!file || !(await verifyPassword(credentials.password, file.password))) {
        return badCredentials();
      }
    }

    const token = await signSession({ email }, secret);
    return {
      status: 200,
      headers: [...sessionCookieHeaders(token), ['content-type', 'application/json']],
      body: JSON.stringify({
        email,
        profile: await decryptProfile(file, secret),
      }),
    };
  }

  return { status: 404, body: 'Not Found' };
}

// The AI routes cost real money on the site owner's account, so in r2 mode
// they get the same session gate as writes (mirrors the GitHub-mode token
// verification in api/ai/index.ts's requireSession). Exported for generic.ts
// to consult before delegating to the AI handler.
export async function requireNativeSession(
  req: DrystackRequest,
  secret: string | undefined
): Promise<boolean> {
  if (!secret) return false;
  return !!(await getSessionFromCookieHeader(req.headers.get('cookie'), secret));
}

// Small helper for cookie parsing consumers that only need the raw token
// (e.g. the /drystack page gate in @drystack/astro).
export function readSessionCookie(cookieHeader: string | null): string | null {
  if (!cookieHeader) return null;
  return cookie.parse(cookieHeader)['drystack-session'] ?? null;
}
