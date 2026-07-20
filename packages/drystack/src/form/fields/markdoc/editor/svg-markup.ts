// Helpers for the editor's inline `svg` node.
//
// Unlike the `image` node - which references bytes through a `src` - an svg
// node keeps the markup itself in the document and writes it back verbatim, so
// the published page can style it with the site's own CSS (`currentColor`,
// theme custom properties, dark mode). None of that reaches an `<img>` pointing
// at a `.svg` file: the referenced document is its own isolated tree that the
// host page's stylesheet can't touch, which is exactly why AI-drawn charts
// looked foreign before this node existed.
//
// The flip side of putting markup inline is that it stops being inert. An
// `<img src="chart.svg">` can't run script; the same bytes pasted straight into
// the page can. So every path that builds an svg node funnels through
// `sanitizeSvgElement`/`sanitizeSvgMarkup` below - html/parse.ts reading stored
// HTML, the node spec's `parseDOM` handling a paste, the popover's edit dialog -
// and the node only ever holds markup that came out the other side.

import {
  ImageAlign,
  ImageLayoutAttrs,
  imageLayoutStyleEntries,
  normalizeImageAlign,
  parseImageSize,
} from "./image-layout";

export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

// What the insert-menu item drops in, before the author replaces it with their
// own drawing via the node's edit dialog. Painted entirely in `currentColor`
// so the very first thing anyone sees of this node is it picking up the theme
// around it - which is the whole reason the markup lives inline.
export const PLACEHOLDER_SVG_MARKUP =
  `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 320 180" width="320" height="180" role="img">` +
  `<rect x="1" y="1" width="318" height="178" rx="8" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-dasharray="6 6" opacity="0.4"/>` +
  `<text x="160" y="96" text-anchor="middle" fill="currentColor" opacity="0.6" ` +
  `font-family="sans-serif" font-size="16">SVG</text>` +
  `</svg>`;

// A drawing vocabulary, deliberately not the whole SVG spec. Shapes, text,
// grouping and paint servers cover every chart/diagram this feature exists for;
// everything absent is dropped rather than escaped, so growing the list is a
// conscious decision rather than the default.
//
// Notably absent, and why:
// - `script`, `foreignObject`: arbitrary script / arbitrary HTML.
// - `style`: CSS inside an *inline* svg is not scoped to it - the rules apply
//   to the whole host document, so one chart could restyle the page around it.
//   Presentation attributes and `style="…"` on an element do the same job
//   without escaping the element.
// - `image`: pulls in external bytes we don't control and can't ship on save.
// - `animate*`/`set`: SMIL is a scripting-adjacent surface with no payoff here.
const ALLOWED_TAGS = new Set(
  [
    "svg",
    "g",
    "defs",
    "symbol",
    "use",
    "title",
    "desc",
    "path",
    "rect",
    "circle",
    "ellipse",
    "line",
    "polyline",
    "polygon",
    "text",
    "tspan",
    "textPath",
    "linearGradient",
    "radialGradient",
    "stop",
    "pattern",
    "clipPath",
    "mask",
    "marker",
  ].map((tag) => tag.toLowerCase()),
);

// Attributes that name a resource rather than describe paint/geometry. Only
// same-document fragments (`#gradient-1`) survive; anything else would make the
// published page fetch something that isn't in the repo.
const URL_ATTRIBUTES = new Set(["href", "xlink:href", "src"]);

