/** @jest-environment node */
import { expect, test } from '@jest/globals';
import { collection, fields } from '..';
import { Config } from '../config';
import { base64UrlEncode } from '#base64';
import { blobSha } from '../app/trees';
import {
  r2ModeApiHandler,
  getContentVersion,
  R2BucketLike,
  R2ObjectMetaLike,
} from './api-r2';
import { hashPassword, signSession } from './native-auth';
import {
  D1DatabaseLike,
  assignRole,
  createRole,
  createUser,
  deleteUser,
  getRoleByName,
  getUserByEmail,
  setUserActive,
  updateRolePermissions,
} from './d1';
import { makeTestD1 } from './d1-test-helpers';
import { SUPER_ADMIN_ROLE } from './permissions';
import { DrystackRequest, DrystackResponse } from './internal-utils';

const SECRET = 's'.repeat(32);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const testConfig = {
  storage: { kind: 'r2' },
  collections: {
    blog: collection({
      label: 'Blog',
      slugField: 'title',
      path: 'blog/*/',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
      },
    }),
  },
} as unknown as Config;

class MemoryBucket implements R2BucketLike {
  store = new Map<
    string,
    { contents: Uint8Array; customMetadata?: Record<string, string> }
  >();
  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.contents.byteLength,
      customMetadata: entry.customMetadata,
      arrayBuffer: async () =>
        entry.contents.buffer.slice(
          entry.contents.byteOffset,
          entry.contents.byteOffset + entry.contents.byteLength
        ) as ArrayBuffer,
    };
  }
  async head(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.contents.byteLength,
      customMetadata: entry.customMetadata,
    };
  }
  async put(
    key: string,
    value: Uint8Array | ArrayBuffer,
    options?: { customMetadata?: Record<string, string> }
  ) {
    const contents =
      value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value);
    this.store.set(key, { contents, customMetadata: options?.customMetadata });
  }
  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.store.delete(key);
    }
  }
  async list(options?: { prefix?: string }) {
    const objects: R2ObjectMetaLike[] = [...this.store.entries()]
      .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
      .map(([key, entry]) => ({
        key,
        size: entry.contents.byteLength,
        customMetadata: entry.customMetadata,
      }));
    return { objects, truncated: false as const };
  }
}

function request(
  method: string,
  path: string,
  options: { body?: unknown; cookie?: string; noCors?: boolean } = {}
): DrystackRequest {
  const headers = new Map<string, string>();
  if (options.noCors !== false) headers.set('no-cors', '1');
  if (options.body !== undefined) headers.set('content-type', 'application/json');
  if (options.cookie) headers.set('cookie', options.cookie);
  return {
    method,
    url: `http://localhost/api/drystack/${path}`,
    headers: { get: (name: string) => headers.get(name.toLowerCase()) ?? null },
    json: async () => options.body,
  };
}

function bodyJson(res: DrystackResponse) {
  return JSON.parse(
    typeof res.body === 'string' ? res.body : decoder.decode(res.body as Uint8Array)
  );
}

async function sessionCookie(email = 'admin@example.com') {
  return `drystack-session=${await signSession({ email }, SECRET)}`;
}

// Defaults to SuperAdmin (full access) so every pre-existing test that isn't
// specifically about permission enforcement keeps its old "a logged-in user
// can do anything" behavior. Permission-restriction tests pass `role`
// explicitly (an already-seeded builtin name, or a RoleRow from
// `createRole`/`updateRolePermissions`).
async function seedUser(
  db: D1DatabaseLike,
  email = 'admin@example.com',
  options: { password?: string; role?: string } = {}
) {
  const password = options.password ?? 'hunter2-hunter2';
  const user = await createUser(db, {
    email,
    name: 'Admin',
    password: await hashPassword(password),
  });
  const role = await getRoleByName(db, options.role ?? SUPER_ADMIN_ROLE);
  if (role) await assignRole(db, user.id, role.id);
  return user;
}

async function listAllKeys(bucket: MemoryBucket) {
  return [...bucket.store.keys()];
}

