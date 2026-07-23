/** @jest-environment node */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterAll, expect, test } from "@jest/globals";
import { createEditorSchema } from "../schema";
import { editorOptionsToConfig } from "../../config";
import { htmlToProseMirror } from "./parse";
import { serializeFromEditorStateToHTML } from "./serialize";

afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function blockSchema() {
  return createEditorSchema(editorOptionsToConfig({}, true, false), {}, false);
}

function roundTrip(html: string) {
  const doc = htmlToProseMirror(html, blockSchema(), new Map());
  return serializeFromEditorStateToHTML(doc, new Map());
}

const REF = "collection::blog::my-post::body";

test("a content-ref placeholder round-trips byte-identical", () => {
  const html = `<section data-ref-content="${REF}"></section>`;
  expect(roundTrip(html)).toBe(html);
});

test("parses into an atom content_ref node with only the ref attr", () => {
  const html = `<section data-ref-content="${REF}"></section>`;
  const doc = htmlToProseMirror(html, blockSchema(), new Map());
  const node = doc.firstChild!;
  expect(node.type.name).toBe("content_ref");
  expect(node.attrs).toEqual({ ref: REF, seedHtml: null });
  expect(node.childCount).toBe(0);
});

test("captures a live page's already-resolved section body as seedHtml, without adding it to the node's own content", () => {
  const html = `<section data-ref-content="${REF}"><p>Resolved</p></section>`;
  const doc = htmlToProseMirror(html, blockSchema(), new Map());
  const node = doc.firstChild!;
  expect(node.type.name).toBe("content_ref");
  expect(node.attrs).toEqual({ ref: REF, seedHtml: "<p>Resolved</p>" });
  expect(node.childCount).toBe(0);
});

test("never bakes in surrounding content - a document with prose before/after keeps the placeholder empty", () => {
  const html = `<p>Trước</p><section data-ref-content="${REF}"></section><p>Sau</p>`;
  const out = roundTrip(html);
  expect(out).toBe(html);
});

test("dropped (not unwrapped) when contentRef is disabled in this field's config", () => {
  const schema = createEditorSchema(
    editorOptionsToConfig({}, false, false),
    {},
    false,
  );
  const html = `<p>a</p><section data-ref-content="${REF}"></section><p>b</p>`;
  const doc = htmlToProseMirror(html, schema, new Map());
  expect(serializeFromEditorStateToHTML(doc, new Map())).toBe(
    "<p>a</p><p>b</p>",
  );
});
