/** @jest-environment node */
import { expect, test } from '@jest/globals';
import { collection, fields } from '..';
import { Config } from '../config';
import { R2BucketLike, R2ObjectMetaLike } from '../api/api-r2';
import { createR2Reader } from './r2';

const encoder = new TextEncoder();

const testConfig = {
  storage: { kind: 'r2' },
  collections: {
    blog: collection({
      label: 'Blog',
      slugField: 'title',
      path: 'blog/*/',
      schema: {
        title: fields.slug({ name: { label: 'Title' } }),
        excerpt: fields.text({ label: 'Excerpt' }),
      },
    }),
  },
} as unknown as Config;

class MemoryBucket implements R2BucketLike {
  store = new Map<string, Uint8Array>();
  set(key: string, contents: string) {
    this.store.set(key, encoder.encode(contents));
  }
  async get(key: string) {
    const contents = this.store.get(key);
    if (!contents) return null;
    return {
      key,
      size: contents.byteLength,
      arrayBuffer: async () =>
        contents.buffer.slice(
          contents.byteOffset,
          contents.byteOffset + contents.byteLength
        ) as ArrayBuffer,
    };
  }
  async head(key: string) {
    const contents = this.store.get(key);
    if (!contents) return null;
    return { key, size: contents.byteLength };
  }
  async put(key: string, value: Uint8Array | ArrayBuffer) {
    this.store.set(
      key,
      value instanceof Uint8Array ? new Uint8Array(value) : new Uint8Array(value)
    );
  }
  async delete(keys: string | string[]) {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      this.store.delete(key);
    }
  }
  async list(options?: { prefix?: string }) {
    const objects: R2ObjectMetaLike[] = [...this.store.entries()]
      .filter(([key]) => !options?.prefix || key.startsWith(options.prefix))
      .map(([key, contents]) => ({ key, size: contents.byteLength }));
    return { objects, truncated: false as const };
  }
}

test('reads a single entry by slug', async () => {
  const bucket = new MemoryBucket();
  bucket.set(
    'blog/hello-world/index.yaml',
    'title: Hello World\nexcerpt: A first post\n'
  );
  const reader = createR2Reader(testConfig, bucket);

  const entry = await reader.collections.blog.read('hello-world');
  expect(entry?.title).toEqual('Hello World');
  expect(entry?.excerpt).toEqual('A first post');

  expect(await reader.collections.blog.read('does-not-exist')).toBeNull();
});

test('list() lists slugs via readdir, unaffected by unrelated bucket keys', async () => {
  const bucket = new MemoryBucket();
  bucket.set('blog/hello-world/index.yaml', 'title: Hello World\nexcerpt: A\n');
  bucket.set('blog/second-post/index.yaml', 'title: Second\nexcerpt: B\n');
  // a nested asset under an entry directory shouldn't be mistaken for a slug
  bucket.set('blog/hello-world/assets/cover.png', 'not-a-real-image');
  // objects outside the collection's own prefix are ignored
  bucket.set('assets/unrelated.png', 'x');
  bucket.set('auth/native/admin@example.com.json', '{}');

  const reader = createR2Reader(testConfig, bucket);
  const slugs = await reader.collections.blog.list();
  expect([...slugs].sort()).toEqual(['hello-world', 'second-post']);
});

test('all() reads every entry', async () => {
  const bucket = new MemoryBucket();
  bucket.set('blog/hello-world/index.yaml', 'title: Hello World\nexcerpt: A\n');
  bucket.set('blog/second-post/index.yaml', 'title: Second\nexcerpt: B\n');

  const reader = createR2Reader(testConfig, bucket);
  const all = await reader.collections.blog.all();
  expect(all.map(x => x.slug).sort()).toEqual(['hello-world', 'second-post']);
  expect(all.find(x => x.slug === 'second-post')?.entry.title).toEqual(
    'Second'
  );
});
