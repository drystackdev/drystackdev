/** @jest-environment node */
import { expect, test } from "@jest/globals";

import {
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
  rewriteMaxTokens,
} from "./prompt";

const HTML_TAGS = ["p", "h2", "strong", "a"];

function system() {
  return buildRewriteSystemPrompt({
    lang: "vi-VN",
    entryDescription: "một bài blog về SEO",
    htmlTags: HTML_TAGS,
  });
}

test("states the tag whitelist the field actually allows", () => {
  const prompt = system();
  expect(prompt).toContain("Chỉ dùng các thẻ: p, h2, strong, a");
  expect(prompt).toContain("Không xuất <html>, <body> hay <img>");
});

test("carries the language and the entry description", () => {
  const prompt = system();
  expect(prompt).toContain("vi-VN");
  expect(prompt).toContain("một bài blog về SEO");
});

test("asks for a bare fragment, and only the passage", () => {
  const prompt = system();
  expect(prompt).toContain("Không bọc trong ```html");
  expect(prompt).toContain("Chỉ viết lại đúng đoạn được đưa");
  // The whole point of the route: no length preset reaches the model, so
  // nothing here may smuggle one in.
  expect(prompt).not.toContain("khoảng 500 từ");
  expect(prompt).not.toContain("khoảng 1000 từ");
});

// The repo's formatter rewrites `—` to `-` on save, string literals included.
// The prompt reads fine either way, so nothing but a test would notice - and
// it would silently drift from schema-to-yaml.ts, which does use em-dashes.
test("prompt text survives the formatter's em-dash rewriting", () => {
  expect(system()).not.toContain("—");
});

test("user prompt puts context, passage and instruction in that order", () => {
  const prompt = buildRewriteUserPrompt({
    context: { title: "Tiêu đề bài" },
    selection: "<p>Đoạn gốc.</p>",
    description: "viết ngắn gọn hơn",
  });
  expect(prompt.indexOf("NGỮ CẢNH")).toBeLessThan(prompt.indexOf("ĐOẠN CẦN SỬA"));
  expect(prompt.indexOf("ĐOẠN CẦN SỬA")).toBeLessThan(prompt.indexOf("YÊU CẦU"));
  expect(prompt).toContain("title: Tiêu đề bài");
  expect(prompt).toContain("<p>Đoạn gốc.</p>");
  expect(prompt).toContain("viết ngắn gọn hơn");
});

test("user prompt without context skips the context block entirely", () => {
  const prompt = buildRewriteUserPrompt({
    context: {},
    selection: "<p>Đoạn gốc.</p>",
    description: "",
  });
  expect(prompt).not.toContain("NGỮ CẢNH");
  // An empty instruction still has to say something, or the model is left to
  // guess what the user wanted done.
  expect(prompt).toContain("Viết lại đoạn trên cho tốt hơn.");
});

test("token budget follows the passage, within bounds", () => {
  // A short passage still needs room to be expanded on request.
  expect(rewriteMaxTokens(10)).toBe(2000);
  expect(rewriteMaxTokens(5000)).toBe(5000);
  // A selection of the whole article can't ask for an unbounded response.
  expect(rewriteMaxTokens(100_000)).toBe(16_000);
});
