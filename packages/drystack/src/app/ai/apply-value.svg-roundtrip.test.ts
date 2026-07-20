/** @jest-environment node */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterAll, expect, test } from "@jest/globals";
import { stripDisallowedTags } from "./apply-value";

// See apply-value.test.ts's afterAll for why this matters.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
import { createEditorSchema } from "../../form/fields/markdoc/editor/schema";
import { editorOptionsToConfig } from "../../form/fields/markdoc/config";
import { htmlToProseMirror } from "../../form/fields/markdoc/editor/html/parse";
import { serializeFromEditorStateToHTML } from "../../form/fields/markdoc/editor/html/serialize";

// Captured verbatim from a real generate call against `fields.content({})`'s
// prompt (packages/drystack/src/api/ai/prompt.ts's svg rules), asking for a
// short chart-illustrated passage. Frozen here as a fixture so this test
// exercises the model's actual output shape (self-closing tags, a `<title>`,
// no `xmlns`, multiple children) rather than a hand-simplified one.
//
// Note what the model reached for on its own: `fill="currentColor"` varied by
// `opacity` to tell the three bars apart, and no `font-family`. That's the
// theme rule in the prompt doing its job - the drawing has no colour of its
// own to clash with the page it lands on.
const AI_GENERATED_HTML = `<h2>Chiến lược tối ưu hóa SEO để bùng nổ Organic Traffic quý 1/2026</h2>
<p>Bước vào quý 1 năm 2026, thị trường SEO tại Việt Nam tập trung vào <strong>ý định tìm kiếm</strong>.</p>
<h3>Tăng trưởng lưu lượng truy cập qua các tháng đầu năm</h3>
<p>Dưới đây là biểu đồ mô phỏng sự tăng trưởng kỳ vọng:</p>
<svg viewBox="0 0 400 200" width="400" height="200">
  <title>Biểu đồ tăng trưởng Organic Traffic dự kiến Q1/2026</title>
  <rect x="50" y="150" width="50" height="20" fill="currentColor" opacity="0.3" />
  <rect x="150" y="120" width="50" height="50" fill="currentColor" opacity="0.6" />
  <rect x="250" y="80" width="50" height="90" fill="currentColor" opacity="1" />
  <text x="60" y="190">Tháng 1</text>
  <text x="160" y="190">Tháng 2</text>
  <text x="260" y="190">Tháng 3</text>
</svg>
<p><em>Ghi chú cuối.</em></p>`;

function contentFieldSchema() {
  return createEditorSchema(editorOptionsToConfig({}, true, false), {}, false);
}

test("a real AI-generated <svg> chart stays inline through parse -> serialize", () => {
  const schema = contentFieldSchema();

  // Exactly what content.field.parse() does with the AI codec's output. No
  // `other` bytes: an inline drawing isn't an asset, which is the whole point.
  const doc = htmlToProseMirror(
    stripDisallowedTags(AI_GENERATED_HTML),
    schema,
    new Map(),
  );

  const svgNodes: any[] = [];
  doc.descendants((node) => {
    if (node.type.name === "svg") svgNodes.push(node);
  });
  expect(svgNodes).toHaveLength(1);
  expect(svgNodes[0].attrs.markup).toContain("<rect");
  expect(svgNodes[0].attrs.markup).toContain("Biểu đồ tăng trưởng");
  // The drawing's own `width="400"` is intrinsic, not a layout choice.
  expect(svgNodes[0].attrs.width).toBe(null);

  // Round-trip through serialize() - what actually gets written to disk.
  const other = new Map<string, Uint8Array>();
  const outHtml = serializeFromEditorStateToHTML(
    doc,
    other,
    "blog/tang-truong-q1",
  );

  // The drawing lands in the page as markup, so the site's CSS reaches it -
  // `currentColor` here resolves against the surrounding text, which it never
  // would inside an <img>-referenced file.
  expect(outHtml).toContain("<svg");
  expect(outHtml).toContain('fill="currentColor"');
  expect(outHtml).toContain("<rect");
  expect(outHtml).not.toContain("<img");
  // Responsive by default: the drawing's intrinsic 400px must not force a
  // horizontal scrollbar in a narrower column.
  expect(outHtml).toContain("max-width:100%;height:auto");
  // ...and nothing is written to the entry's assets/ directory for it.
  expect(other.size).toBe(0);

  // Stable across a second trip: re-parsing what we just wrote must produce
  // the same document and the same HTML, or every save would churn the file.
  const reparsed = htmlToProseMirror(outHtml, schema, new Map());
  expect(
    serializeFromEditorStateToHTML(reparsed, new Map(), "blog/tang-truong-q1"),
  ).toBe(outHtml);
});

test("a field with images off drops the drawing instead of leaking its labels", () => {
  // No `svg` node in this schema, so there's nowhere for the drawing to go.
  // The failure mode this guards is the parser walking into it and emitting
  // "Tháng 1 Tháng 2" as if it were prose.
  const schema = createEditorSchema(
    editorOptionsToConfig({ image: false }, true, false),
    {},
    false,
  );
  const doc = htmlToProseMirror(
    stripDisallowedTags(AI_GENERATED_HTML),
    schema,
    new Map(),
  );
  const outHtml = serializeFromEditorStateToHTML(doc, new Map());

  expect(outHtml).not.toContain("<svg");
  expect(outHtml).not.toContain("Tháng 1");
  expect(outHtml).not.toContain("Biểu đồ tăng trưởng");
  expect(outHtml).toContain("Ghi chú cuối");
});

test("a drawing carrying an event handler is kept, but the handler is not", () => {
  // Inline markup runs in the page, so what survives this pipeline is a
  // security boundary, not a formatting one. Element-level stripping (script,
  // style, foreignObject) is covered in markdoc/editor/svg-markup.test.ts,
  // which can build those children directly - happy-dom's parser can't nest a
  // `<script>` inside an `<svg>` from a string.
  const schema = contentFieldSchema();
  const doc = htmlToProseMirror(
    '<p>x</p><svg viewBox="0 0 10 10" onload="steal()"><rect width="10" height="10" fill="currentColor" onclick="steal()"/></svg>',
    schema,
    new Map(),
  );
  const outHtml = serializeFromEditorStateToHTML(doc, new Map());

  expect(outHtml).toContain("<rect");
  expect(outHtml).not.toContain("steal()");
  expect(outHtml).not.toContain("onload");
  expect(outHtml).not.toContain("onclick");
});
