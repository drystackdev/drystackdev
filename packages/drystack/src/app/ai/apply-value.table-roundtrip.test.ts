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

// The kind of table the model now emits for `fields.content`: allowedHtmlTags
// advertises the table tags (content/index.tsx, gated on config.table) and the
// system prompt carries the table-structure rule (api/ai/prompt.ts). A header
// row of <th>, two body rows of <td>, one cell with an inline mark - proves the
// cell's `block+` content and its marks survive parse -> serialize.
const AI_GENERATED_HTML = `<h2>So sánh các gói dịch vụ SEO</h2>
<p>Bảng dưới đây so sánh ba gói phổ biến.</p>
<table>
  <thead>
    <tr>
      <th>Tiêu chí</th>
      <th>Gói Cơ bản</th>
      <th>Gói Nâng cao</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td>Số từ khóa</td>
      <td>10</td>
      <td>30</td>
    </tr>
    <tr>
      <td>Tần suất báo cáo</td>
      <td>Hàng tháng</td>
      <td><strong>Hàng tuần</strong></td>
    </tr>
  </tbody>
</table>
<p>Liên hệ để biết thêm chi tiết.</p>`;

test("the AI codec leaves <table> markup intact (unlike <img>, which it strips)", () => {
  // stripDisallowedTags only removes <img> (bytes the model can't invent) - a
  // table is prose-adjacent markup the parser can hold, so it must pass through.
  const out = stripDisallowedTags(AI_GENERATED_HTML);
  expect(out).toContain("<table>");
  expect(out).toContain("<th>Tiêu chí</th>");
  expect(out).toContain("<td><strong>Hàng tuần</strong></td>");
});

test("a real AI-generated <table> survives content field parse -> serialize", () => {
  const config = editorOptionsToConfig({}, true, false);
  const schema = createEditorSchema(config, {}, false);

  const doc = htmlToProseMirror(AI_GENERATED_HTML, schema, new Map());

  const tables: unknown[] = [];
  const headerCells: unknown[] = [];
  const bodyCells: unknown[] = [];
  doc.descendants((node) => {
    if (node.type.name === "table") tables.push(node);
    if (node.type.name === "table_header") headerCells.push(node);
    if (node.type.name === "table_cell") bodyCells.push(node);
  });
  expect(tables).toHaveLength(1);
  // 3 rows (1 header + 2 body) => 3 header cells, 6 body cells
  expect(headerCells).toHaveLength(3);
  expect(bodyCells).toHaveLength(6);

  const outHtml = serializeFromEditorStateToHTML(doc, new Map());

  // The serializer splits the header row into <thead> and the rest into
  // <tbody> (see serialize.ts's table case), keeping <th>/<td> and inline
  // marks. Cell text is wrapped in <p> because a cell's content is `block+`.
  expect(outHtml).toContain("<table");
  expect(outHtml).toContain("<thead>");
  expect(outHtml).toContain("<tbody>");
  expect(outHtml).toContain("<th>");
  expect(outHtml).toContain("<td>");
  expect(outHtml).toContain("Tiêu chí");
  expect(outHtml).toContain("Số từ khóa");
  expect(outHtml).toContain("<strong>Hàng tuần</strong>");

  // The serialized HTML is exactly what lands on disk - reloading it must
  // rebuild the same single table, not drop it or double it.
  let reloadedTables = 0;
  htmlToProseMirror(outHtml, schema, new Map()).descendants((node) => {
    if (node.type.name === "table") reloadedTables++;
  });
  expect(reloadedTables).toBe(1);
});
