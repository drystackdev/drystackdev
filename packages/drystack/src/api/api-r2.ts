import * as s from 'superstruct';
import { Config } from '../config';
import { blobSha, updateTreeWithChanges } from '../app/trees';
import { base64UrlDecode } from '#base64';
import { DrystackRequest, DrystackResponse } from './internal-utils';
import { getAllowedDirectories } from './allowed-directories';
import {
  AUTH_DIRECTORY,
  AUTH_NATIVE_PREFIX,
  NativeAuthUserFile,
  NativeSession,
  clearSessionCookieHeaders,
  createUserFile,
  getSessionFromCookieHeader,
  legacyUserFileKey,
  normalizeEmail,
  parseUserFile,
  revokedKey,
  serializeUserFile,
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
  // Metadata-only existence check - used by the runtime reader (reader/r2.ts)
  // for `fileExists`, which is called per collection entry when listing; a
  // `get()` there would transfer every entry's full body just to answer a
  // boolean.
  head(key: string): Promise<R2ObjectMetaLike | null>;
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

// Exported for reader/r2.ts's `readdir`, which needs the same "list every
// object under a prefix" pagination this module already does for the tree
// route - no reason to duplicate the cursor loop.
export async function listAll(bucket: R2BucketLike, prefix?: string) {
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

// A revoked session is one whose jti has a `auth/revoked/<jti>` object -
// written by logout (see authRoutes below). Checked on every request that
// has bucket access, on top of the stateless signature+expiry check
// `verifySession` already does - a stolen-but-unexpired token stops working
// the moment its owner logs out, instead of surviving up to 7 days.
async function isRevoked(bucket: R2BucketLike, jti: string): Promise<boolean> {
  return !!(await bucket.get(revokedKey(jti)));
}

// Exported (not just used internally) so page-gating code with its own
// bucket/request access - e.g. @drystack/astro's native-session.ts, which
// gates the /drystack page itself - checks the exact same blacklist instead
// of only the stateless signature+expiry check. A revoked cookie must fail
// everywhere, not just at the API layer.
//
// Also re-checks that the user file itself still exists. Without this, a
// deleted user's existing (unexpired, unrevoked) session cookie would keep
// working for up to NATIVE_SESSION_MAX_AGE_SECONDS after deletion - the
// jti blacklist only covers logout, not account removal. One extra
// `bucket.get()` per gated request in r2 mode; the correctness this buys
// (a removed user loses access immediately) is worth it.
export async function verifiedSession(
  req: DrystackRequest,
  bucket: R2BucketLike,
  secret: string
): Promise<NativeSession | null> {
  const session = await getSessionFromCookieHeader(
    req.headers.get('cookie'),
    secret
  );
  if (!session) return null;
  if (await isRevoked(bucket, session.jti)) return null;
  if (!(await readUserFile(bucket, session.email))) return null;
  return session;
}

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
        body: "storage: { kind: 'r2' } requires DRYSTACK_SECRET to be set - it signs login sessions",
      };
    }
    const session = () => verifiedSession(req, bucket, secret);

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

// A single R2 object whose `customMetadata` carries a version token, bumped
// on every successful write (see `update` below). Public SSR pages (see
// @drystack/astro's cache-middleware.ts) fold this into their Workers Cache
// API key, so a rendered page stays cached until the *next* write bumps the
// version - not for a fixed TTL. One `head()` (metadata only, no body
// transfer) per page render to read it back; outside the content allowlist
// like `auth/`, so it's never listed/served by tree/blob/update.
const CONTENT_VERSION_KEY = '_meta/content-version';
const CONTENT_VERSION_METADATA_KEY = 'v';

export async function getContentVersion(bucket: R2BucketLike): Promise<string> {
  const object = await bucket.head(CONTENT_VERSION_KEY);
  return object?.customMetadata?.[CONTENT_VERSION_METADATA_KEY] ?? '0';
}

async function bumpContentVersion(bucket: R2BucketLike): Promise<void> {
  // Timestamp plus a random suffix, not just Date.now(): two writes inside
  // the same millisecond (realistic under test, and not impossible under
  // real traffic) would otherwise produce the identical "new" version,
  // silently keeping stale pages cached through the second write.
  const version = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await bucket.put(CONTENT_VERSION_KEY, new Uint8Array(0), {
    customMetadata: { [CONTENT_VERSION_METADATA_KEY]: version },
  });
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
  if (updates.additions.length || updates.deletions.length) {
    // Public SSR pages are cached until this changes (see the doc comment
    // above `getContentVersion`) - bump it as part of the same write so a
    // save takes effect on the very next request, no separate invalidation
    // step to forget.
    await bumpContentVersion(bucket);
  }
  return json(await bucketToTreeEntries(bucket, config));
}

// ---------------------------------------------------------------------------
// auth/* routes
// ---------------------------------------------------------------------------

const credentialsSchema = s.object({
  email: s.string(),
  password: s.string(),
});

// One shared failure body for "no such user" and "wrong password" so the
// route can't be used to enumerate which emails have accounts.
const badCredentials = () => json({ error: 'invalid-credentials' }, 401);

async function readUserFile(
  bucket: R2BucketLike,
  email: string
): Promise<NativeAuthUserFile | null> {
  // Prefer the current YAML object; fall back to a pre-migration `.json` one so
  // accounts created before the format switch keep authenticating.
  const object =
    (await bucket.get(userFileKey(email))) ??
    (await bucket.get(legacyUserFileKey(email)));
  if (!object) return null;
  return parseUserFile(new TextDecoder().decode(await object.arrayBuffer()));
}

async function writeUserFile(
  bucket: R2BucketLike,
  email: string,
  file: NativeAuthUserFile
): Promise<void> {
  await bucket.put(
    userFileKey(email),
    new TextEncoder().encode(serializeUserFile(file))
  );
  // Migrate: once the YAML object exists, drop any legacy JSON twin so listings
  // and reads never see both. No-op when there was never a legacy file.
  await bucket.delete(legacyUserFileKey(email));
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
  session: () => Promise<NativeSession | null>
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
    return json({ email: current.email });
  }

  if (req.method === 'POST' && route === 'logout') {
    // Revoke the *specific* token being logged out of, not "whatever
    // `session()` resolves to" - a session already revoked (e.g. the second
    // tab of a two-tab logout) still parses fine statelessly, and
    // re-writing the same revoked key is a harmless no-op. getSessionFrom-
    // CookieHeader is the stateless check (no blacklist lookup) precisely so
    // this works even mid-way through an already-revoked token's lifetime.
    const raw = await getSessionFromCookieHeader(
      req.headers.get('cookie'),
      secret
    );
    if (raw) {
      await bucket.put(
        revokedKey(raw.jti),
        new TextEncoder().encode(String(raw.exp))
      );
    }
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
      file = await createUserFile(credentials.password, {});
      await writeUserFile(bucket, email, file);
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
      body: JSON.stringify({ email }),
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
  bucket: R2BucketLike | undefined,
  secret: string | undefined
): Promise<boolean> {
  if (!bucket || !secret) return false;
  return !!(await verifiedSession(req, bucket, secret));
}
