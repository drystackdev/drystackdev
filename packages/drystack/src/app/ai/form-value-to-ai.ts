// Renders a form value as the YAML the model is asked to continue from - the
// mirror of apply-value.ts, which maps the model's YAML back onto form values.
//
// Lives beside the admin app rather than in api/ for the same reason
// apply-value does: the content field's conversion needs the editor, and the
// API route only ever deals in YAML text. The server can't build a seed
// itself - it has no form state - so the client hands it one already rendered.

import { dump } from "js-yaml";

import type { ComponentSchema } from "../../form/api";
import type { AiFieldSpec } from "../../api/ai/schema-to-yaml";

const textDecoder = new TextDecoder();

/**
 * The YAML body of one field's current value, ready to be indented under its
 * key in the prompt's seed block. Returns `undefined` when there's nothing
 * worth seeding, which the caller drops from the request.
 */
export function seedYaml(
  spec: AiFieldSpec,
  schema: ComponentSchema,
  value: unknown,
): string | undefined {
  const plain = formValueToAiValue(spec, schema, value);
  if (plain === undefined || isEmptyStructure(plain)) return undefined;
  // `lineWidth: -1` because the model has to read this back and reproduce it:
  // js-yaml's default 80-column folding would rewrap the user's own prose into
  // continuation lines, and prose the user typed must survive the round trip
  // byte for byte.
  const yaml = dump(plain, { lineWidth: -1 }).replace(/\s+$/, "");
  return yaml || undefined;
}

/**
 * An empty list or group has nothing to continue from - and `dump` renders it
 * as a literal `[]` or `{}`, which in the prompt would read as an instruction
 * to write an empty answer rather than as the absence of a draft.
 */
function isEmptyStructure(value: unknown): boolean {
  if (Array.isArray(value)) return value.length === 0;
  if (value && typeof value === "object")
    return Object.keys(value).length === 0;
  return false;
}

/**
 * Flattens a form value into the plain JS shape the model sees as YAML.
 *
 * Kind-driven off the spec rather than the value, so what comes back out is
 * addressed by exactly the keys `renderSkeleton` told the model about.
 */
export function formValueToAiValue(
  spec: AiFieldSpec,
  schema: ComponentSchema,
  value: unknown,
): unknown {
  if (value === undefined || value === null) return undefined;

  switch (spec.kind) {
    case "text":
    case "select":
      return typeof value === "string" ? value : undefined;

    case "slug":
      // Only the human-readable half: the slug is derived by the field's own
      // generator on the way back in, so showing it here would invite the
      // model to write one.
      return typeof value === "object" && value !== null && "name" in value
        ? String((value as any).name ?? "")
        : typeof value === "string"
          ? value
          : undefined;

    case "multiselect":
      return Array.isArray(value)
        ? value.filter((v): v is string => typeof v === "string")
        : undefined;

    case "content": {
      const field = schema as any;
      if (typeof field?.serialize !== "function") return undefined;
      // The mirror of apply-value's `field.parse()`: run the field's own
      // serializer, exactly as saving to disk would, so the seed is the same
      // HTML the model is being asked to produce.
      const out = field.serialize(value, {});
      return out?.content ? textDecoder.decode(out.content) : undefined;
    }

    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) return undefined;
      const fields = (schema as any)?.fields as
        | Record<string, ComponentSchema>
        | undefined;
      if (!fields) return undefined;
      const out: Record<string, unknown> = {};
      for (const child of spec.children ?? []) {
        const childValue = formValueToAiValue(
          child,
          fields[child.key],
          (value as any)[child.key],
        );
        // Empty children are kept, not dropped: an empty string is precisely
        // the gap the model is being asked to fill, and a key that isn't there
        // reads as a key it shouldn't write.
        out[child.key] = childValue ?? "";
      }
      return out;
    }

    case "array": {
      if (!Array.isArray(value)) return undefined;
      const element = spec.element!;
      const elementSchema = (schema as any)?.element as ComponentSchema;
      if (!elementSchema) return undefined;
      return value.map((item) =>
        formValueToAiValue(element, elementSchema, item) ?? "",
      );
    }

    default:
      return undefined;
  }
}
