// Maps a parsed YAML value onto a drystack form value. Lives beside the
// admin app (not in api/) because the content field's conversion needs the
// editor - the API route only ever deals in YAML text.

import type { ComponentSchema } from "../../form/api";
import { getInitialPropsValue } from "../../form/initial-values";
import type { AiFieldSpec } from "../../api/ai/schema-to-yaml";

const textEncoder = new TextEncoder();

/**
 * Converts one YAML value into the form value for `schema`, or returns
 * `undefined` when the model produced something the field can't hold - a bad
 * select option, a malformed date. Returning undefined (rather than throwing)
 * keeps one bad field from discarding an otherwise good generation.
 */
export function aiValueToFormValue(
  spec: AiFieldSpec,
  schema: ComponentSchema,
  raw: unknown,
): unknown {
  switch (spec.kind) {
    case "text":
      return typeof raw === "string" ? raw : undefined;

    case "slug": {
      if (typeof raw !== "string" || !raw.trim()) return undefined;
      // The AI only writes the human-readable half; the slug comes from the
      // field's own generator, so a model that never learned Vietnamese
      // diacritic folding can't produce a broken URL.
      return { name: raw, slug: (schema as any).slugify(raw) };
    }

    case "content": {
      if (typeof raw !== "string") return undefined;
      const field = schema as any;
      const allowSvg = !!spec.htmlTags?.includes("svg");
      const { html, other } = embedSvgCharts(
        stripDisallowedTags(raw),
        allowSvg,
      );
      // `fields.content`'s form value is a ProseMirror EditorState, not a
      // string - the only way to build one is to run the field's own parse
      // over the HTML bytes, exactly as loading from disk would.
      return field.parse(undefined, {
        content: textEncoder.encode(html),
        other,
        external: new Map(),
        slug: undefined,
      });
    }

    case "select":
      return typeof raw === "string" && spec.options?.includes(raw)
        ? raw
        : undefined;

    case "multiselect": {
      if (!Array.isArray(raw)) return undefined;
      const valid = raw.filter(
        (v): v is string =>
          typeof v === "string" && !!spec.options?.includes(v),
      );
      return valid.length ? valid : undefined;
    }

    case "object": {
      if (!raw || typeof raw !== "object" || Array.isArray(raw))
        return undefined;
      const fields = (schema as any).fields as Record<string, ComponentSchema>;
      // Start from the field's own defaults so children the model skipped keep
      // valid values rather than becoming undefined.
      const out: Record<string, unknown> = getInitialPropsValue(schema) as any;
      for (const child of spec.children ?? []) {
        const childRaw = (raw as any)[child.key];
        if (childRaw === undefined) continue;
        const value = aiValueToFormValue(child, fields[child.key], childRaw);
        if (value !== undefined) out[child.key] = value;
      }
      return out;
    }

    case "array": {
      if (!Array.isArray(raw)) return undefined;
      const element = spec.element!;
      const elementSchema = (schema as any).element as ComponentSchema;
      const items = raw
        .map((item) => aiValueToFormValue(element, elementSchema, item))
        .filter((v) => v !== undefined);
      return items.length ? items : undefined;
    }

    default:
      return undefined;
  }
}

// The prompt tells the model which tags it may use, but a prompt is not a
// guarantee. `<img>` in particular has to go: a made-up src points at bytes
// that don't exist, and the editor would carry the dead reference into the
// saved HTML.
export function stripDisallowedTags(html: string): string {
  return html.replace(/<img\b[^>]*>/gi, "");
}

// A field whose `htmlTags` include `svg` (see content/index.tsx's
// allowedHtmlTags) lets the model draw simple charts itself as inline `<svg>`
// markup - unlike `<img>`, that's something the model can produce correctly,
// since it's prose-adjacent markup rather than bytes it would have to invent.
//
// Each `<svg>` found is serialized to its own bytes and handed to
// `field.parse()`'s `other` map exactly the way an uploaded image's bytes
// would be, then swapped for an `<img src="<generated filename>">`
// referencing it - the same contract `content.field.parse()` already resolves
// real images through (see html/parse.ts's `imageFromElement`), so the result
// becomes a real embedded image the moment it's parsed, no special-casing
// needed downstream (save, GitHub commit, live render all just see an image).
//
// A field that doesn't advertise `svg` (image support off, or an inline-only
// field with no `image` node at all) gets any stray `<svg>` the model emitted
// anyway removed outright - left alone, the parser's generic "unknown tag"
// handling unwraps it and leaks its shape/label text into the document as if
// it were prose.
export function embedSvgCharts(
  html: string,
  allow: boolean,
): { html: string; other: Map<string, Uint8Array> } {
  const other = new Map<string, Uint8Array>();
  // Cheap bail-out for the overwhelmingly common case (no chart requested) -
  // skips the DOM round-trip below, which would otherwise reformat the whole
  // fragment for no reason.
  if (!html.includes("<svg")) return { html, other };
  const doc = new DOMParser().parseFromString(html, "text/html");
  const svgs = Array.from(doc.body.querySelectorAll("svg"));
  if (!svgs.length) return { html, other };
  svgs.forEach((svg, i) => {
    if (!allow) {
      svg.remove();
      return;
    }
    const filename = `ai-chart-${i + 1}.svg`;
    other.set(
      filename,
      textEncoder.encode(new XMLSerializer().serializeToString(svg)),
    );
    const img = doc.createElement("img");
    img.setAttribute("src", filename);
    const alt = svg.querySelector("title")?.textContent?.trim();
    if (alt) img.setAttribute("alt", alt);
    svg.replaceWith(img);
  });
  return { html: doc.body.innerHTML, other };
}
