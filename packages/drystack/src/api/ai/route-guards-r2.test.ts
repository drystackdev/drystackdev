/** @jest-environment node */
import { expect, test } from '@jest/globals';
import { fields } from '../../form/api';
import type { DrystackRequest } from '../internal-utils';
import { makeAiRouteHandler } from './index';
import { signSession } from '../native-auth';
import { createRole, createUser, getRoleByName, assignRole, updateRolePermissions } from '../d1';
import { makeTestD1 } from '../d1-test-helpers';
import { SUPER_ADMIN_ROLE } from '../permissions';
import type { R2BucketLike, R2ObjectMetaLike } from '../api-r2';

// r2 mode's ai/generate + ai/rewrite guards (plan/user-managent.md mục 5):
// on top of "is there any session" (already covered by generic.ts's
// requireNativeSession before this handler is even reached), preflight now
// also checks the session's roles for `collection:<key>.magicWriter` /
// `singleton:<key>.magicWriter`.

const SECRET = 's'.repeat(32);

class MemoryBucket implements R2BucketLike {
  store = new Map<string, { contents: Uint8Array; customMetadata?: Record<string, string> }>();
  async get(key: string) {
    const entry = this.store.get(key);
    if (!entry) return null;
    return {
      key,
      size: entry.contents.byteLength,
      customMetadata: entry.customMetadata,
      arrayBuffer: async () => entry.contents.buffer as ArrayBuffer,
    };
  }
  async head(key: string) {
    const entry = this.store.get(key);
    return entry ? { key, size: entry.contents.byteLength, customMetadata: entry.customMetadata } : null;
  }
  async put(key: string, value: Uint8Array | ArrayBuffer, options?: { customMetadata?: Record<string, string> }) {
    this.store.set(key, {
      contents: value instanceof Uint8Array ? value : new Uint8Array(value),
      customMetadata: options?.customMetadata,
    });
  }
  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) this.store.delete(key);
  }
  async list(options?: { prefix?: string }) {
    const objects: R2ObjectMetaLike[] = [...this.store.entries()]
      .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
      .map(([key, entry]) => ({ key, size: entry.contents.byteLength, customMetadata: entry.customMetadata }));
    return { objects, truncated: false as const };
  }
}

const schema = {
  title: fields.slug({ name: { label: 'Tiêu đề' } }),
  body: fields.content({ label: 'Nội dung' }),
};

const config = {
  storage: { kind: 'r2' },
  ai: { lang: 'vi-VN', for: { blog: 'một bài blog' } },
  collections: { blog: { label: 'Blog', schema } },
} as any;

const env = {
  DRY_AI_PROVIDER: 'anthropic',
  DRY_AI_KEY: 'sk-test',
  DRY_AI_MODEL: 'claude-sonnet-5',
};

function request(body: unknown, cookie?: string): DrystackRequest {
  return {
    method: 'POST',
    url: 'http://localhost/api/drystack/ai/rewrite',
    headers: { get: (name: string) => (name === 'cookie' ? (cookie ?? null) : null) },
    json: async () => body,
  };
}

const rewriteBody = {
  entry: { kind: 'collection', key: 'blog' },
  field: 'body',
  selection: '<p>Đoạn gốc.</p>',
  description: 'ngắn hơn',
};

async function seedUser(db: ReturnType<typeof makeTestD1>, email: string, roleName: string) {
  const user = await createUser(db, { email, name: 'Tester', password: 'irrelevant-not-checked-here' });
  const role = await getRoleByName(db, roleName);
  if (role) await assignRole(db, user.id, role.id);
  return user;
}

test('r2 mode rejects with no session, before touching config', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const handler = makeAiRouteHandler({ config, env, r2Bucket: bucket, d1Database: db, secret: SECRET })!;
  const res = await handler(request(rewriteBody), 'ai/rewrite'.split('/'));
  expect(res.status).toBe(401);
});

test('r2 mode: a role without magicWriter on the collection is refused', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const viewer = await createRole(db, 'Viewer');
  await updateRolePermissions(db, viewer.id, ['collection:blog.view']);
  await seedUser(db, 'viewer@example.com', 'Viewer');
  const cookie = `drystack-session=${await signSession({ email: 'viewer@example.com' }, SECRET)}`;
  const handler = makeAiRouteHandler({ config, env, r2Bucket: bucket, d1Database: db, secret: SECRET })!;

  const res = await handler(request(rewriteBody, cookie), 'ai/rewrite'.split('/'));
  expect(res.status).toBe(403);
});

test('r2 mode: a role with magicWriter on the collection clears the guard', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const writer = await createRole(db, 'Writer');
  await updateRolePermissions(db, writer.id, ['collection:blog.view', 'collection:blog.magicWriter']);
  await seedUser(db, 'writer@example.com', 'Writer');
  const cookie = `drystack-session=${await signSession({ email: 'writer@example.com' }, SECRET)}`;
  const handler = makeAiRouteHandler({ config, env, r2Bucket: bucket, d1Database: db, secret: SECRET })!;

  // `field: 'title'` isn't a content field, so a request that cleared the
  // magicWriter guard (no 401/403) still 400s at the *next* check, past
  // preflight - without ever reaching a real provider call. Same trick
  // route-guards.test.ts uses for github mode's session guard.
  const res = await handler(
    request({ ...rewriteBody, field: 'title' }, cookie),
    'ai/rewrite'.split('/'),
  );
  expect(res.status).toBe(400);
});

test('r2 mode: magicWriter on a *different* collection does not leak permission', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  const config2 = {
    ...config,
    ai: { lang: 'vi-VN', for: { blog: 'một bài blog', docs: 'tài liệu' } },
    collections: { ...config.collections, docs: { label: 'Docs', schema } },
  };
  const role = await createRole(db, 'DocsWriter');
  await updateRolePermissions(db, role.id, ['collection:docs.view', 'collection:docs.magicWriter']);
  await seedUser(db, 'docs@example.com', 'DocsWriter');
  const cookie = `drystack-session=${await signSession({ email: 'docs@example.com' }, SECRET)}`;
  const handler = makeAiRouteHandler({ config: config2, env, r2Bucket: bucket, d1Database: db, secret: SECRET })!;

  const res = await handler(request(rewriteBody, cookie), 'ai/rewrite'.split('/'));
  expect(res.status).toBe(403);
});

test('r2 mode: SuperAdmin/Admin clear the guard without any stored permission', async () => {
  const bucket = new MemoryBucket();
  const db = makeTestD1();
  await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const cookie = `drystack-session=${await signSession({ email: 'admin@example.com' }, SECRET)}`;
  const handler = makeAiRouteHandler({ config, env, r2Bucket: bucket, d1Database: db, secret: SECRET })!;

  const res = await handler(
    request({ ...rewriteBody, field: 'title' }, cookie),
    'ai/rewrite'.split('/'),
  );
  expect(res.status).toBe(400);
});
