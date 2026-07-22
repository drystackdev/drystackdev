import * as s from 'superstruct';
import { Config } from '../config';
import { blobSha, updateTreeWithChanges } from '../app/trees';
import { base64UrlDecode } from '#base64';
import { DrystackRequest, DrystackResponse } from './internal-utils';
import { getAllowedDirectories } from './allowed-directories';
import {
  AUTH_DIRECTORY,
  NativeSession,
  clearSessionCookieHeaders,
  getSessionFromCookieHeader,
  hashPassword,
  normalizeEmail,
  revokedKey,
  sessionCookieHeaders,
  signSession,
  verifyPassword,
} from './native-auth';
import {
  D1DatabaseLike,
  RoleRow,
  assignRole,
  countUsers,
  createUser,
  getActiveSessionUser,
  getRoleByName,
  getUserByEmail,
  setPasswordAndConsumeToken,
} from './d1';
import {
  SUPER_ADMIN_ROLE,
  effectivePermissions,
  hasPermission,
  isAdmin,
  isSuperAdmin,
} from './permissions';
import { getPathOwners, ownerForPath, permissionForPath } from './permission-paths';
import { AVATAR_DIRECTORY, userManagementRoutes } from './user-management';
import { EmailSenderBinding, makeCloudflareEmailSender } from './email';

