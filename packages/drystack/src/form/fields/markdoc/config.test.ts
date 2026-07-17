/** @jest-environment node */
import { expect, test } from "@jest/globals";
import { editorOptionsToConfig } from "./config";

test("inlineOnly forces every block-level flag off regardless of options", () => {
  const config = editorOptionsToConfig(
    {
      heading: true,
      blockquote: true,
      orderedList: true,
      unorderedList: true,
      table: true,
      grid: true,
      image: true,
      divider: true,
      codeBlock: true,
    },
    true,
    true,
  );
  expect(config.inlineOnly).toBe(true);
  expect(config.heading.levels).toEqual([]);
  expect(config.blockquote).toBe(false);
  expect(config.orderedList).toBe(false);
  expect(config.unorderedList).toBe(false);
  expect(config.table).toBe(false);
  expect(config.grid).toBe(false);
  expect(config.image).toBeUndefined();
  expect(config.divider).toBe(false);
  expect(config.codeBlock).toBeUndefined();
});

test("inlineOnly leaves mark flags driven by options, not forced", () => {
  const config = editorOptionsToConfig(
    { italic: false, link: true },
    true,
    true,
  );
  expect(config.bold).toBe(true);
  expect(config.italic).toBe(false);
  expect(config.link).toBe(true);
});

test("inlineOnly defaults to false and leaves block content untouched", () => {
  const config = editorOptionsToConfig({ heading: true }, true);
  expect(config.inlineOnly).toBe(false);
  expect(config.heading.levels).toEqual([1, 2, 3, 4, 5, 6]);
  expect(config.blockquote).toBe(true);
  expect(config.table).toBe(true);
});
