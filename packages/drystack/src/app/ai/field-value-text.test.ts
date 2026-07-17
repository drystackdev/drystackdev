/** @jest-environment node */
import { expect, test } from '@jest/globals';

import { fields } from '../../form/api';
import { isFieldEmpty, fieldToContextText } from './field-value-text';

test('a blank text field is empty', () => {
  expect(isFieldEmpty(fields.text({ label: 'T' }), '')).toBe(true);
  expect(isFieldEmpty(fields.text({ label: 'T' }), '   ')).toBe(true);
});

test('a written text field is not empty', () => {
  expect(isFieldEmpty(fields.text({ label: 'T' }), 'Nội dung')).toBe(false);
});

// The point of the whole helper: `!value` would call these blank and let the
// AI overwrite a real choice.
test('false and 0 are values, not blanks', () => {
  expect(
    isFieldEmpty(fields.checkbox({ label: 'Xuất bản', defaultValue: false }), false)
  ).toBe(false);
  expect(isFieldEmpty(fields.integer({ label: 'Số' }), 0)).toBe(false);
});

// A `publish` checkbox at its default must not land in the fill column, or a
// single click would hand the model the decision to put a post live.
test('a checkbox at its default stays out of the fill column', () => {
  const publish = fields.checkbox({ label: 'Xuất bản', defaultValue: false });
  expect(isFieldEmpty(publish, false)).toBe(false);
});

test('an empty array is empty, a filled one is not', () => {
  const tags = fields.array(fields.text({ label: 'Tag' }), { label: 'Tags' });
  expect(isFieldEmpty(tags, [])).toBe(true);
  expect(isFieldEmpty(tags, ['seo'])).toBe(false);
});

test('a slug pair is empty when its name half is', () => {
  const title = fields.slug({ name: { label: 'Tiêu đề' } });
  expect(isFieldEmpty(title, { name: '', slug: '' })).toBe(true);
  expect(isFieldEmpty(title, { name: 'Bài viết', slug: 'bai-viet' })).toBe(false);
});

test('flattens values into prompt context text', () => {
  expect(fieldToContextText(fields.text({ label: 'T' }), 'Xin chào')).toBe('Xin chào');
  expect(
    fieldToContextText(fields.slug({ name: { label: 'T' } }), {
      name: 'Bài viết',
      slug: 'bai-viet',
    })
  ).toBe('Bài viết');
  expect(
    fieldToContextText(
      fields.array(fields.text({ label: 'Tag' }), { label: 'Tags' }),
      ['seo', 'onpage']
    )
  ).toBe('seo; onpage');
});
