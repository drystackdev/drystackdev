/** @jest-environment node */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterAll, expect, test } from "@jest/globals";
import { embedSvgCharts } from "./apply-value";

// Undoes the global registration above so a sibling test file that captures
// `globalThis.fetch` at its own module scope (e.g. model-retry.test.ts) isn't
// handed happy-dom's fetch instead of the real one when bun runs both files
// in the same process.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

test("leaves html untouched when there's no <svg> in it", () => {
  const html = "<p>Xin chào</p>";
  const result = embedSvgCharts(html, true);
  expect(result.html).toBe(html);
  expect(result.other.size).toBe(0);
});

test("allow=true replaces <svg> with an <img> backed by real bytes", () => {
  const html =
    '<p>Doanh thu</p><svg viewBox="0 0 10 10"><title>Biểu đồ quý 1</title><rect width="10" height="10"/></svg>';
  const { html: out, other } = embedSvgCharts(html, true);

  expect(out).not.toContain("<svg");
  expect(out).toMatch(/<img src="ai-chart-1\.svg"/);
  expect(out).toContain('alt="Biểu đồ quý 1"');

  expect(other.size).toBe(1);
  const bytes = other.get("ai-chart-1.svg")!;
  expect(bytes).toBeDefined();
  const svgText = new TextDecoder().decode(bytes);
  expect(svgText).toContain("<svg");
  expect(svgText).toContain("<rect");
});

test("allow=true assigns each <svg> a unique filename", () => {
  const html = "<svg><rect/></svg><p>giữa</p><svg><circle/></svg>";
  const { html: out, other } = embedSvgCharts(html, true);
  expect(out).toContain('src="ai-chart-1.svg"');
  expect(out).toContain('src="ai-chart-2.svg"');
  expect(other.size).toBe(2);
});

test("allow=false strips <svg> instead of embedding it", () => {
  const html = "<p>trước</p><svg><rect/></svg><p>sau</p>";
  const { html: out, other } = embedSvgCharts(html, false);
  expect(out).not.toContain("<svg");
  expect(out).not.toContain("<img");
  expect(out).toContain("trước");
  expect(out).toContain("sau");
  expect(other.size).toBe(0);
});
