import * as s from 'superstruct';
import { Config } from '../config';
import { blobSha, updateTreeWithChanges } from '../app/trees';
import { base64UrlDecode } from '#base64';
import { DrystackRequest, DrystackResponse } from './internal-utils';
import { getAllowedDirectories } from './allowed-directories';
import {
  AUTH_DIRECTORY,
  AUTH_NATIVE_PREFIX,
  AUTH_INVITES_PREFIX,
  AUTH_AVATARS_PREFIX,
  INVITE_TOKEN_MAX_AGE_SECONDS,
  NativeAuthInviteFile,
  NativeAuthUserFile,
  NativeSession,
  avatarKey,
  clearSessionCookieHeaders,
  createUserFile,
  getSessionFromCookieHeader,
  hashPassword,
  inviteFileKey,
  legacyUserFileKey,
  normalizeEmail,
  parseUserFile,
  revokedKey,
  serializeUserFile,
  sessionCookieHeaders,
  signInviteToken,
  signSession,
  userFileKey,
  verifyInviteToken,
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

// Structural subset of Cloudflare's Email Sending Workers binding, typed
// locally so @drystack/core doesn't depend on @cloudflare/workers-types (same
// reasoning as R2BucketLike above). Only the shape actually used - see the
// binding's own docs for the rest (attachments, etc).
export type EmailSenderLike = {
  send(message: {
    to: string;
    from: { email: string; name?: string };
    subject: string;
    html?: string;
    text?: string;
  }): Promise<unknown>;
};

export function r2ModeApiHandler(
  config: Config,
  bucket: R2BucketLike | undefined,
  secret: string | undefined,
  emailSender?: EmailSenderLike,
  inviteFromEmail?: string
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
      return authRoutes(
        req,
        params.slice(1),
        bucket,
        secret,
        session,
        config,
        emailSender,
        inviteFromEmail ?? 'no-reply@drystack.dev'
      );
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
  profile: s.optional(s.record(s.string(), s.unknown())),
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

// Public shape of a user for the profile/edit UI: identity + editable profile
// fields + whether an avatar exists (its bytes are served by the separate
// avatar route). Never includes the password hash. Returns null when the user
// doesn't exist. Shared by `me` and `GET users/<email>`.
async function userProfileResponse(
  bucket: R2BucketLike,
  email: string
): Promise<{ email: string; profile: unknown; hasAvatar: boolean } | null> {
  const [file, avatar] = await Promise.all([
    readUserFile(bucket, email),
    bucket.head(avatarKey(email)),
  ]);
  if (!file) return null;
  return { email, profile: file.profile ?? {}, hasAvatar: !!avatar };
}

async function readInviteFile(
  bucket: R2BucketLike,
  email: string
): Promise<NativeAuthInviteFile | null> {
  const object = await bucket.get(inviteFileKey(email));
  if (!object) return null;
  try {
    return JSON.parse(
      new TextDecoder().decode(await object.arrayBuffer())
    ) as NativeAuthInviteFile;
  } catch {
    return null;
  }
}

function emailFromKey(key: string, prefix: string): string {
  // Strip the prefix and the file extension only - emails contain dots (in the
  // domain/TLD), so anchor the removal to a trailing `.yaml`/`.json`.
  return key.slice(prefix.length).replace(/\.(ya?ml|json)$/, '');
}

async function hasAnyUser(bucket: R2BucketLike) {
  const page = await bucket.list({ prefix: AUTH_NATIVE_PREFIX });
  return page.objects.length > 0;
}

function profileName(profile: unknown): string | undefined {
  const name = (profile as { name?: unknown } | undefined)?.name;
  return typeof name === 'string' && name ? name : undefined;
}

// Bilingual invite email copy, matching the dictionary pattern already used
// by drystack-login.astro. Both html and text bodies are sent (deliverability
// best practice - some clients only render one).
function inviteEmailContent(locale: string | undefined, link: string) {
  const vi = (locale ?? '').toLowerCase().startsWith('vi');
  const subject = vi
    ? 'Lời mời quản trị trang web'
    : 'You have been invited to manage this site';
  const text = vi
    ? `Bạn được mời tham gia quản trị trang web.\n\nNhấn vào liên kết bên dưới để tạo mật khẩu và kích hoạt tài khoản (liên kết hết hạn sau 48 giờ):\n${link}\n\nNếu bạn không yêu cầu lời mời này, có thể bỏ qua email này.`
    : `You've been invited to manage this site.\n\nClick the link below to set a password and activate your account (expires in 48 hours):\n${link}\n\nIf you didn't expect this invite, you can ignore this email.`;
  const html = `<p>${text.replace(/\n/g, '<br/>')}</p>`;
  return { subject, text, html };
}

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

async function authRoutes(
  req: DrystackRequest,
  params: string[],
  bucket: R2BucketLike,
  secret: string,
  session: () => Promise<NativeSession | null>,
  config: Config,
  emailSender: EmailSenderLike | undefined,
  inviteFromEmail: string
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
    const me = await userProfileResponse(bucket, current.email);
    if (!me) return { status: 401, body: 'Not authorized' };
    return json(me);
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
      file = await createUserFile(credentials.password, credentials.profile ?? {});
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
      body: JSON.stringify({
        email,
        profile: file.profile ?? {},
      }),
    };
  }

  // -------------------------------------------------------------------------
  // User management (list/invite/delete/accept/self-service password+avatar)
  // -------------------------------------------------------------------------

  if (req.method === 'GET' && route === 'users') {
    if (!(await session())) return { status: 401, body: 'Not authorized' };
    const [activeObjects, inviteObjects] = await Promise.all([
      listAll(bucket, AUTH_NATIVE_PREFIX),
      listAll(bucket, AUTH_INVITES_PREFIX),
    ]);
    // Dedupe by email: a user mid-migration could momentarily have both a
    // `.yaml` and a legacy `.json` object under the native prefix.
    const activeEmails = [
      ...new Set(
        activeObjects.map(obj => emailFromKey(obj.key, AUTH_NATIVE_PREFIX))
      ),
    ];
    const activeUsers = await Promise.all(
      activeEmails.map(async email => {
        const [file, avatar] = await Promise.all([
          readUserFile(bucket, email),
          bucket.head(avatarKey(email)),
        ]);
        return {
          email,
          name: profileName(file?.profile),
          // Full profile so the list can render columns from the user schema
          // (config.user). Never carries a credential - readUserFile's result
          // omits nothing, but the file's only secret (password) isn't spread
          // here.
          profile: file?.profile ?? {},
          createdAt: file?.createdAt ?? null,
          hasAvatar: !!avatar,
          pending: false as const,
        };
      })
    );
    const pendingUsers = await Promise.all(
      inviteObjects.map(async obj => {
        const email = emailFromKey(obj.key, AUTH_INVITES_PREFIX);
        const [invite, avatar] = await Promise.all([
          readInviteFile(bucket, email),
          bucket.head(avatarKey(email)),
        ]);
        return {
          email,
          name: profileName(invite?.profile),
          // Admin-provided profile carried on the invite, so a pending row shows
          // the same schema columns a real user does.
          profile: invite?.profile ?? {},
          createdAt: invite?.createdAt ?? null,
          expiresAt: invite?.expiresAt ?? null,
          // An admin can set an avatar at invite time (bytes keyed by email,
          // written before the account exists).
          hasAvatar: !!avatar,
          pending: true as const,
        };
      })
    );
    const users = [...activeUsers, ...pendingUsers].sort((a, b) =>
      (a.createdAt ?? '').localeCompare(b.createdAt ?? '')
    );
    return json({ users });
  }

  // Single user, for the admin edit form. GET-only, so it never collides with
  // the POST `users/delete` / `users/update` sub-routes below (and `delete`/
  // `update` aren't valid emails anyway).
  if (req.method === 'GET' && params[0] === 'users' && params.length === 2) {
    if (!(await session())) return { status: 401, body: 'Not authorized' };
    const email = normalizeEmail(params[1]);
    if (!email) return json({ error: 'invalid-email' }, 400);
    const user = await userProfileResponse(bucket, email);
    if (!user) {
      // A pending (not-yet-accepted) invite is still editable by an admin - its
      // profile lives on the invite record.
      const invite = await readInviteFile(bucket, email);
      if (!invite) return json({ error: 'not-found' }, 404);
      const avatar = await bucket.head(avatarKey(email));
      return json({
        email,
        profile: invite.profile ?? {},
        hasAvatar: !!avatar,
        pending: true,
      });
    }
    return json(user);
  }

  if (req.method === 'POST' && route === 'users') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    let body;
    try {
      body = s.create(
        await req.json(),
        s.object({
          email: s.string(),
          profile: s.optional(s.record(s.string(), s.unknown())),
        })
      );
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'invalid-email' }, 400);
    if ((await readUserFile(bucket, email)) || (await readInviteFile(bucket, email))) {
      return json({ error: 'already-exists' }, 409);
    }
    const now = Date.now();
    const invite: NativeAuthInviteFile = {
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + INVITE_TOKEN_MAX_AGE_SECONDS * 1000).toISOString(),
      invitedBy: current.email,
      // Admin-filled profile from the "create user" form. Applied when the
      // invitee accepts (see invite/accept below).
      ...(body.profile ? { profile: body.profile } : {}),
    };
    await bucket.put(
      inviteFileKey(email),
      new TextEncoder().encode(JSON.stringify(invite, null, 2))
    );
    if (!emailSender) {
      await bucket.delete(inviteFileKey(email));
      return json({ error: 'email-not-configured' }, 500);
    }
    const token = await signInviteToken(email, secret);
    const origin = new URL(req.url).origin;
    const link = `${origin}/login?invite=${encodeURIComponent(token)}`;
    const { subject, text, html } = inviteEmailContent(config.locale, link);
    try {
      await emailSender.send({
        to: email,
        from: { email: inviteFromEmail, name: 'Drystack' },
        subject,
        text,
        html,
      });
    } catch {
      await bucket.delete(inviteFileKey(email));
      return json({ error: 'email-failed' }, 502);
    }
    return json({ ok: true });
  }

  if (req.method === 'POST' && route === 'users/delete') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    let body;
    try {
      body = s.create(await req.json(), s.object({ email: s.string() }));
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'invalid-email' }, 400);
    if (email === current.email) {
      return json({ error: 'cannot-delete-self' }, 400);
    }
    if (await readInviteFile(bucket, email)) {
      await bucket.delete(inviteFileKey(email));
      return json({ ok: true });
    }
    if (!(await readUserFile(bucket, email))) {
      return json({ error: 'not-found' }, 404);
    }
    const activeCount = (await listAll(bucket, AUTH_NATIVE_PREFIX)).length;
    if (activeCount <= 1) {
      return json({ error: 'cannot-delete-last-user' }, 400);
    }
    // Delete both the current YAML object and any legacy JSON twin so a
    // half-migrated user can't linger.
    await bucket.delete(userFileKey(email));
    await bucket.delete(legacyUserFileKey(email));
    await bucket.delete(avatarKey(email));
    return json({ ok: true });
  }

  // Update a user's editable profile fields (not password, not email). Any
  // signed-in user may edit any user - the native-auth model has no non-admin
  // role (mirrors the invite/delete routes above). Self-service profile edits
  // on the /profile page hit this same route with their own email.
  if (req.method === 'POST' && route === 'users/update') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    let body;
    try {
      body = s.create(
        await req.json(),
        s.object({
          email: s.string(),
          profile: s.record(s.string(), s.unknown()),
        })
      );
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    const email = normalizeEmail(body.email);
    if (!email) return json({ error: 'invalid-email' }, 400);
    const file = await readUserFile(bucket, email);
    if (file) {
      // Replace the whole profile object with what the form submitted; keep
      // password/createdAt untouched.
      await writeUserFile(bucket, email, { ...file, profile: body.profile });
      return json({ ok: true });
    }
    // Editing a still-pending invite: persist the profile back onto the invite
    // record so it's applied when the invitee accepts.
    const invite = await readInviteFile(bucket, email);
    if (!invite) return json({ error: 'not-found' }, 404);
    await bucket.put(
      inviteFileKey(email),
      new TextEncoder().encode(
        JSON.stringify({ ...invite, profile: body.profile }, null, 2)
      )
    );
    return json({ ok: true });
  }

  if (req.method === 'POST' && route === 'invite/accept') {
    let body;
    try {
      body = s.create(
        await req.json(),
        s.object({
          token: s.string(),
          name: s.string(),
          password: s.string(),
          passwordConfirm: s.string(),
        })
      );
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    if (body.password !== body.passwordConfirm) {
      return json({ error: 'password-mismatch' }, 400);
    }
    if (body.password.length < 8) {
      return json({ error: 'password-too-short' }, 400);
    }
    const invite = await verifyInviteToken(body.token, secret);
    if (!invite) return json({ error: 'invalid-token' }, 400);
    const inviteRecord = await readInviteFile(bucket, invite.email);
    if (!inviteRecord) {
      return json({ error: 'invite-not-found' }, 410);
    }
    if (await readUserFile(bucket, invite.email)) {
      // Already accepted (race / double-submit) - the stale invite record
      // shouldn't linger since it can no longer ever be accepted again.
      await bucket.delete(inviteFileKey(invite.email));
      return json({ error: 'already-accepted' }, 409);
    }
    // Start from whatever profile the admin filled in when inviting, then let
    // the invitee's own typed name override it.
    const baseProfile =
      (inviteRecord.profile as Record<string, unknown> | undefined) ?? {};
    const name = body.name.trim();
    const profile = name ? { ...baseProfile, name } : baseProfile;
    const file = await createUserFile(body.password, profile);
    await writeUserFile(bucket, invite.email, file);
    await bucket.delete(inviteFileKey(invite.email));
    const token = await signSession({ email: invite.email }, secret);
    return {
      status: 200,
      headers: [...sessionCookieHeaders(token), ['content-type', 'application/json']],
      body: JSON.stringify({ email: invite.email, profile: file.profile ?? {} }),
    };
  }

  if (req.method === 'POST' && route === 'password') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    let body;
    try {
      body = s.create(
        await req.json(),
        s.object({
          oldPassword: s.string(),
          newPassword: s.string(),
          newPasswordConfirm: s.string(),
        })
      );
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    if (body.newPassword !== body.newPasswordConfirm) {
      return json({ error: 'password-mismatch' }, 400);
    }
    if (body.newPassword.length < 8) {
      return json({ error: 'password-too-short' }, 400);
    }
    const file = await readUserFile(bucket, current.email);
    if (!file || !(await verifyPassword(body.oldPassword, file.password))) {
      return json({ error: 'invalid-current-password' }, 401);
    }
    await writeUserFile(bucket, current.email, {
      ...file,
      password: await hashPassword(body.newPassword),
    });
    return json({ ok: true });
  }

  if (req.method === 'POST' && route === 'avatar') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    let body;
    try {
      body = s.create(
        await req.json(),
        s.object({
          contents: base64Schema,
          contentType: s.string(),
          // Which user's avatar. Omitted = the caller's own (profile page).
          // An admin sets someone else's (or a pending invite's) by passing it,
          // same open permission model as invite/delete/update above.
          email: s.optional(s.string()),
        })
      );
    } catch {
      return json({ error: 'bad-request' }, 400);
    }
    if (!body.contentType.startsWith('image/')) {
      return json({ error: 'invalid-content-type' }, 400);
    }
    if (body.contents.byteLength > MAX_AVATAR_BYTES) {
      return json({ error: 'avatar-too-large' }, 413);
    }
    const targetEmail = body.email
      ? normalizeEmail(body.email)
      : current.email;
    if (!targetEmail) return json({ error: 'invalid-email' }, 400);
    await bucket.put(avatarKey(targetEmail), body.contents, {
      customMetadata: { contentType: body.contentType },
    });
    return json({ ok: true });
  }

  if (req.method === 'GET' && params[0] === 'avatar' && params.length === 2) {
    if (!(await session())) return { status: 401, body: 'Not authorized' };
    const email = normalizeEmail(params[1]);
    if (!email) return { status: 404, body: 'Not Found' };
    const object = await bucket.get(avatarKey(email));
    if (!object) return { status: 404, body: 'Not Found' };
    const contents = new Uint8Array(await object.arrayBuffer());
    return {
      status: 200,
      headers: {
        'content-type': object.customMetadata?.contentType ?? 'application/octet-stream',
        // Avatars can be replaced at the same URL (no version in the path) -
        // don't let the browser serve a stale one across page loads.
        'cache-control': 'private, no-cache',
      },
      body: contents,
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
