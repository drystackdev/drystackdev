/** @jest-environment node */
import { expect, test } from "@jest/globals";

import { fields } from "../../form/api";
import { describeField } from "../../api/ai/schema-to-yaml";
import { formValueToAiValue, seedYaml } from "./form-value-to-ai";

const specsField = fields.array(
  fields.object({
    key: fields.text({ label: "Tên thông số" }),
    value: fields.text({ label: "Giá trị" }),
  }),
  { label: "Thông số" },
);
const specsSpec = describeField("specs", specsField)!;

// The exact shape from the feature's motivating case: keys typed by hand,
// values left for the AI to fill from the article.
const halfWritten = [
  { key: "Thời lượng pin", value: "" },
  { key: "Màn hình", value: "" },
];

test("renders a half-written array of objects as YAML", () => {
  expect(seedYaml(specsSpec, specsField, halfWritten)).toBe(
    ["- key: Thời lượng pin", "  value: ''", "- key: Màn hình", "  value: ''"].join(
      "\n",
    ),
  );
});

// The empty value *is* the gap the model is being asked to fill. Dropping the
// key would read as a key it shouldn't write at all.
test("keeps empty children rather than dropping them", () => {
  const plain = formValueToAiValue(specsSpec, specsField, halfWritten) as any[];
  expect(plain[0]).toEqual({ key: "Thời lượng pin", value: "" });
  expect(Object.keys(plain[0])).toContain("value");
});

test("carries partly-filled values through untouched", () => {
  const yaml = seedYaml(specsSpec, specsField, [
    { key: "Thời lượng pin", value: "5000mAh" },
    { key: "Màn hình", value: "" },
  ]);
  expect(yaml).toContain("value: 5000mAh");
  expect(yaml).toContain("value: ''");
});

// js-yaml folds at 80 columns by default, which would rewrap the user's own
// prose into continuation lines - and prose the user typed has to survive the
// round trip byte for byte.
test("does not fold long prose the user wrote", () => {
  const field = fields.array(fields.text({ label: "Điểm" }), { label: "Điểm" });
  const spec = describeField("points", field)!;
  const long = "Đây là một câu rất dài ".repeat(10).trim();
  const yaml = seedYaml(spec, field, [long])!;
  expect(yaml.split("\n")).toHaveLength(1);
  expect(yaml).toContain(long);
});

test("a slug seeds its readable half, never the generated slug", () => {
  const field = fields.slug({ name: { label: "Tiêu đề" } });
  const spec = describeField("title", field)!;
  expect(
    formValueToAiValue(spec, field, { name: "Bài viết", slug: "bai-viet" }),
  ).toBe("Bài viết");
});

test("an object seeds each described child", () => {
  const field = fields.object(
    {
      name: fields.text({ label: "Tên" }),
      tagline: fields.text({ label: "Khẩu hiệu" }),
    },
    { label: "Thương hiệu" },
  );
  const spec = describeField("brand", field)!;
  expect(formValueToAiValue(spec, field, { name: "Drystack", tagline: "" })).toEqual(
    { name: "Drystack", tagline: "" },
  );
});

test("nothing to seed reads as nothing, not as empty YAML", () => {
  expect(seedYaml(specsSpec, specsField, [])).toBeUndefined();
  expect(seedYaml(specsSpec, specsField, undefined)).toBeUndefined();
});

// The mirror of apply-value's `field.parse()`: the seed has to be the same
// HTML the model is being asked to produce.
test("a content child seeds through the field's own serializer", () => {
  const spec = describeField("body", fields.content({ label: "Nội dung" }))!;
  const fakeContentField = {
    ...fields.content({ label: "Nội dung" }),
    serialize: () => ({ content: new TextEncoder().encode("<p>Xin chào</p>") }),
  } as any;
  expect(formValueToAiValue(spec, fakeContentField, { doc: {} })).toBe(
    "<p>Xin chào</p>",
  );
});
