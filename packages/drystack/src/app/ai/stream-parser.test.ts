/** @jest-environment node */
import { expect, test } from '@jest/globals';

import { AiStreamParser, AiStreamEvent } from './stream-parser';

function runParser(keys: string[], chunks: string[]) {
  const events: AiStreamEvent[] = [];
  const parser = new AiStreamParser(keys, e => events.push(e));
  for (const chunk of chunks) parser.write(chunk);
  parser.end();
  return events;
}

function doneValues(events: AiStreamEvent[]) {
  return Object.fromEntries(
    events
      .filter(e => e.type === 'field-done')
      .map(e => [(e as any).key, (e as any).raw])
  );
}

test('reads a one-line scalar', () => {
  const events = runParser(['keywords'], ['keywords: seo onpage, core web vitals\n']);
  expect(doneValues(events)).toEqual({
    keywords: 'seo onpage, core web vitals',
  });
});

test('reads a block scalar and strips its indentation', () => {
  const events = runParser(
    ['excerpt'],
    ['excerpt: |\n  Dòng một.\n  Dòng hai.\n']
  );
  expect(doneValues(events)).toEqual({ excerpt: 'Dòng một.\nDòng hai.' });
});

test('keeps HTML indentation inside a block scalar', () => {
  const events = runParser(
    ['body'],
    ['body: |\n  <h2>Tiêu đề</h2>\n  <ul>\n    <li>Mục</li>\n  </ul>\n']
  );
  expect(doneValues(events).body).toBe(
    '<h2>Tiêu đề</h2>\n<ul>\n  <li>Mục</li>\n</ul>'
  );
});

// The whole design rests on this: a field is only known to be finished
// because the next one starts.
test('closes a field when the next top-level key begins', () => {
  const events = runParser(
    ['title', 'keywords'],
    ['title: Bài viết\nkeywords: seo\n']
  );
  expect(doneValues(events)).toEqual({ title: 'Bài viết', keywords: 'seo' });
});

test('splits arbitrarily across chunks', () => {
  // One character at a time — the worst case a token stream can produce.
  const yaml = 'title: Hướng dẫn SEO\nexcerpt: |\n  Mô tả ngắn.\n';
  const events = runParser(['title', 'excerpt'], [...yaml]);
  expect(doneValues(events)).toEqual({
    title: 'Hướng dẫn SEO',
    excerpt: 'Mô tả ngắn.',
  });
});

test('emits growing text for scalars only', () => {
  const events = runParser(['excerpt'], ['excerpt: |\n  Một\n  Hai\n']);
  const progress = events
    .filter(e => e.type === 'field-progress')
    .map(e => (e as any).text);
  expect(progress[progress.length - 1]).toBe('Một\nHai');
});

// A chunk boundary mid-line must not blank out the lines already shown: each
// progress event carries the whole value so far, never just the new tail.
test('keeps earlier lines while a block-scalar line is still partial', () => {
  const events = runParser(['excerpt'], ['excerpt: |\n  Một\n  Ha']);
  const progress = events
    .filter(e => e.type === 'field-progress')
    .map(e => (e as any).text);
  expect(progress[progress.length - 1]).toBe('Một\nHa');
});

test('progress never shrinks as chunks arrive', () => {
  const yaml = 'body: |\n  <h2>Tiêu đề</h2>\n  <p>Đoạn văn dài hơn.</p>\n';
  const events = runParser(['body'], [...yaml]);
  const progress = events
    .filter(e => e.type === 'field-progress')
    .map(e => (e as any).text);
  for (let i = 1; i < progress.length; i++) {
    expect(progress[i].length).toBeGreaterThanOrEqual(progress[i - 1].length);
  }
});

test('parses an array of scalars as one block', () => {
  const events = runParser(['tags'], ['tags:\n  - seo\n  - onpage\n']);
  expect(doneValues(events)).toEqual({ tags: ['seo', 'onpage'] });
});

test('parses an array of objects as one block', () => {
  const events = runParser(
    ['process'],
    [
      'process:\n',
      '  - step: Khảo sát\n',
      '    desc: |\n',
      '      Phân tích hiện trạng.\n',
      '  - step: Lập kế hoạch\n',
      '    desc: |\n',
      '      Lộ trình 6 tháng.\n',
    ]
  );
  expect(doneValues(events)).toEqual({
    process: [
      { step: 'Khảo sát', desc: 'Phân tích hiện trạng.\n' },
      { step: 'Lập kế hoạch', desc: 'Lộ trình 6 tháng.\n' },
    ],
  });
});

// A nested `desc:` sits at an indent, so it must not be mistaken for a
// top-level key — doing so would truncate the array mid-build.
test('ignores nested keys that share a name with a target', () => {
  const events = runParser(
    ['process', 'desc'],
    ['process:\n  - step: Một\n    desc: Nested\ndesc: Top level\n']
  );
  expect(doneValues(events)).toEqual({
    process: [{ step: 'Một', desc: 'Nested' }],
    desc: 'Top level',
  });
});

test('ignores keys that were never requested', () => {
  const events = runParser(['title'], ['title: Giữ\nrandom: Bỏ qua\n']);
  expect(doneValues(events)).toEqual({ title: 'Giữ\nrandom: Bỏ qua' });
});

test('absorbs a code fence the model added', () => {
  const events = runParser(
    ['title'],
    ['```yaml\ntitle: Hướng dẫn SEO\n```\n']
  );
  expect(doneValues(events)).toEqual({ title: 'Hướng dẫn SEO' });
});

// One malformed block must not discard the fields around it.
test('reports a bad block without losing other fields', () => {
  const events = runParser(
    ['tags', 'title'],
    ['tags:\n  - "unclosed\n   bad: [\n title: Vẫn giữ\n']
  );
  expect(events.some(e => e.type === 'error')).toBe(true);
});

test('closes the last field at end of stream', () => {
  const events = runParser(['title'], ['title: Không có newline cuối']);
  expect(doneValues(events)).toEqual({ title: 'Không có newline cuối' });
});