test('missing bucket, database, or secret is a loud 500', async () => {
  const db = makeTestD1();
  const bucket = new MemoryBucket();
  const noBucket = r2ModeApiHandler(testConfig, undefined, db, SECRET);
  expect((await noBucket(request('GET', 'tree'), ['tree'])).status).toBe(500);
  const noDb = r2ModeApiHandler(testConfig, bucket, undefined, SECRET);
  expect((await noDb(request('GET', 'tree'), ['tree'])).status).toBe(500);
  const noSecret = r2ModeApiHandler(testConfig, bucket, db, undefined);
  expect((await noSecret(request('GET', 'tree'), ['tree'])).status).toBe(500);
});

test('tree requires a session and lists only content/asset dirs, never auth/', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await bucket.put('blog/hello/index.yaml', encoder.encode('title: hello'));
  await bucket.put('assets/pic.png', encoder.encode('png-bytes'));
  await bucket.put('unrelated/top-secret.txt', encoder.encode('nope'));
  await seedUser(db);
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  // anonymous → 401, not just an empty/public tree
  expect((await handler(request('GET', 'tree'), ['tree'])).status).toBe(401);

  const cookie = await sessionCookie();
  const res = await handler(request('GET', 'tree', { cookie }), ['tree']);
  expect(res.status).toBe(200);
  const paths = (bodyJson(res) as { path: string; type: string }[])
    .filter(e => e.type === 'blob')
    .map(e => e.path)
    .sort();
  expect(paths).toEqual(['assets/pic.png', 'blog/hello/index.yaml']);

  // the sha metadata backfill persisted for listed objects
  expect(
    bucket.store.get('blog/hello/index.yaml')!.customMetadata?.[
      'drystack-blob-sha'
    ]
  ).toBeTruthy();

  // no-cors header is required, same as local mode
  expect(
    (await handler(request('GET', 'tree', { noCors: false, cookie }), ['tree']))
      .status
  ).toBe(400);
});

test('blob serves by sha and refuses auth/ and unknown paths', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const contents = encoder.encode('title: hello');
  await bucket.put('blog/hello/index.yaml', contents);
  await seedUser(db);
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);
  const cookie = await sessionCookie();
  const sha = await blobSha(contents);

  // anonymous → 401
  expect(
    (
      await handler(request('GET', `blob/${sha}/blog/hello/index.yaml`), [
        'blob',
        sha,
        'blog',
        'hello',
        'index.yaml',
      ])
    ).status
  ).toBe(401);

  const ok = await handler(
    request('GET', `blob/${sha}/blog/hello/index.yaml`, { cookie }),
    ['blob', sha, 'blog', 'hello', 'index.yaml']
  );
  expect(ok.status).toBe(200);
  expect(decoder.decode(ok.body as Uint8Array)).toEqual('title: hello');

  const wrongSha = await handler(
    request('GET', `blob/${'0'.repeat(40)}/blog/hello/index.yaml`, { cookie }),
    ['blob', '0'.repeat(40), 'blog', 'hello', 'index.yaml']
  );
  expect(wrongSha.status).toBe(404);

  // auth/ paths are rejected before the session is even checked
  const authPath = await handler(
    request('GET', `blob/${sha}/auth/native/admin@example.com.yaml`),
    ['blob', sha, 'auth', 'native', 'admin@example.com.yaml']
  );
  expect(authPath.status).toBe(400);
});

