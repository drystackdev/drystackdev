/** @jest-environment node */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterAll, expect, test } from "@jest/globals";
import { embedSvgCharts } from "./apply-value";

// See apply-value.test.ts's afterAll for why this matters.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});
import { createEditorSchema } from "../../form/fields/markdoc/editor/schema";
import { editorOptionsToConfig } from "../../form/fields/markdoc/config";
import { htmlToProseMirror } from "../../form/fields/markdoc/editor/html/parse";
import { serializeFromEditorStateToHTML } from "../../form/fields/markdoc/editor/html/serialize";

// Captured verbatim from a real generate call against `fields.content({})`'s
// prompt (packages/drystack/src/api/ai/prompt.ts's svg rule), asking for a
// short chart-illustrated passage. Frozen here as a fixture so this test
// exercises the model's actual output shape (self-closing tags, an `xmlns`
// attribute, a `<title>`, multiple children) rather than a hand-simplified one.
const AI_GENERATED_HTML = `<h2>Chiến lược tối ưu hóa tăng trưởng Organic Traffic Q1/2026</h2>
<p>Một đoạn mở đầu.</p>
<h3>Phân tích dữ liệu tăng trưởng quý 1</h3>
<p>Dưới đây là sơ đồ minh họa:</p>
<svg viewBox="0 0 300 200" width="300" height="200" xmlns="http://www.w3.org/2000/svg">
  <title>Biểu đồ tăng trưởng Traffic Q1/2026</title>
  <rect x="40" y="120" width="40" height="40" fill="#3498db" />
  <text x="45" y="170" font-size="12">Tháng 1</text>
  <rect x="120" y="90" width="40" height="70" fill="#2980b9" />
  <text x="125" y="170" font-size="12">Tháng 2</text>
  <rect x="200" y="50" width="40" height="110" fill="#1f618d" />
  <text x="205" y="170" font-size="12">Tháng 3</text>
  <line x1="20" y1="160" x2="280" y2="160" stroke="black" />
</svg>
<p><em>Ghi chú cuối.</em></p>`;

test("a real AI-generated <svg> chart survives content field parse -> serialize as a real embedded image", () => {
  const config = editorOptionsToConfig({}, true, false);
  const schema = createEditorSchema(config, {}, false);

  const { html, other: fromAi } = embedSvgCharts(AI_GENERATED_HTML, true);
  expect(fromAi.size).toBe(1);
  const [filename, svgBytes] = [...fromAi.entries()][0];
  expect(new TextDecoder().decode(svgBytes)).toContain("<rect");

  // Exactly what content.field.parse() does with the AI codec's output -
  // `other` stands in for the sibling bytes a real generation would carry.
  const doc = htmlToProseMirror(html, schema, fromAi);

  const imageNode: any[] = [];
  doc.descendants((node) => {
    if (node.type.name === "image") imageNode.push(node);
  });
  expect(imageNode).toHaveLength(1);
  // Real bytes made it onto the parsed node, not the "unhydrated" sentinel.
  expect(imageNode[0].attrs.src.byteLength).toBeGreaterThan(0);
  expect(imageNode[0].attrs.filename).toBe(filename);
  expect(imageNode[0].attrs.alt).toBe("Biểu đồ tăng trưởng Traffic Q1/2026");

  // Round-trip through serialize() - what actually gets written to disk,
  // exercising the same entryDirectory-scoped asset path real uploads use.
  const other = new Map<string, Uint8Array>();
  const outHtml = serializeFromEditorStateToHTML(doc, other, "blog/tang-truong-q1");

  expect(outHtml).toContain('<img src="/blog/tang-truong-q1/assets/');
  expect(outHtml).not.toContain("<svg");
  expect(other.size).toBe(1);
  const writtenBytes = [...other.values()][0];
  expect(new TextDecoder().decode(writtenBytes)).toBe(
    new TextDecoder().decode(svgBytes),
  );
});
