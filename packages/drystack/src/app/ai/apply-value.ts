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
      // `fields.content`'s form value is a ProseMirror EditorState, not a
      // string - the only way to build one is to run the field's own parse
      // over the HTML bytes, exactly as loading from disk would.
      return field.parse(undefined, {
        content: textEncoder.encode(stripDisallowedTags(raw)),
        other: new Map(),
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