test('update requires a session, writes with sha metadata, deletes prefixes', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await bucket.put('blog/old/index.yaml', encoder.encode('title: old'));
  await bucket.put('blog/old/assets/img.png', encoder.encode('img'));
  await seedUser(db);
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  const body = {
    additions: [
      {
        path: 'blog/new/index.yaml',
        contents: base64UrlEncode(encoder.encode('title: new')),
      },
    ],
    deletions: [{ path: 'blog/old' }],
  };

  // anonymous → 401, nothing written
  const denied = await handler(request('POST', 'update', { body }), ['update']);
  expect(denied.status).toBe(401);
  expect(bucket.store.has('blog/new/index.yaml')).toBe(false);

  const cookie = await sessionCookie();
  const ok = await handler(
    request('POST', 'update', { body, cookie }),
    ['update']
  );
  expect(ok.status).toBe(200);
  expect(
    bucket.store.get('blog/new/index.yaml')!.customMetadata?.['drystack-blob-sha']
  ).toEqual(await blobSha(encoder.encode('title: new')));
  // directory-style deletion removed every nested key
  expect(bucket.store.has('blog/old/index.yaml')).toBe(false);
  expect(bucket.store.has('blog/old/assets/img.png')).toBe(false);
  // returned tree reflects the write
  const paths = (bodyJson(ok) as { path: string; type: string }[])
    .filter(e => e.type === 'blob')
    .map(e => e.path);
  expect(paths).toEqual(['blog/new/index.yaml']);

  // auth/ can never be written, even with a session
  const evil = await handler(
    request('POST', 'update', {
      body: {
        additions: [
          {
            path: 'auth/native/attacker@example.com.yaml',
            contents: base64UrlEncode(encoder.encode('{}')),
          },
        ],
        deletions: [],
      },
      cookie,
    }),
    ['update']
  );
  expect(evil.status).toBe(400);
  expect(bucket.store.has('auth/native/attacker@example.com.yaml')).toBe(false);
});

test('auth flow: status → setup (assigns SuperAdmin) → login → me → logout', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  // fresh database wants setup
  let res = await handler(request('GET', 'auth/status'), ['auth', 'status']);
  expect(bodyJson(res)).toEqual({ needsSetup: true, authenticated: false });

  // weak password rejected
  res = await handler(
    request('POST', 'auth/setup', {
      body: { email: 'admin@example.com', password: 'short' },
    }),
    ['auth', 'setup']
  );
  expect(res.status).toBe(400);

  // first admin created, session cookies set, SuperAdmin assigned
  res = await handler(
    request('POST', 'auth/setup', {
      body: { email: 'Admin@Example.com', password: 'hunter2-hunter2', name: 'Khan' },
    }),
    ['auth', 'setup']
  );
  expect(res.status).toBe(200);
  expect(bodyJson(res)).toEqual({ email: 'admin@example.com' });
  const setCookies = (res.headers as [string, string][])
    .filter(([k]) => k === 'Set-Cookie')
    .map(([, v]) => v);
  expect(setCookies.some(v => v.startsWith('drystack-session='))).toBe(true);
  expect(setCookies.some(v => v.startsWith('drystack-session-hint=1'))).toBe(
    true
  );
  // /register-first sets the password directly (no separate invite step to
  // verify against) - it must count as verified immediately, or the User
  // list page would show a nonsensical "Resend invite" button for the
  // SuperAdmin (caught by hand while testing against a real dev server).
  expect((await getUserByEmail(db, 'admin@example.com'))?.email_verify_at).toBeTruthy();
  expect(
    setCookies.find(v => v.startsWith('drystack-session='))
  ).toContain('HttpOnly');

  // setup is one-shot
  res = await handler(
    request('POST', 'auth/setup', {
      body: { email: 'other@example.com', password: 'hunter2-hunter2' },
    }),
    ['auth', 'setup']
  );
  expect(res.status).toBe(403);

  // login with wrong password and unknown user look identical
  res = await handler(
    request('POST', 'auth/login', {
      body: { email: 'admin@example.com', password: 'wrong-password' },
    }),
    ['auth', 'login']
  );
  expect(res.status).toBe(401);
  const unknown = await handler(
    request('POST', 'auth/login', {
      body: { email: 'ghost@example.com', password: 'wrong-password' },
    }),
    ['auth', 'login']
  );
  expect(unknown.status).toBe(401);
  expect(bodyJson(unknown)).toEqual(bodyJson(res));

  // correct login
  res = await handler(
    request('POST', 'auth/login', {
      body: { email: 'admin@example.com', password: 'hunter2-hunter2' },
    }),
    ['auth', 'login']
  );
  expect(res.status).toBe(200);
  expect(bodyJson(res)).toEqual({ email: 'admin@example.com' });

  // me with a valid cookie
  const cookie = await sessionCookie();
  res = await handler(request('GET', 'auth/me', { cookie }), ['auth', 'me']);
  expect(res.status).toBe(200);
  // SuperAdmin (assigned by setup above) has fullAccess - no need to list
  // permission strings individually (see permissions.ts's hardcode).
  expect(bodyJson(res)).toEqual({
    email: 'admin@example.com',
    name: 'Khan',
    avatar: null,
    permissions: [],
    fullAccess: true,
    isSuperAdmin: true,
  });
  // me without → 401
  res = await handler(request('GET', 'auth/me'), ['auth', 'me']);
  expect(res.status).toBe(401);

  // logout expires both cookies
  res = await handler(request('POST', 'auth/logout', { cookie }), [
    'auth',
    'logout',
  ]);
  const cleared = (res.headers as [string, string][])
    .filter(([k]) => k === 'Set-Cookie')
    .map(([, v]) => v);
  expect(cleared.some(v => v.startsWith('drystack-session=;'))).toBe(true);
  expect(cleared.some(v => v.startsWith('drystack-session-hint=;'))).toBe(true);
});

