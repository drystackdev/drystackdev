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

function blockSchema() {
  return createEditorSchema(editorOptionsToConfig({}, true, false), {}, false);
}

function roundTrip(html: string) {
  const doc = htmlToProseMirror(html, blockSchema(), new Map());
  return serializeFromEditorStateToHTML(doc, new Map());
}

test("h2/h3/h4 get id = vietnamese slug of their text + cid", () => {
  const out = roundTrip(
    "<h2>Bí quyết tối ưu SEO</h2><p>Nội dung.</p><h3>Đo lường kết quả</h3><h4>Công cụ hỗ trợ</h4>",
  );
  expect(out).toMatch(/<h2 id="bi-quyet-toi-uu-seo-[a-z0-9]{5}">/);
  expect(out).toMatch(/<h3 id="do-luong-ket-qua-[a-z0-9]{5}">/);
  expect(out).toMatch(/<h4 id="cong-cu-ho-tro-[a-z0-9]{5}">/);
});

test("same-text headings get distinct ids", () => {
  const out = roundTrip("<h2>Tổng quan</h2><p>a</p><h2>Tổng quan</h2>");
  const ids = [...out.matchAll(/<h2 id="([^"]+)"/g)].map((m) => m[1]);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);
  for (const id of ids) expect(id).toMatch(/^tong-quan-[a-z0-9]{5}$/);
});

test("ids are deterministic: parse -> serialize is byte-identical", () => {
  const first = roundTrip(
    "<h2>Chiến lược nội dung</h2><p>x</p><h3>Chiến lược nội dung</h3>",
  );
  const second = roundTrip(first);
  expect(second).toBe(first);
});

test("marks inside the heading do not change the slug", () => {
  const out = roundTrip("<h2>Tăng <strong>trưởng</strong> bền vững</h2>");
  expect(out).toMatch(/<h2 id="tang-truong-ben-vung-[a-z0-9]{5}">/);
  expect(out).toContain("<strong>trưởng</strong>");
});

test("a heading with no sluggable text falls back to muc-<cid>", () => {
  const out = roundTrip("<h2>!!!</h2>");
  expect(out).toMatch(/<h2 id="muc-[a-z0-9]{5}">/);
});

test("text-align survives alongside the id", () => {
  const out = roundTrip('<h2 style="text-align:center">Liên hệ</h2>');
  expect(out).toMatch(
    /<h2 id="lien-he-[a-z0-9]{5}" style="text-align:center">/,
  );
});