// Rejected wholesale inside a `style="…"` value: `url(…)` reaches outside the
// document the same way `href` does, and the other two are legacy script
// vectors that some engines still honour.
const UNSAFE_STYLE = /url\s*\(|expression\s*\(|javascript\s*:/i;

// Guards against a single pasted (or hallucinated) drawing bloating an entry's
// HTML file. Charts this feature produces run a few KB; anything past this is
// not something a person meant to inline into prose.
const MAX_SVG_BYTES = 256 * 1024;

function isAllowedAttribute(name: string, value: string): boolean {
  const lower = name.toLowerCase();
  // Event handlers - the whole reason this allowlist exists.
  if (lower.startsWith("on")) return false;
  if (URL_ATTRIBUTES.has(lower)) return value.trim().startsWith("#");
  if (lower === "style") return !UNSAFE_STYLE.test(value);
  return true;
}

// Strips everything outside the allowlist from `el` (mutating it) and reports
// whether anything usable is left. Depth-first and iterating over a snapshot of
// the children, because removing during a live-collection walk skips siblings.
function scrubElement(el: Element): void {
  for (const attr of Array.from(el.attributes)) {
    if (!isAllowedAttribute(attr.name, attr.value)) {
      el.removeAttribute(attr.name);
    }
  }
  for (const child of Array.from(el.children)) {
    if (!ALLOWED_TAGS.has(child.tagName.toLowerCase())) {
      child.remove();
      continue;
    }
    scrubElement(child);
  }
}

/**
 * Sanitizes an `<svg>` element into the markup string an svg node holds, or
 * returns null when there's nothing worth keeping. Takes an `Element` rather
 * than a string because every caller already has one (html/parse.ts walks a
 * parsed document; `parseDOM` is handed the pasted node), so re-parsing would
 * only cost a round trip. `el` is left untouched - the scrubbing happens on a
 * clone.
 */
export function sanitizeSvgElement(el: Element): string | null {
  if (el.tagName.toLowerCase() !== "svg") return null;
  const clone = el.cloneNode(true) as Element;
  scrubElement(clone);
  // Serialized standalone, so it needs the namespace declaration even when the
  // source document supplied it implicitly (an `<svg>` in an HTML document is
  // in the SVG namespace whether or not `xmlns` was written out).
  clone.setAttribute("xmlns", SVG_NAMESPACE);
  const markup = clone.outerHTML;
  if (!markup || markup.length > MAX_SVG_BYTES) return null;
  return markup;
}

/**
 * String-in/string-out form of `sanitizeSvgElement`, for callers holding markup
 * rather than a live element (the popover's edit dialog, where the author types
 * or pastes the source directly).
 */
export function sanitizeSvgMarkup(markup: string): string | null {
  if (!markup.includes("<svg")) return null;
  const doc = new DOMParser().parseFromString(markup, "text/html");
  const el = doc.body.querySelector("svg");
  return el ? sanitizeSvgElement(el) : null;
}

// --- layout -----------------------------------------------------------------
//
// The svg node carries the same width/height/align attrs the image node does,
// persisted the same way (inline `style` + `data-align`) so both round-trip
// through one set of rules. The difference is *where* they live: an image node
// writes them onto a fresh `<img>` it builds, while an svg node has to graft
// them onto markup it's otherwise copying through untouched.

// A declaration read straight off the `style` attribute string rather than
// through `el.style`. SVG elements do expose CSSOM in browsers, but this parser
// also runs over documents from happy-dom (tests) and the visual editor's
// adopted nodes, where relying on it has bitten us before.
function styleDeclaration(el: Element, property: string): string | null {
  const style = el.getAttribute("style");
  if (!style) return null;
  for (const declaration of style.split(";")) {
    const colon = declaration.indexOf(":");
    if (colon === -1) continue;
    if (declaration.slice(0, colon).trim().toLowerCase() !== property) continue;
    return declaration.slice(colon + 1).trim();
  }
  return null;
}

/**
 * Reads an svg node's layout back off a persisted `<svg>`. Deliberately does
 * *not* fall back to the `width`/`height` presentation attributes the way
 * `imageLayoutFromElement` does: on an `<svg>` those are part of the drawing's
 * own intrinsic size (every AI-drawn chart has them), not a size the author
 * chose in the editor. Treating them as layout would pin every chart to a fixed
 * box the moment it was parsed, and defeat the `max-width` below.
 */
export function svgLayoutFromElement(el: Element): ImageLayoutAttrs {
  const width = parseImageSize(styleDeclaration(el, "width"));
  const height = parseImageSize(styleDeclaration(el, "height"));
  let align: ImageAlign | null = normalizeImageAlign(
    el.getAttribute("data-align"),
  );
  if (!align) {
    const float = styleDeclaration(el, "float");
    if (float === "left" || float === "right") align = float;
  }
  return { width, height, align };
}

/**
 * The inline `style` an svg node renders with, in the editor and on disk.
 *
 * `max-width:100%` is unconditional. A chart's intrinsic `width="600"` is a
 * drawing decision, not a layout one, and inline SVG honours it literally -
 * without this a 600px chart overflows a phone-width column. It comes paired
 * with `height:auto` whenever the author hasn't pinned a height, so a drawing
 * squeezed by that cap scales instead of letterboxing inside a box that's
 * still 300px tall.
 *
 * `object-fit` from the shared image entries is dropped: it does nothing on an
 * `<svg>` element and would just be noise in every saved file.
 */
export function svgLayoutStyleString(attrs: ImageLayoutAttrs): string {
  const entries = imageLayoutStyleEntries(attrs).filter(
    ([property]) => property !== "object-fit",
  );
  entries.push(["max-width", "100%"]);
  if (attrs.height == null) entries.push(["height", "auto"]);
  return entries.map(([key, value]) => `${key}:${value}`).join(";");
}

// Finds the end of the root `<svg …>` opening tag, honouring quoted attribute
// values so a `>` inside one (`style="content:'>'"`, a stray `>` in a `<title>`
// further down) can't cut the tag short.
function openingTagEnd(markup: string): number {
  let quote: string | null = null;
  for (let i = 0; i < markup.length; i++) {
    const char = markup[i];
    if (quote) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return i;
  }
  return -1;
}

// Drops one attribute from an opening-tag string. Used to clear the layout
// attrs we're about to rewrite, so re-serializing a node doesn't stack a second
// `style`/`data-align` next to the one it was parsed with.
function withoutAttribute(openingTag: string, name: string): string {
  return openingTag.replace(
    new RegExp(`\\s${name}\\s*=\\s*("[^"]*"|'[^']*'|[^\\s>]+)`, "gi"),
    "",
  );
}

function escapeAttributeValue(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
}

/**
 * Grafts an svg node's layout attrs onto its markup's root tag, replacing any
 * copy already there.
 *
 * String surgery rather than a DOM round trip on purpose: html/serialize.ts is
 * a pure string builder with no DOM dependency, and it runs in places that
 * don't reliably have one. The input is always markup `sanitizeSvgElement`
 * produced (a serialized DOM element), so the opening tag is well-formed and
 * its attribute values are quoted.
 */
export function applySvgLayout(
  markup: string,
  attrs: ImageLayoutAttrs,
): string {
  const end = openingTagEnd(markup);
  if (end === -1) return markup;
  // A self-closing root (`<svg … />`) has nothing to draw and can't come out of
  // `sanitizeSvgElement`, but keep the slash out of the attribute soup anyway
  // rather than emitting `… data-align="left"/>`.
  const selfClosing = markup[end - 1] === "/";
  let openingTag = markup.slice(0, selfClosing ? end - 1 : end).trimEnd();
  const rest = markup.slice(end);
  openingTag = withoutAttribute(openingTag, "style");
  openingTag = withoutAttribute(openingTag, "data-align");
  const style = svgLayoutStyleString(attrs);
  if (style) openingTag += ` style="${escapeAttributeValue(style)}"`;
  if (attrs.align) openingTag += ` data-align="${attrs.align}"`;
  return `${openingTag}${selfClosing ? " /" : ""}${rest}`;
}

/**
 * The intrinsic aspect ratio a drawing declares, for the resize handles to lock
 * to before the node has ever been measured. Read from `viewBox` first (the
 * authoritative coordinate system, and the one attribute every well-formed
 * chart has) and from `width`/`height` only as a fallback.
 */
export function svgNaturalRatio(markup: string): number | null {
  const viewBox = /\sviewBox\s*=\s*"([^"]*)"/i.exec(markup)?.[1];
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number);
    if (parts.length === 4 && parts.every(Number.isFinite)) {
      const [, , width, height] = parts;
      if (width > 0 && height > 0) return width / height;
    }
  }
  const width = parseImageSize(/\swidth\s*=\s*"([^"]*)"/i.exec(markup)?.[1]);
  const height = parseImageSize(/\sheight\s*=\s*"([^"]*)"/i.exec(markup)?.[1]);
  return width && height ? width / height : null;
}