test('logout revokes the jti - the same still-unexpired token stops working everywhere', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await seedUser(db);
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);
  const cookie = await sessionCookie();

  // works before logout
  expect(
    (await handler(request('GET', 'auth/me', { cookie }), ['auth', 'me']))
      .status
  ).toBe(200);

  await handler(request('POST', 'auth/logout', { cookie }), [
    'auth',
    'logout',
  ]);
  // the revoked object exists under auth/revoked/<jti>
  expect((await listAllKeys(bucket)).some(k => k.startsWith('auth/revoked/'))).toBe(
    true
  );

  // the exact same (still cryptographically valid, unexpired) cookie is now
  // rejected everywhere a session is required
  expect(
    (await handler(request('GET', 'auth/me', { cookie }), ['auth', 'me']))
      .status
  ).toBe(401);
  const body = { additions: [], deletions: [] };
  expect(
    (
      await handler(request('POST', 'update', { body, cookie }), ['update'])
    ).status
  ).toBe(401);

  // status still correctly reports "not authenticated" for a revoked cookie
  const status = await handler(
    request('GET', 'auth/status', { cookie }),
    ['auth', 'status']
  );
  expect(bodyJson(status).authenticated).toBe(false);

  // logging back in mints a fresh token that works again
  const relogin = await handler(
    request('POST', 'auth/login', {
      body: { email: 'admin@example.com', password: 'hunter2-hunter2' },
    }),
    ['auth', 'login']
  );
  const freshCookie = (relogin.headers as [string, string][])
    .filter(([k]) => k === 'Set-Cookie')
    .map(([, v]) => v.split(';')[0])
    .join('; ');
  expect(
    (
      await handler(request('GET', 'auth/me', { cookie: freshCookie }), [
        'auth',
        'me',
      ])
    ).status
  ).toBe(200);
});

test('a real write bumps the content version, a no-op write does not', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await seedUser(db);
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);
  const cookie = await sessionCookie();

  const before = await getContentVersion(bucket);
  expect(before).toEqual('0');

  // no additions/deletions - the public-page cache has nothing to catch up
  // to, so this must not bump the version.
  await handler(
    request('POST', 'update', {
      body: { additions: [], deletions: [] },
      cookie,
    }),
    ['update']
  );
  expect(await getContentVersion(bucket)).toEqual(before);

  await handler(
    request('POST', 'update', {
      body: {
        additions: [
          {
            path: 'blog/hello/index.yaml',
            contents: base64UrlEncode(encoder.encode('title: hello')),
          },
        ],
        deletions: [],
      },
      cookie,
    }),
    ['update']
  );
  const after = await getContentVersion(bucket);
  expect(after).not.toEqual(before);

  // deletions alone also count as a real write
  await handler(
    request('POST', 'update', {
      body: { additions: [], deletions: [{ path: 'blog/hello' }] },
      cookie,
    }),
    ['update']
  );
  expect(await getContentVersion(bucket)).not.toEqual(after);
});

