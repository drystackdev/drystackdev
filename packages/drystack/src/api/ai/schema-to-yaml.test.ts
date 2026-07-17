/** @jest-environment node */
import { expect, test } from "@jest/globals";

import { fields } from "../../form/api";
import {
  describeField,
  describeFields,
  renderSkeleton,
} from "./schema-to-yaml";

// Mirrors the real drystack.config.ts shapes (blog, services.process[],
// gioiThieu.timeline.items[]) rather than importing the config itself, which
// would drag the whole field-UI bundle into a node test run.
const blogSchema = {
  title: fields.slug({ name: { label: "Tiêu đề" } }),
  excerpt: fields.text({
    label: "Mô tả ngắn",
    multiline: true,
    validation: { isRequired: true },
  }),
  keywords: fields.text({
    label: "Từ khóa SEO",
    description: "Cách nhau bởi dấu phẩy",
  }),
  cover: fields.image({ label: "Ảnh bìa" }),
  date: fields.date({ label: "Ngày đăng", validation: { isRequired: true } }),
  publish: fields.checkbox({ label: "Xuất bản", defaultValue: false }),
  readingTime: fields.integer({ label: "Thời gian đọc" }),
  canonical: fields.url({ label: "Canonical" }),
  body: fields.content({ label: "Nội dung", options: { heading: [2, 3, 4] } }),
  createdAt: fields.timestamp({ mode: "created", label: "Tạo lúc" }),
  updatedAt: fields.timestamp({ mode: "updated", label: "Sửa lúc" }),
};

test("describes the fields the AI can fill", () => {
  const specs = describeFields(blogSchema);
  expect(specs.map((s) => [s.key, s.kind])).toEqual([
    ["title", "slug"],
    ["excerpt", "text"],
    ["keywords", "text"],
    ["body", "content"],
  ]);
});

test("leaves out image fields - the model cannot produce bytes", () => {
  expect(describeField("cover", blogSchema.cover)).toBeUndefined();
});

// Not prose: a publish date or an on/off flag is a fact about the entry, and
// one the model invents is indistinguishable from a real one.
test("leaves out date, checkbox, number and url fields", () => {
  expect(describeField("date", blogSchema.date)).toBeUndefined();
  expect(describeField("publish", blogSchema.publish)).toBeUndefined();
  expect(describeField("readingTime", blogSchema.readingTime)).toBeUndefined();
  expect(describeField("canonical", blogSchema.canonical)).toBeUndefined();
});

// Stamped by the save pipeline, never by a person, so never by the AI.
test("leaves out timestamp fields", () => {
  expect(describeField("createdAt", blogSchema.createdAt)).toBeUndefined();
  expect(describeField("updatedAt", blogSchema.updatedAt)).toBeUndefined();
});

test("carries description, multiline and isRequired into the spec", () => {
  const specs = describeFields(blogSchema);
  const excerpt = specs.find((s) => s.key === "excerpt")!;
  expect(excerpt.multiline).toBe(true);
  expect(excerpt.isRequired).toBe(true);

  const keywords = specs.find((s) => s.key === "keywords")!;
  expect(keywords.description).toBe("Cách nhau bởi dấu phẩy");
  expect(keywords.isRequired).toBe(false);
});

// Both are formKind: 'slug', so this has to key off something else - and it
// must not be the default value: this module runs server-side, where calling
// into the slug field's generator throws (react-server build), which would
// misclassify every slug field as plain text.
test("tells text and slug fields apart without calling into field UI", () => {
  expect(describeField("title", blogSchema.title)!.kind).toBe("slug");
  expect(describeField("excerpt", blogSchema.excerpt)!.kind).toBe("text");
});

// The prompt must never offer a tag the editor would drop on parse.
test("restricts content tags to the configured heading levels", () => {
  const body = describeField("body", blogSchema.body)!;
  expect(body.htmlTags).toContain("h2");
  expect(body.htmlTags).toContain("h4");
  expect(body.htmlTags).not.toContain("h1");
  expect(body.htmlTags).not.toContain("h5");
  expect(body.htmlTags).not.toContain("img");
});

test("takes the content field label, not its key", () => {
  expect(describeField("body", blogSchema.body)!.label).toBe("Nội dung");
});

test("lists select options so the model cannot invent one", () => {
  const spec = describeField(
    "icon",
    fields.select({
      label: "Icon",
      options: [
        { label: "Search", value: "search" },
        { label: "Settings", value: "settings" },
      ],
      defaultValue: "search",
    }),
  )!;
  expect(spec.kind).toBe("select");
  expect(spec.options).toEqual(["search", "settings"]);
});

test("describes an array of text", () => {
  const spec = describeField(
    "tags",
    fields.array(fields.text({ label: "Tag" }), { label: "Tags" }),
  )!;
  expect(spec.kind).toBe("array");
  expect(spec.element!.kind).toBe("text");
});

test("describes array > object, as services.process[] does", () => {
  const spec = describeField(
    "process",
    fields.array(
      fields.object({
        step: fields.text({ label: "Bước", validation: { isRequired: true } }),
        desc: fields.text({ label: "Mô tả", multiline: true }),
      }),
      { label: "Quy trình thực hiện" },
    ),
  )!;
  expect(spec.kind).toBe("array");
  expect(spec.element!.kind).toBe("object");
  expect(spec.element!.children!.map((c) => c.key)).toEqual(["step", "desc"]);
});

// The deepest nesting the real config reaches (demo.sections[]).
test("describes array > object > array", () => {
  const spec = describeField(
    "sections",
    fields.array(
      fields.object({
        title: fields.text({ label: "Tiêu đề section" }),
        items: fields.array(fields.text({ label: "Mục" }), { label: "Items" }),
      }),
      { label: "Sections" },
    ),
  )!;
  const items = spec.element!.children!.find((c) => c.key === "items")!;
  expect(items.kind).toBe("array");
  expect(items.element!.kind).toBe("text");
});

// An object of nothing but images has nothing for the AI to write.
test("drops an object whose children are all unsupported", () => {
  const spec = describeField(
    "tools",
    fields.object(
      { icon: fields.image({ label: "Ảnh" }) },
      { label: "Công cụ" },
    ),
  );
  expect(spec).toBeUndefined();
});

test("renders a skeleton the prompt can use", () => {
  const skeleton = renderSkeleton(describeFields(blogSchema));
  expect(skeleton).toContain(
    "excerpt (văn bản nhiều dòng, bắt buộc): Mô tả ngắn",
  );
  expect(skeleton).toContain(
    "keywords (văn bản ngắn): Từ khóa SEO - Cách nhau bởi dấu phẩy",
  );
  expect(skeleton).toContain("h2, h3, h4");
});

test("renders nested array > object in the skeleton", () => {
  const skeleton = renderSkeleton([
    describeField(
      "process",
      fields.array(
        fields.object({
          step: fields.text({ label: "Bước" }),
          desc: fields.text({ label: "Mô tả", multiline: true }),
        }),
        { label: "Quy trình" },
      ),
    )!,
  ]);
  expect(skeleton).toContain(
    "process (danh sách các mục, mỗi mục gồm): Quy trình",
  );
  expect(skeleton).toContain("  step (văn bản ngắn): Bước");
  expect(skeleton).toContain("  desc (văn bản nhiều dòng): Mô tả");
});