// R2-backed twin of api-node.ts: same routes, same request/response shapes,
// with the filesystem swapped for an R2 bucket and the whole thing runnable
// in workerd (WebCrypto only, no node builtins). Deliberate differences from
// local mode, from the auth plan (plan/auth.md) and the user/role plan
// (plan/user-managent.md):
//   - `tree`/`blob`/`update` all require a valid native session (the
//     deployment is public, unlike a dev machine), as do the `auth/me`-style
//     routes below.
//   - on top of that, each requires the session's role(s) to grant the
//     relevant `collection:<key>.<action>`/`singleton:<key>.<action>`
//     permission for whichever collection/singleton a path belongs to.
//   - the `auth/` prefix is invisible: never listed by `tree`, never served
//     by `blob`, never writable via `update`. It holds only the R2-resident
//     session-revocation list now (see native-auth.ts) - user accounts
//     themselves live in D1 (see d1.ts).

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
// simply doesn't exist as far as the content API is concerned. On top of
// that, entries belonging to a collection/singleton the session lacks `view`
// on are dropped too (plan/user-managent.md mục 5/6) - unowned paths (media
// library, trash, templates) have no single collection to gate, so they pass
// through once the caller has any valid session at all (checked by callers).
async function bucketToTreeEntries(
  bucket: R2BucketLike,
  config: Config,
  roles: RoleRow[]
) {
  const isPathValid = getIsPathValid(config);
  const owners = getPathOwners(config);
  const objects = (await listAll(bucket)).filter(obj => {
    if (!isPathValid(obj.key)) return false;
    const permission = permissionForPath(owners, obj.key, 'view');
    return !permission || hasPermission(roles, permission);
  });
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

export type VerifiedSession = NativeSession & {
  roles: RoleRow[];
  name: string;
  avatar: string | null;
};

// Exported (not just used internally) so page-gating code with its own
// bucket/db/request access - e.g. @drystack/astro's native-session.ts, which
// gates the /drystack page itself - checks the exact same blacklist instead
// of only the stateless signature+expiry check. A revoked cookie must fail
// everywhere, not just at the API layer.
//
// Also re-checks the D1 user row: gone or `active = 0` invalidates the
// session immediately (plan/user-managent.md mục 3), not just at next
// expiry/logout - the jti blacklist only covers logout, not account removal
// or deactivation. One extra D1 lookup per gated request in r2 mode; the
// correctness this buys (a removed/deactivated user loses access
// immediately) is worth it. Returns the session's roles alongside the usual
// email/jti/exp so callers can permission-check without a second lookup.
export async function verifiedSession(
  req: DrystackRequest,
  bucket: R2BucketLike,
  db: D1DatabaseLike,
  secret: string
): Promise<VerifiedSession | null> {
  const session = await getSessionFromCookieHeader(
    req.headers.get('cookie'),
    secret
  );
  if (!session) return null;
  if (await isRevoked(bucket, session.jti)) return null;
  const sessionUser = await getActiveSessionUser(db, session.email);
  if (!sessionUser) return null;
  return {
    ...session,
    roles: sessionUser.roles,
    name: sessionUser.user.name,
    avatar: sessionUser.user.avatar,
  };
}

export function r2ModeApiHandler(
  config: Config,
  bucket: R2BucketLike | undefined,
  db: D1DatabaseLike | undefined,
  secret: string | undefined,
  emailSender?: EmailSenderBinding,
  emailFrom?: string
) {
  const sendEmail = makeCloudflareEmailSender(emailSender, emailFrom);
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
    if (!db) {
      return {
        status: 500,
        body: "storage: { kind: 'r2' } requires a D1 database binding named DRYSTACK_DB (add a `d1_databases` entry to wrangler.jsonc)",
      };
    }
    if (!secret) {
      return {
        status: 500,
        body: "storage: { kind: 'r2' } requires DRYSTACK_SECRET to be set - it signs login sessions",
      };
    }
    const session = () => verifiedSession(req, bucket, db, secret);

    const joined = params.join('/');
    if (params[0] === 'auth') {
      return authRoutes(req, params.slice(1), bucket, db, secret, session);
    }
    if (
      params[0] === 'users' ||
      params[0] === 'roles' ||
      params[0] === 'profile' ||
      joined === 'password-setting' ||
      joined === 'forgot-password'
    ) {
      return userManagementRoutes(req, params, {
        db,
        session,
        sendEmail,
        putAvatarObject: async (path, contents) => {
          await bucket.put(path, contents);
        },
      });
    }
    if (req.method === 'GET' && joined === 'tree') {
      if (req.headers.get('no-cors') !== '1') {
        return { status: 400, body: 'Bad Request' };
      }
      const current = await session();
      if (!current) return { status: 401, body: 'Not authorized' };
      return json(await bucketToTreeEntries(bucket, config, current.roles));
    }
    if (req.method === 'GET' && params[0] === 'blob') {
      return blob(req, config, params, bucket, session);
    }
    if (req.method === 'GET' && params[0] === 'avatar') {
      return avatarBlob(req, params.slice(1).join('/'), bucket, session);
    }
    if (req.method === 'POST' && joined === 'update') {
      const current = await session();
      if (!current) {
        return { status: 401, body: 'Not authorized' };
      }
      return update(req, config, bucket, current.roles);
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
  bucket: R2BucketLike,
  session: () => Promise<VerifiedSession | null>
): Promise<DrystackResponse> {
  if (req.headers.get('no-cors') !== '1') {
    return { status: 400, body: 'Bad Request' };
  }
  const expectedSha = params[1];
  const filepath = params.slice(2).join('/');
  if (!getIsPathValid(config)(filepath)) {
    return { status: 400, body: 'Bad Request' };
  }
  const current = await session();
  if (!current) return { status: 401, body: 'Not authorized' };
  const permission = permissionForPath(getPathOwners(config), filepath, 'view');
  if (permission && !hasPermission(current.roles, permission)) {
    return { status: 403, body: 'Forbidden' };
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

const AVATAR_CONTENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
};

// Separate from `blob` above on purpose: avatars are shown via a plain
// `<img src>` (UsersPage's table, the sidebar, the profile page), which
// can't attach the `no-cors: 1` header `blob` requires, and have no git
// blob sha to pin against (they're outside the content tree entirely - see
// uploadAvatar in user-management.ts, which never goes through the generic
// `update` route). Still requires a session and validates the path stays
// inside AVATAR_DIRECTORY - just without those two blob-specific mechanics.
async function avatarBlob(
  req: DrystackRequest,
  filepath: string,
  bucket: R2BucketLike,
  session: () => Promise<VerifiedSession | null>
): Promise<DrystackResponse> {
  if (
    !filepath.startsWith(`${AVATAR_DIRECTORY}/`) ||
    filepath.includes('..') ||
    filepath.includes('\\')
  ) {
    return { status: 400, body: 'Bad Request' };
  }
  const current = await session();
  if (!current) return { status: 401, body: 'Not authorized' };
  const object = await bucket.get(filepath);
  if (!object) return { status: 404, body: 'Not Found' };
  const ext = filepath.slice(filepath.lastIndexOf('.') + 1).toLowerCase();
  const contentType = AVATAR_CONTENT_TYPES[ext];
  if (!contentType) return { status: 404, body: 'Not Found' };
  return {
    status: 200,
    headers: { 'content-type': contentType },
    body: new Uint8Array(await object.arrayBuffer()),
  };
}

async function update(
  req: DrystackRequest,
  config: Config,
  bucket: R2BucketLike,
  roles: RoleRow[]
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

  // SuperAdmin/Admin always pass (hardcoded full access, see permissions.ts)
  // - skip the per-path resolution/head() calls entirely for them. Everyone
  // else needs `created`/`updated`/`deleted` on whichever collection/
  // singleton each path belongs to; unowned paths (media library, trash,
  // templates) aren't gated per-path, same as the tree/blob read side.
  if (!isSuperAdmin(roles) && !isAdmin(roles)) {
    const owners = getPathOwners(config);
    for (const addition of updates.additions) {
      if (!ownerForPath(owners, addition.path)) continue;
      const existed = !!(await bucket.head(addition.path));
      const permission = permissionForPath(
        owners,
        addition.path,
        existed ? 'updated' : 'created'
      )!;
      if (!hasPermission(roles, permission)) {
        return { status: 403, body: 'Forbidden' };
      }
    }
    for (const deletion of updates.deletions) {
      const permission = permissionForPath(owners, deletion.path, 'deleted');
      if (permission && !hasPermission(roles, permission)) {
        return { status: 403, body: 'Forbidden' };
      }
    }
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
  return json(await bucketToTreeEntries(bucket, config, roles));
}

// ---------------------------------------------------------------------------
// auth/* routes
// ---------------------------------------------------------------------------

// `name` is optional so the minimal /login setup form and scripts/r2-seed.ts
// (both send only email+password) keep working - falls back to the email
// itself. The full /register-first page sends a real name once it lands (see
// plan/user-managent.md mục 6) and this same route honors it.
const credentialsSchema = s.object({
  email: s.string(),
  password: s.string(),
  name: s.optional(s.string()),
});

// One shared failure body for "no such user" and "wrong password" so the
// route can't be used to enumerate which emails have accounts.
const badCredentials = () => json({ error: 'invalid-credentials' }, 401);

async function authRoutes(
  req: DrystackRequest,
  params: string[],
  bucket: R2BucketLike,
  db: D1DatabaseLike,
  secret: string,
  session: () => Promise<VerifiedSession | null>
): Promise<DrystackResponse> {
  const route = params.join('/');

  if (req.method === 'GET' && route === 'status') {
    // Drives the /login page: an empty `user` table means this is a fresh
    // deployment (or one that just cut over to D1 - see plan/user-managent.md
    // mục 8) and the page shows the create-first-admin form instead.
    // `authenticated` is verified server-side, not read off the hint cookie.
    return json({
      needsSetup: (await countUsers(db)) === 0,
      authenticated: !!(await session()),
    });
  }

  if (req.method === 'GET' && route === 'me') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    // The client (useNavItems.tsx, MagicWriteButton.tsx) gates nav items and
    // the AI button on this - fullAccess mirrors the server's SuperAdmin/Admin
    // hardcode (permissions.ts's hasPermission), permissions is the union
    // across every role (plan/user-managent.md mục 5/6). Client-side gating
    // is UX only; the server checks above are the real boundary.
    return json({
      email: current.email,
      name: current.name,
      avatar: current.avatar,
      permissions: [...effectivePermissions(current.roles)],
      fullAccess: isSuperAdmin(current.roles) || isAdmin(current.roles),
      // Only SuperAdmin can delete users / grant-or-revoke Admin (mục 4) -
      // fullAccess alone can't tell the two apart, and the UsersPage/
      // RolesPage delete/promote buttons need to know before they even
      // render, not just when the server 403s the attempt.
      isSuperAdmin: isSuperAdmin(current.roles),
    });
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

    if (route === 'setup') {
      // First-run bootstrap: only ever works while the `user` table is
      // empty, so a deployed site with any user at all exposes nothing here.
      // Races between two concurrent setups can both pass this check before
      // either inserts - harmless for the D1 row itself (both would just
      // create a user), but only the FIRST insert should become SuperAdmin;
      // acceptable at this scale (a brand-new deployment, one operator).
      if ((await countUsers(db)) > 0) {
        return json({ error: 'already-set-up' }, 403);
      }
      if (credentials.password.length < 8) {
        return json({ error: 'password-too-short' }, 400);
      }
      const passwordHash = await hashPassword(credentials.password);
      const user = await createUser(db, {
        email,
        name: credentials.name?.trim() || email,
        password: passwordHash,
      });
      // Stamps email_verify_at: this person just proved control of the
      // account by setting its password directly (there's no separate
      // invite step to verify against, unlike `POST users`) - without this
      // the User list page would show a nonsensical "Resend invite" button
      // for the SuperAdmin, who already has a password. Same call
      // add/resend-invite's token flow ends with, just re-affirming the
      // password already set above (setPasswordAndConsumeToken is
      // idempotent here - invite_token is already null).
      await setPasswordAndConsumeToken(db, user.id, passwordHash);
      // The one and only place SuperAdmin is ever assigned - see plan
      // mục 3/6. Seeded by migrations/0001_init.sql; if a site somehow
      // deleted the row, setup still succeeds (just without a SuperAdmin -
      // the operator would need to re-run migrations).
      const superAdminRole = await getRoleByName(db, SUPER_ADMIN_ROLE);
      if (superAdminRole) {
        await assignRole(db, user.id, superAdminRole.id);
      }
    } else {
      const user = await getUserByEmail(db, email);
      if (
        !user ||
        !user.active ||
        !user.password ||
        !(await verifyPassword(credentials.password, user.password))
      ) {
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
// to consult before delegating to the AI handler. Per-collection
// `magicWriter` permission is enforced separately, inside the AI handler
// itself (still to land - see plan/user-managent.md mục 5) since only it
// knows which collection/singleton a given ai/* request targets.
export async function requireNativeSession(
  req: DrystackRequest,
  bucket: R2BucketLike | undefined,
  db: D1DatabaseLike | undefined,
  secret: string | undefined
): Promise<boolean> {
  if (!bucket || !db || !secret) return false;
  return !!(await verifiedSession(req, bucket, db, secret));
}