test('a deleted user immediately invalidates their existing session - not just via jti revocation', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const admin = await seedUser(db, 'admin@example.com');
  const second = await seedUser(db, 'second@example.com');
  const adminCookie = await sessionCookie('admin@example.com');
  const secondCookie = await sessionCookie('second@example.com');
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);
  void admin;

  // works before deletion
  expect(
    (
      await handler(request('GET', 'auth/me', { cookie: secondCookie }), [
        'auth',
        'me',
      ])
    ).status
  ).toBe(200);

  // simulate the account being removed (e.g. via scripts/drystack-auth.ts, or
  // the future user-management "Delete" button)
  await deleteUser(db, second.id);

  // the exact same cookie - still cryptographically valid, unexpired, and
  // never explicitly logged out (no revoked/<jti> entry) - is now rejected,
  // because verifiedSession() also checks the D1 user row still exists.
  expect(
    (
      await handler(request('GET', 'auth/me', { cookie: secondCookie }), [
        'auth',
        'me',
      ])
    ).status
  ).toBe(401);
  expect(
    (
      await handler(
        request('POST', 'update', {
          body: { additions: [], deletions: [] },
          cookie: secondCookie,
        }),
        ['update']
      )
    ).status
  ).toBe(401);

  // the admin's own session is unaffected
  expect(
    (
      await handler(request('GET', 'auth/me', { cookie: adminCookie }), [
        'auth',
        'me',
      ])
    ).status
  ).toBe(200);
});

test('deactivating a user (active = 0) invalidates their session immediately', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const user = await seedUser(db);
  const cookie = await sessionCookie();
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  expect(
    (await handler(request('GET', 'auth/me', { cookie }), ['auth', 'me']))
      .status
  ).toBe(200);

  await setUserActive(db, user.id, false);
  expect(
    (await handler(request('GET', 'auth/me', { cookie }), ['auth', 'me']))
      .status
  ).toBe(401);

  // a deactivated user also can't log back in
  const login = await handler(
    request('POST', 'auth/login', {
      body: { email: 'admin@example.com', password: 'hunter2-hunter2' },
    }),
    ['auth', 'login']
  );
  expect(login.status).toBe(401);

  await setUserActive(db, user.id, true);
  expect(
    (await handler(request('GET', 'auth/me', { cookie }), ['auth', 'me']))
      .status
  ).toBe(200);
});

// ---------------------------------------------------------------------------
// Permission enforcement (plan/user-managent.md mục 5)
// ---------------------------------------------------------------------------

test('a role with only collection:blog.view can read but not write', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await bucket.put('blog/hello/index.yaml', encoder.encode('title: hello'));
  const viewer = await createRole(db, 'Viewer');
  await updateRolePermissions(db, viewer.id, ['collection:blog.view']);
  await seedUser(db, 'viewer@example.com', { role: 'Viewer' });
  const cookie = await sessionCookie('viewer@example.com');
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  const tree = await handler(request('GET', 'tree', { cookie }), ['tree']);
  expect(tree.status).toBe(200);
  expect(
    (bodyJson(tree) as { path: string }[]).map(e => e.path)
  ).toContain('blog/hello/index.yaml');

  const sha = await blobSha(encoder.encode('title: hello'));
  const blob = await handler(
    request('GET', `blob/${sha}/blog/hello/index.yaml`, { cookie }),
    ['blob', sha, 'blog', 'hello', 'index.yaml']
  );
  expect(blob.status).toBe(200);

  const write = await handler(
    request('POST', 'update', {
      body: {
        additions: [
          {
            path: 'blog/new/index.yaml',
            contents: base64UrlEncode(encoder.encode('title: new')),
          },
        ],
        deletions: [],
      },
      cookie,
    }),
    ['update']
  );
  expect(write.status).toBe(403);
  expect(bucket.store.has('blog/new/index.yaml')).toBe(false);
});

