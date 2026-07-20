/** @jest-environment node */
import { expect, test } from "@jest/globals";

import { fields } from "../../form/api";
import {
  buildSystemPrompt,
  buildUserPrompt,
  generateMaxTokens,
  SIZE_SPECS,
} from "./prompt";
import { describeField, describeFields } from "./schema-to-yaml";

const schema = {
  title: fields.slug({ name: { label: "Tiêu đề" } }),
  body: fields.content({ label: "Nội dung", options: { heading: [2, 3] } }),
  summary: fields.content({ label: "Tóm tắt", options: { heading: [2] } }),
};
const targets = describeFields(schema);

const system = (sizes: Record<string, any>, seedKeys?: string[]) =>
  buildSystemPrompt({
    lang: "vi-VN",
    entryDescription: "bài viết blog",
    targets,
    sizes,
    seedKeys,
  });

test("states each content field's length on its own line", () => {
  const prompt = system({ body: "xlong", summary: "short" });
  expect(prompt).toContain(`độ dài: ${SIZE_SPECS.xlong.words}`);
  expect(prompt).toContain(`độ dài: ${SIZE_SPECS.short.words}`);
  // The skeleton line, not a rule: two content fields at different lengths
  // cannot both be right in one global sentence.
  expect(prompt).toContain(
    `body (HTML, chỉ dùng các thẻ: ${describeField("body", schema.body)!.htmlTags!.join(", ")}, độ dài: ${SIZE_SPECS.xlong.words}): Nội dung`,
  );
});

test("states the table-structure rule when a content field advertises tables", () => {
  // `body`/`summary` are plain content fields, so table support is on by
  // default (see editorOptionsToConfig) and the tags are advertised.
  const prompt = system({ body: "medium", summary: "short" });
  expect(prompt).toContain("Với field cho phép thẻ <table>");
});

test("omits the table rule when every content field turns tables off", () => {
  const noTableTargets = describeFields({
    body: fields.content({ label: "Nội dung", options: { table: false } }),
  });
  const prompt = buildSystemPrompt({
    lang: "vi-VN",
    entryDescription: "bài viết blog",
    targets: noTableTargets,
    sizes: { body: "medium" },
  });
  expect(prompt).not.toContain("Với field cho phép thẻ <table>");
  // the field is still a content field - just one whose tag list has no table
  expect(prompt).toContain("chỉ dùng các thẻ:");
});

test("does not put a length on a field that is not content", () => {
  const prompt = system({ body: "medium" });
  const titleLine = prompt
    .split("\n")
    .find((l) => l.startsWith("title ("))!;
  expect(titleLine).not.toContain("độ dài");
});

test("the seed rule appears only when there is a seed", () => {
  expect(system({ body: "medium" })).not.toContain("ĐANG CÓ DỞ");
  const withSeed = system({ body: "medium" }, ["specs"]);
  expect(withSeed).toContain("ĐANG CÓ DỞ");
  expect(withSeed).toContain("NGUYÊN VĂN");
  expect(withSeed).toContain("specs");
});

test("renders the seed block under its key, indented as YAML", () => {
  const user = buildUserPrompt({
    context: { title: "Đánh giá điện thoại X" },
    description: "Điền thông số từ bài viết",
    seeds: {
      specs: "- key: Thời lượng pin\n  value: ''\n- key: Màn hình\n  value: ''",
    },
  });
  expect(user).toContain(
    [
      "ĐANG CÓ DỞ (giữ nguyên phần đã có, điền nốt chỗ trống, xuất lại đầy đủ):",
      "specs:",
      "  - key: Thời lượng pin",
      "    value: ''",
      "  - key: Màn hình",
      "    value: ''",
    ].join("\n"),
  );
});

// Context and seeds carry opposite instructions - one must not be echoed, the
// other must be - so they must never merge into one block.
test("keeps the seed block separate from the context block", () => {
  const user = buildUserPrompt({
    context: { title: "Đánh giá điện thoại X" },
    description: "",
    seeds: { specs: "- key: Pin\n  value: ''" },
  });
  expect(user.indexOf("NGỮ CẢNH")).toBeLessThan(user.indexOf("ĐANG CÓ DỞ"));
  expect(user).toContain("đừng xuất lại");
});

test("an empty seed map adds no block", () => {
  const user = buildUserPrompt({ context: {}, description: "x", seeds: {} });
  expect(user).not.toContain("ĐANG CÓ DỞ");
});

test("sums the ceiling across content targets", () => {
  expect(generateMaxTokens({ sizes: { a: "short", b: "short" } })).toBe(
    SIZE_SPECS.short.maxTokens * 2,
  );
});

// Seeds are echoed back verbatim, so what is handed in is paid for again on
// the way out.
test("pays for seed text that has to be reproduced", () => {
  const base = generateMaxTokens({ sizes: { a: "short" } });
  expect(generateMaxTokens({ sizes: { a: "short" }, seedChars: 1000 })).toBe(
    base + 500,
  );
});

// The cap is the point: 16k is today's worst case and as much as the tightest
// provider accepts. Two long fields should be truncated, never rejected.
test("caps at what the tightest provider will accept", () => {
  expect(generateMaxTokens({ sizes: { a: "xlong", b: "xlong" } })).toBe(16_000);
  expect(
    generateMaxTokens({ sizes: { a: "xlong" }, seedChars: 100_000 }),
  ).toBe(16_000);
});

// A request that fills only scalars still has to fit them.
test("a request with no content field still gets a floor", () => {
  expect(generateMaxTokens({ sizes: {} })).toBe(2_000);
});
