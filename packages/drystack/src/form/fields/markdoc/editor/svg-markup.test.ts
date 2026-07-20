/** @jest-environment node */
import { GlobalRegistrator } from "@happy-dom/global-registrator";
GlobalRegistrator.register();

import { afterAll, expect, test } from "@jest/globals";
import {
  applySvgLayout,
  sanitizeSvgElement,
  sanitizeSvgMarkup,
  SVG_NAMESPACE,
  svgLayoutFromElement,
  svgNaturalRatio,
} from "./svg-markup";

// See apply-value.test.ts's afterAll for why this matters.
afterAll(async () => {
  await GlobalRegistrator.unregister();
});

function parseSvg(markup: string): Element {
  return new DOMParser()
    .parseFromString(markup, "text/html")
    .body.querySelector("svg")!;
}

test("keeps a well-formed drawing, and declares the namespace", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 10 10"><title>Doanh thu</title><rect width="10" height="10" fill="currentColor"/></svg>',
  )!;
  expect(out).toContain("<rect");
  expect(out).toContain('fill="currentColor"');
  expect(out).toContain('viewBox="0 0 10 10"');
  expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
});

test("drops script, style and foreignObject", () => {
  // Built element-by-element rather than parsed from a string: happy-dom's
  // parser discards everything after a `<script>` inside an `<svg>` (a real
  // browser keeps it), which would make this pass without the sanitizer doing
  // anything. Going through the DOM directly tests the scrubbing itself, and
  // matches how the sanitizer is actually called - on a live element.
  const doc = new DOMParser().parseFromString(
    '<svg viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
    "text/html",
  );
  const svg = doc.body.querySelector("svg")!;
  for (const [tag, text] of [
    ["script", "steal()"],
    ["style", "body{display:none}"],
    ["foreignObject", "xin chào"],
  ]) {
    const el = doc.createElementNS(SVG_NAMESPACE, tag);
    el.textContent = text;
    svg.appendChild(el);
  }

  const out = sanitizeSvgElement(svg)!;
  expect(out).toContain("<rect");
  expect(out).not.toContain("script");
  expect(out).not.toContain("steal()");
  expect(out).not.toContain("<style");
  expect(out).not.toContain("foreignObject");
  // The caller's element is left as it was - only the clone is scrubbed.
  expect(svg.children).toHaveLength(4);
});

test("strips event handlers, keeping the element they were on", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 10 10"><rect width="10" height="10" onclick="steal()" onload="x()" fill="red"/></svg>',
  )!;
  expect(out).toContain("<rect");
  expect(out).toContain('fill="red"');
  expect(out).not.toContain("onclick");
  expect(out).not.toContain("onload");
});

test("allows same-document fragment refs but not external ones", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 10 10">' +
      '<defs><linearGradient id="g"><stop offset="0" stop-color="currentColor"/></linearGradient></defs>' +
      '<use href="#g"/>' +
      '<use href="https://example.com/evil.svg#x"/>' +
      '<rect width="10" height="10" fill="url(#g)"/>' +
      "</svg>",
  )!;
  expect(out).toContain("linearGradient");
  expect(out).toContain('href="#g"');
  expect(out).not.toContain("example.com");
});

test("rejects a style attribute that reaches outside the document", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 10 10"><rect style="fill:url(https://evil.test/x)" width="10" height="10"/></svg>',
  )!;
  expect(out).toContain("<rect");
  expect(out).not.toContain("evil.test");
});

// The regression these guard: SVG's initial `fill` is black, so a `<text>`
// label with no fill of its own ignored the theme entirely and vanished on a
// dark background.

test("text with no colour of its own gets an explicit currentColor", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 100 50"><text x="5" y="40">Tháng 1</text></svg>',
  )!;
  // On the element itself, not merely inherited from the root - a label's
  // colour has to survive the drawing being copied or re-nested.
  expect(out).toContain('<text x="5" y="40" fill="currentColor">');
});

