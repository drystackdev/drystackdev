/** @jest-environment node */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterAll, expect, test } from "@jest/globals";
import { createEditorSchema } from "../schema";
import { editorOptionsToConfig } from "../../config";
import { htmlToProseMirror } from "./parse";
import { serializeFromEditorStateToHTML } from "./serialize";

// See apply-value.test.ts's afterAll for why this matters.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function inlineOnlySchema() {
  return createEditorSchema(editorOptionsToConfig({}, true, true), {}, false);
}

function blockSchema() {
  return createEditorSchema(editorOptionsToConfig({}, true, false), {}, false);
}

function roundTrip(html: string, schema = inlineOnlySchema()) {
  const doc = htmlToProseMirror(html, schema, new Map());
  return serializeFromEditorStateToHTML(doc, new Map());
}

test("inline-only doc content is inline* with no paragraph node", () => {
  const schema = inlineOnlySchema();
  expect(schema.schema.nodes.doc.spec.content).toBe("inline*");
  expect(schema.nodes.paragraph).toBeUndefined();
  expect(schema.nodes.hard_break).toBeDefined();
});

test("default (non-inline-only) schema is unaffected", () => {
  const schema = blockSchema();
  expect(schema.schema.nodes.doc.spec.content).toBe("block+");
  expect(schema.nodes.paragraph).toBeDefined();
});

test("serializes inline content with no wrapping tag", () => {
  expect(roundTrip("Đây là <em>nội dung</em>")).toBe(
    "Đây là <em>nội dung</em>",
  );
});

test("round-trips marks with no wrapping tag", () => {
  expect(roundTrip("Xin <strong>chào</strong> bạn")).toBe(
    "Xin <strong>chào</strong> bạn",
  );
});

test("unwraps legacy <p><p> data into a hard break", () => {
  const legacy =
    "<p>Bứt phá thứ hạng.</p><p>Chiếm lĩnh <strong>top tìm kiếm</strong>.</p>";
  expect(roundTrip(legacy)).toBe(
    "Bứt phá thứ hạng.<br>Chiếm lĩnh <strong>top tìm kiếm</strong>.",
  );
});

test("single legacy <p> unwraps without a stray hard break", () => {
  expect(roundTrip("<p>Xin chào</p>")).toBe("Xin chào");
});
