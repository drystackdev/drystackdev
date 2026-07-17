/** @jest-environment node */
import { expect, test } from "@jest/globals";

import { fields } from "../../form/api";
import { describeField } from "../../api/ai/schema-to-yaml";
import { AiStreamParser } from "./stream-parser";
import { aiValueToFormValue } from "./apply-value";

// End-to-end for the structural kinds: schema -> what the parser pulls out of
// the model's YAML -> the form value. describeField is covered on its own in
// api/ai/schema-to-yaml.test.ts; what this pins down is the two steps after
// it, where a shape that describes fine can still arrive as undefined.
//
// `zzz` is only ever there to close the block being tested: the parser calls a
// field done when the *next* top-level key starts.
function apply(key: string, schema: any, yaml: string) {
  const spec = describeField(key, schema)!;
  const events: any[] = [];
  const parser = new AiStreamParser([key, "zzz"], e => events.push(e));
  parser.write(yaml);
  parser.end();
  const done = events.find(e => e.type === "field-done" && e.key === key);
  if (!done) throw new Error(`no field-done for ${key}`);
  return aiValueToFormValue(spec, schema, done.raw);
}

test("array of text round-trips to a form value", () => {
  const schema = fields.array(fields.text({ label: "Tag" }), { label: "Tags" });
  expect(apply("tags", schema, "tags:\n  - alpha\n  - beta\nzzz: x\n")).toEqual([
    "alpha",
    "beta",
  ]);
});

test("array of object round-trips", () => {
  const schema = fields.array(
    fields.object({
      step: fields.text({ label: "Bước" }),
      desc: fields.text({ label: "Mô tả" }),
    }),
    { label: "Quy trình" },
  );
  expect(
    apply(
      "process",
      schema,
      "process:\n  - step: Một\n    desc: Mô tả một\n  - step: Hai\n    desc: Mô tả hai\nzzz: x\n",
    ),
  ).toEqual([
    { step: "Một", desc: "Mô tả một" },
    { step: "Hai", desc: "Mô tả hai" },
  ]);
});

test("object holding a nested array round-trips", () => {
  const schema = fields.object(
    {
      label: fields.text({ label: "Nhãn" }),
      links: fields.array(fields.text({ label: "Link" }), { label: "Links" }),
    },
    { label: "Info" },
  );
  expect(
    apply("info", schema, "info:\n  label: Tài nguyên\n  links:\n    - a\n    - b\nzzz: x\n"),
  ).toEqual({ label: "Tài nguyên", links: ["a", "b"] });
});

// The deepest nesting the real config reaches (demo.sections[]).
test("array > object > array round-trips", () => {
  const schema = fields.array(
    fields.object({
      title: fields.text({ label: "Tiêu đề" }),
      items: fields.array(fields.text({ label: "Mục" }), { label: "Items" }),
    }),
    { label: "Sections" },
  );
  expect(
    apply(
      "sections",
      schema,
      "sections:\n  - title: S1\n    items:\n      - i1\n      - i2\nzzz: x\n",
    ),
  ).toEqual([{ title: "S1", items: ["i1", "i2"] }]);
});
