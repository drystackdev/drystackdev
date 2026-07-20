/** @jest-environment node */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterAll, expect, test } from "@jest/globals";
import { stripDisallowedTags } from "./apply-value";

// Undoes the global registration above so a sibling test file that captures
// `globalThis.fetch` at its own module scope (e.g. model-retry.test.ts) isn't
// handed happy-dom's fetch instead of the real one when bun runs both files
// in the same process.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("drops <img>, whose src would point at bytes that don't exist", () => {
  const out = stripDisallowedTags(
    '<p>trước</p><img src="/made-up.png" alt="x"><p>sau</p>',
  );
  expect(out).not.toContain("<img");
  expect(out).toContain("trước");
  expect(out).toContain("sau");
});

// `<svg>` deliberately survives this step: unlike `<img>` it carries its own
// content, so the content field's parser keeps it as a real `svg` node
// (sanitizing it on the way in) rather than a dead reference. See
// markdoc/editor/svg-markup.test.ts for what that sanitizing removes.
test("leaves <svg> for the content field's own parser to handle", () => {
  const html = '<p>Doanh thu</p><svg viewBox="0 0 10 10"><rect/></svg>';
  expect(stripDisallowedTags(html)).toBe(html);
});