test("text keeps a colour it states itself", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 100 50"><text x="5" y="40" fill="#e11">cảnh báo</text></svg>',
  )!;
  expect(out).toContain('fill="#e11"');
  expect(out).not.toMatch(/<text[^>]*currentColor/);
});

test("text keeps a colour an ancestor states for it", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 100 50"><g fill="#e11"><text x="5" y="40">cảnh báo</text></g></svg>',
  )!;
  expect(out).toContain('<g fill="#e11">');
  // Left to inherit the group's colour, which is the author's clear intent.
  expect(out).not.toMatch(/<text[^>]*fill=/);
});

test("a fill stated via inline style counts as stated", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 100 50"><text x="5" y="40" style="fill:#e11">cảnh báo</text></svg>',
  )!;
  expect(out).not.toMatch(/<text[^>]*fill="currentColor"/);
});

test("shapes fall back to the root's currentColor, keeping their own when set", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 100 50"><rect width="10" height="10" fill="#e11"/><rect width="10" height="10"/></svg>',
  )!;
  expect(out).toContain('fill="#e11"');
  expect(out).toMatch(/<svg[^>]*fill="currentColor"/);
});

test("a root fill the author chose is left alone", () => {
  const out = sanitizeSvgMarkup(
    '<svg viewBox="0 0 100 50" fill="#333"><text x="5" y="40">Tháng 1</text></svg>',
  )!;
  expect(out).toContain('fill="#333"');
  expect(out).not.toContain("currentColor");
});

test("returns null for input that isn't a drawing at all", () => {
  expect(sanitizeSvgMarkup("<p>chỉ là chữ</p>")).toBe(null);
  expect(sanitizeSvgMarkup("")).toBe(null);
});

test("layout round-trips through the root tag", () => {
  const markup = sanitizeSvgMarkup(
    '<svg viewBox="0 0 300 150"><rect width="300" height="150"/></svg>',
  )!;

  const withLayout = applySvgLayout(markup, {
    width: 240,
    height: 120,
    align: "left",
  });
  expect(withLayout).toContain("width:240px");
  expect(withLayout).toContain("float:left");
  expect(withLayout).toContain('data-align="left"');
  // Unconditional, so a chart's intrinsic width can't overflow a narrow column.
  expect(withLayout).toContain("max-width:100%");
  // The drawing itself is untouched - only the opening tag is rewritten.
  expect(withLayout).toContain('<rect width="300" height="150">');

  const readBack = svgLayoutFromElement(parseSvg(withLayout));
  expect(readBack).toEqual({ width: 240, height: 120, align: "left" });
});

test("re-applying layout replaces the previous copy rather than stacking one", () => {
  const markup = sanitizeSvgMarkup('<svg viewBox="0 0 10 10"><rect/></svg>')!;
  const once = applySvgLayout(markup, {
    width: 100,
    height: null,
    align: "right",
  });
  const twice = applySvgLayout(once, {
    width: 200,
    height: null,
    align: null,
  });

  expect(twice.match(/style=/g)).toHaveLength(1);
  expect(twice).toContain("width:200px");
  expect(twice).not.toContain("width:100px");
  expect(twice).not.toContain("data-align");
});

test("intrinsic width/height attributes are not read as layout", () => {
  // Every AI-drawn chart carries these; treating them as an author's chosen
  // size would pin the drawing to a fixed box the moment it was parsed.
  const el = parseSvg('<svg viewBox="0 0 600 300" width="600" height="300"/>');
  expect(svgLayoutFromElement(el)).toEqual({
    width: null,
    height: null,
    align: null,
  });
});

test("natural ratio comes from viewBox, falling back to width/height", () => {
  expect(svgNaturalRatio('<svg viewBox="0 0 300 150"></svg>')).toBe(2);
  expect(svgNaturalRatio('<svg width="400" height="100"></svg>')).toBe(4);
  expect(svgNaturalRatio("<svg></svg>")).toBe(null);
});
