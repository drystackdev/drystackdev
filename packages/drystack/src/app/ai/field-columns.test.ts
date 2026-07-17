/** @jest-environment node */
import { expect, test } from "@jest/globals";

import { fields } from "../../form/api";
import { describeField, describeFields } from "../../api/ai/schema-to-yaml";
import {
  canContinue,
  canPickSize,
  configControlFor,
  initialSelection,
  isContinuableKind,
} from "./field-columns";

const schema = {
  title: fields.slug({ name: { label: "Tiêu đề" } }),
  excerpt: fields.text({ label: "Mô tả ngắn" }),
  body: fields.content({ label: "Nội dung", options: { heading: [2, 3] } }),
  specs: fields.array(
    fields.object({
      key: fields.text({ label: "Tên thông số" }),
      value: fields.text({ label: "Giá trị" }),
    }),
    { label: "Thông số" },
  ),
};

const allSpecs = describeFields(schema);
const specFor = (key: keyof typeof schema) =>
  allSpecs.find((s) => s.key === key)!;

const blank = {
  title: { name: "", slug: "" },
  excerpt: "",
  body: undefined,
  specs: [],
};

// The shape the whole "tiếp tục" feature exists for: the keys are typed, the
// values aren't, and the AI is meant to fill the values from the article.
const halfWritten = {
  title: { name: "Đánh giá điện thoại X", slug: "danh-gia-dien-thoai-x" },
  excerpt: "Bài đánh giá chi tiết",
  body: undefined,
  specs: [
    { key: "Thời lượng pin", value: "" },
    { key: "Màn hình", value: "" },
  ],
};

test("a fresh entry puts everything in the fill column", () => {
  const selection = initialSelection({ specs: allSpecs, schema, state: blank });
  expect(selection).toEqual({
    title: "fill",
    excerpt: "fill",
    body: "fill",
    specs: "fill",
  });
});

test("a written field becomes context, a blank one stays a target", () => {
  const selection = initialSelection({
    specs: allSpecs,
    schema,
    state: { ...halfWritten, excerpt: "" },
  });
  expect(selection.title).toBe("context");
  expect(selection.excerpt).toBe("fill");
});

// The expensive one. A written body is the largest thing that could go into a
// prompt and rarely what makes the difference, so it is offered, never assumed.
test("a written content field defaults to neither column", () => {
  const selection = initialSelection({
    specs: allSpecs,
    schema,
    state: { ...halfWritten, body: { doc: { textContent: "Bài viết dài..." } } },
  });
  expect(selection.body).toBe("none");
  // Not at the cost of the cheap fields around it.
  expect(selection.title).toBe("context");
  expect(selection.specs).toBe("context");
});

test("an empty content field is still a target", () => {
  const selection = initialSelection({ specs: allSpecs, schema, state: blank });
  expect(selection.body).toBe("fill");
});

// Single-field mode has no table, so a content field defaulted into context
// there could never be taken back out.
test("single-field mode keeps a written content field out of context too", () => {
  const selection = initialSelection({
    specs: allSpecs,
    schema,
    state: { ...halfWritten, body: { doc: { textContent: "Bài viết dài..." } } },
    singleFieldKey: "title",
  });
  expect(selection.title).toBe("fill");
  expect(selection.body).toBe("none");
  expect(selection.excerpt).toBe("context");
});

test("only array and object can be continued", () => {
  expect(isContinuableKind(specFor("specs"))).toBe(true);
  expect(isContinuableKind(specFor("body"))).toBe(false);
  expect(isContinuableKind(specFor("title"))).toBe(false);
});

test("continue needs a value, a fill target, and the right kind", () => {
  const spec = specFor("specs");
  // The real case: half-written rows, being written.
  expect(canContinue(spec, schema.specs, halfWritten.specs, "fill")).toBe(true);
  // Nothing to continue from.
  expect(canContinue(spec, schema.specs, [], "fill")).toBe(false);
  // Not being written: continuing a field the model won't touch is a
  // contradiction.
  expect(canContinue(spec, schema.specs, halfWritten.specs, "context")).toBe(
    false,
  );
  expect(canContinue(spec, schema.specs, halfWritten.specs, "none")).toBe(false);
  // Right column, wrong kind.
  expect(canContinue(specFor("excerpt"), schema.excerpt, "Có chữ", "fill")).toBe(
    false,
  );
});

test("size can only be picked on a content field being written", () => {
  expect(canPickSize(specFor("body"), "fill")).toBe(true);
  expect(canPickSize(specFor("body"), "context")).toBe(false);
  expect(canPickSize(specFor("body"), "none")).toBe(false);
  expect(canPickSize(specFor("excerpt"), "fill")).toBe(false);
});

// The config column holds one control per row, so the two settings have to be
// mutually exclusive - a field that claimed both would have to drop one.
test("the config column offers at most one control per field", () => {
  expect(configControlFor(specFor("body"))).toBe("size");
  expect(configControlFor(specFor("specs"))).toBe("continue");
  expect(configControlFor(specFor("title"))).toBe(null);
  expect(configControlFor(specFor("excerpt"))).toBe(null);
});

test("an object field is continuable, as a flat group of fields", () => {
  const spec = describeField(
    "brand",
    fields.object(
      {
        name: fields.text({ label: "Tên" }),
        tagline: fields.text({ label: "Khẩu hiệu" }),
      },
      { label: "Thương hiệu" },
    ),
  )!;
  expect(isContinuableKind(spec)).toBe(true);
});
