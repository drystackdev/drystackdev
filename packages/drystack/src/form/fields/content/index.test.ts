/** @jest-environment node */
import { expect, test } from "@jest/globals";
import { fields } from "../../api";

// The parse()/serialize() branches also touch getSchema(), which resolves
// through #field-ui/content to the client editor bundle - unavailable in this
// node test environment (same limitation form-value-to-ai.test.ts works
// around by mocking serialize()). What's covered here - contentExtension and
// reader.parse - is the pure logic this file actually changed, and is also
// what reader/generic.ts and useItemData.ts key their file-vs-inline reads on.

test("default field writes its body to a separate .html file", () => {
  const field = fields.content({ label: "Nội dung" });
  expect(field.contentExtension).toBe(".html");
});

test("inline: true keeps the body in the entry's own YAML", () => {
  const field = fields.content({ label: "Nội dung", inline: true });
  expect(field.contentExtension).toBeUndefined();
});

test("reader.parse decodes the separate file's bytes when not inline", () => {
  const field = fields.content({ label: "Nội dung" });
  const html = "<p>Xin chào</p>";
  expect(
    field.reader.parse(undefined, { content: new TextEncoder().encode(html) }),
  ).toBe(html);
});

test("reader.parse falls back to '' when the separate file is missing", () => {
  const field = fields.content({ label: "Nội dung" });
  expect(field.reader.parse(undefined, { content: undefined })).toBe("");
});

test("inline reader.parse reads straight from the YAML value", () => {
  const field = fields.content({ label: "Nội dung", inline: true });
  const html = "<p>Xin chào</p>";
  expect(field.reader.parse(html)).toBe(html);
  expect(field.reader.parse(html, undefined)).toBe(html);
});

test("inline reader.parse falls back to '' for an unset value", () => {
  const field = fields.content({ label: "Nội dung", inline: true });
  expect(field.reader.parse(undefined)).toBe("");
});

test("inline: true drops 'p' from the AI codec's allowed tags", () => {
  const field = fields.content({ label: "Nội dung", inline: true });
  expect(field.aiMeta?.htmlTags).not.toContain("p");
});

test("default field still advertises 'p' to the AI codec", () => {
  const field = fields.content({ label: "Nội dung" });
  expect(field.aiMeta?.htmlTags).toContain("p");
});
