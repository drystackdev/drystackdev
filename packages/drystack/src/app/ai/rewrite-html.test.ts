/** @jest-environment node */
import { expect, test } from "@jest/globals";

import { stripCodeFence } from "./rewrite-html";
import { stripDisallowedTags } from "./apply-value";

test("leaves a bare fragment alone", () => {
  expect(stripCodeFence("<p>Xin chào.</p>")).toBe("<p>Xin chào.</p>");
});

test("strips a ```html fence around the whole answer", () => {
  expect(stripCodeFence("```html\n<p>Xin chào.</p>\n```")).toBe(
    "<p>Xin chào.</p>",
  );
});

test("strips an unlabelled fence too", () => {
  expect(stripCodeFence("```\n<p>Xin chào.</p>\n```")).toBe("<p>Xin chào.</p>");
});

test("tolerates a fence the model never closed", () => {
  // Running out of tokens mid-answer shouldn't cost the user the whole reply.
  expect(stripCodeFence("```html\n<p>Bị cắt giữa chừng.")).toBe(
    "<p>Bị cắt giữa chừng.",
  );
});

test("keeps a fence that is part of the content", () => {
  // The passage is about code: the fence is the answer, not packaging.
  const answer = "```js\nconst x = 1;\n```";
  expect(stripCodeFence(answer)).toBe(answer);
});

test("keeps a fence in the middle of the answer", () => {
  const answer = "<p>Ví dụ:</p>\n```js\nconst x = 1;\n```";
  expect(stripCodeFence(answer)).toBe(answer);
});

test("a fence with no body yields nothing", () => {
  expect(stripCodeFence("```html")).toBe("");
});

test("images are dropped even when the prompt allowed nothing else", () => {
  // A made-up src points at bytes that don't exist; the editor would carry the
  // dead reference into the saved HTML.
  expect(stripDisallowedTags('<p>A</p><img src="/made-up.png"><p>B</p>')).toBe(
    "<p>A</p><p>B</p>",
  );
});