test('a role without collection:blog.view never sees blog/ in tree or blob, but unowned paths stay visible', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await bucket.put('blog/hello/index.yaml', encoder.encode('title: hello'));
  await bucket.put('assets/pic.png', encoder.encode('png-bytes'));
  await createRole(db, 'NoAccess'); // permissions stay '[]'
  await seedUser(db, 'noaccess@example.com', { role: 'NoAccess' });
  const cookie = await sessionCookie('noaccess@example.com');
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  const tree = await handler(request('GET', 'tree', { cookie }), ['tree']);
  expect(tree.status).toBe(200);
  const paths = (bodyJson(tree) as { path: string }[]).map(e => e.path);
  expect(paths).not.toContain('blog/hello/index.yaml');
  expect(paths).toContain('assets/pic.png');

  const sha = await blobSha(encoder.encode('title: hello'));
  const blob = await handler(
    request('GET', `blob/${sha}/blog/hello/index.yaml`, { cookie }),
    ['blob', sha, 'blog', 'hello', 'index.yaml']
  );
  expect(blob.status).toBe(403);
});

test('created vs updated are distinct permissions - each only unlocks its own case', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await bucket.put('blog/existing/index.yaml', encoder.encode('title: existing'));

  const creator = await createRole(db, 'Creator');
  await updateRolePermissions(db, creator.id, [
    'collection:blog.view',
    'collection:blog.created',
  ]);
  await seedUser(db, 'creator@example.com', { role: 'Creator' });
  const creatorCookie = await sessionCookie('creator@example.com');
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  // Creator can add a new file...
  const createNew = await handler(
    request('POST', 'update', {
      body: {
        additions: [
          {
            path: 'blog/new/index.yaml',
            contents: base64UrlEncode(encoder.encode('title: new')),
          },
        ],
        deletions: [],
      },
      cookie: creatorCookie,
    }),
    ['update']
  );
  expect(createNew.status).toBe(200);

  // ...but not overwrite an existing one (that's `updated`, which Creator
  // doesn't have).
  const editExisting = await handler(
    request('POST', 'update', {
      body: {
        additions: [
          {
            path: 'blog/existing/index.yaml',
            contents: base64UrlEncode(encoder.encode('title: changed')),
          },
        ],
        deletions: [],
      },
      cookie: creatorCookie,
    }),
    ['update']
  );
  expect(editExisting.status).toBe(403);
  expect(decoder.decode(bucket.store.get('blog/existing/index.yaml')!.contents)).toEqual(
    'title: existing'
  );
});

test('deleted permission gates deletions independently of created/updated', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await bucket.put('blog/existing/index.yaml', encoder.encode('title: existing'));

  const editor = await createRole(db, 'EditOnly');
  await updateRolePermissions(db, editor.id, [
    'collection:blog.view',
    'collection:blog.updated',
  ]);
  await seedUser(db, 'editor@example.com', { role: 'EditOnly' });
  const cookie = await sessionCookie('editor@example.com');
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  const del = await handler(
    request('POST', 'update', {
      body: { additions: [], deletions: [{ path: 'blog/existing' }] },
      cookie,
    }),
    ['update']
  );
  expect(del.status).toBe(403);
  expect(bucket.store.has('blog/existing/index.yaml')).toBe(true);
});

test('Admin has full access without any stored permissions, but SuperAdmin-only actions stay app-level (not tested here)', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await bucket.put('blog/existing/index.yaml', encoder.encode('title: existing'));
  await seedUser(db, 'admin2@example.com', { role: 'Admin' });
  const cookie = await sessionCookie('admin2@example.com');
  const handler = r2ModeApiHandler(testConfig, bucket, db, SECRET);

  const write = await handler(
    request('POST', 'update', {
      body: {
        additions: [
          {
            path: 'blog/new/index.yaml',
            contents: base64UrlEncode(encoder.encode('title: new')),
          },
        ],
        deletions: [{ path: 'blog/existing' }],
      },
      cookie,
    }),
    ['update']
  );
  expect(write.status).toBe(200);
});
