// Describes a drystack schema to the model, and maps what comes back onto
// form values. Shared by the API route (which builds the prompt and validates
// the request) and the admin UI (which lists fields in the dialog and applies
// the stream) - keeping one module means the prompt can never describe a
// field the apply step doesn't understand.

import type { ComponentSchema } from "../../form/api";
import { isContentEditorField } from "../../form/fields/content/is-content-field";

// The kinds the AI is allowed to fill. Anything not on this list is invisible
// to the feature: it appears in neither dialog column and is never described
// to the model.
export type AiFieldKind =
  | "text"
  | "slug"
  | "content"
  | "select"
  | "multiselect"
  | "array"
  | "object";

export type AiFieldSpec = {
  /** key within its parent object; the path is built by the caller */
  key: string;
  kind: AiFieldKind;
  label: string;
  description?: string;
  multiline?: boolean;
  isRequired?: boolean;
  /** select/multiselect: the only values the model may choose from */
  options?: readonly string[];
  /** content: the tags the editor will keep */
  htmlTags?: readonly string[];
  /** array: the shape of one element */
  element?: AiFieldSpec;
  /** object: its child fields */
  children?: AiFieldSpec[];
};

// Fields the AI has no business filling. Excluded from both dialog columns -
// not merely from generation - since showing a checkbox that can't do
// anything is worse than showing nothing.
//
// Two reasons land a kind here:
//   - assets/references: the model can't invent file bytes, and can't know
//     which entries exist to point at;
//   - data values (date, checkbox, number, url): these aren't prose. A
//     publish date, an on/off flag or a link is a fact about the entry that
//     the model would have to invent, and an invented one looks exactly like
//     a real one.
const UNSUPPORTED_COLUMN_KINDS = new Set([
  "image",
  "file",
  "files",
  "relationship",
  "multiRelationship",
  "date",
  "checkbox",
  "number",
  "url",
]);

type AnyField = ComponentSchema & {
  label?: string;
  columnKind?: string;
  aiMeta?: {
    description?: string;
    multiline?: boolean;
    isRequired?: boolean;
    htmlTags?: readonly string[];
  };
  options?: readonly { label: string; value: string }[];
  timestamp?: "created" | "updated";
};

/**
 * Builds a spec for one field, or `undefined` when the AI can't handle it.
 * Recurses through object/array so nesting (array > object > array) is
 * described in full.
 */
export function describeField(
  key: string,
  schema: ComponentSchema,
): AiFieldSpec | undefined {
  const field = schema as AnyField;

  if (field.kind === "object") {
    const children = describeFields(field.fields);
    if (!children.length) return undefined;
    return {
      key,
      kind: "object",
      label: (field as any).label ?? key,
      description: (field as any).description,
      children,
    };
  }

  if (field.kind === "array") {
    const element = describeField(key, field.element as ComponentSchema);
    if (!element) return undefined;
    return {
      key,
      kind: "array",
      label: (field as any).label ?? key,
      description: (field as any).description,
      element,
    };
  }

  if (field.kind !== "form") return undefined;

  // Stamped by the save pipeline (stampTimestamps in app/updating.tsx), never
  // by a person - so never by the AI either.
  if (field.timestamp) return undefined;

  const meta = field.aiMeta;

  if (isContentEditorField(schema)) {
    return {
      key,
      kind: "content",
      label: field.label ?? key,
      description: meta?.description,
      htmlTags: meta?.htmlTags,
    };
  }

  // Every remaining assets/asset field is an image/file picker.
  if (field.formKind === "assets" || field.formKind === "asset") {
    return undefined;
  }

  if (field.formKind === "slug") {
    // `fields.text` and `fields.slug` share formKind: 'slug'; only the latter
    // holds a {name, slug} pair, and only it exposes the `slugify` generator.
    //
    // Their default values would tell them apart too, but calling
    // `defaultValue()` is not an option here: this module runs server-side,
    // where `#field-ui/*` resolves to the react-server build and the slug
    // field's generator throws on call. Probing the shape would silently
    // misclassify every slug field as plain text.
    return {
      key,
      kind: typeof (field as any).slugify === "function" ? "slug" : "text",
      label: field.label ?? key,
      description: meta?.description,
      multiline: meta?.multiline,
      isRequired: meta?.isRequired,
    };
  }

  if (field.formKind !== undefined) return undefined;

  if (field.columnKind && UNSUPPORTED_COLUMN_KINDS.has(field.columnKind)) {
    return undefined;
  }

  const base = {
    key,
    label: field.label ?? key,
    description: meta?.description,
    isRequired: meta?.isRequired,
  };

  switch (field.columnKind) {
    case "select":
      return {
        ...base,
        kind: "select",
        options: field.options?.map((o) => o.value) ?? [],
      };
    case "multiselect":
      return {
        ...base,
        kind: "multiselect",
        options: field.options?.map((o) => o.value) ?? [],
      };
    default:
      // Either a basic field with no columnKind hint - without one there's
      // nothing that says what its value means, so it stays out rather than
      // being guessed at - or one of UNSUPPORTED_COLUMN_KINDS, already
      // rejected above.
      return undefined;
  }
}

export function describeFields(
  schema: Record<string, ComponentSchema>,
): AiFieldSpec[] {
  const specs: AiFieldSpec[] = [];
  for (const [key, field] of Object.entries(schema)) {
    const spec = describeField(key, field);
    if (spec) specs.push(spec);
  }
  return specs;
}

// Prompt rendering
// ----------------------------------------------------------------------------

const KIND_LABELS: Record<AiFieldKind, string> = {
  text: "văn bản ngắn",
  slug: "văn bản ngắn (tiêu đề)",
  content: "HTML",
  select: "chọn một",
  multiselect: "chọn nhiều",
  array: "danh sách",
  object: "nhóm",
};

function annotation(spec: AiFieldSpec, sizeWords?: string): string {
  const parts: string[] = [];
  if (spec.kind === "text" && spec.multiline) parts.push("văn bản nhiều dòng");
  else if (spec.kind === "content") {
    parts.push(`HTML, chỉ dùng các thẻ: ${(spec.htmlTags ?? []).join(", ")}`);
    // Stated per field rather than once in the rules: each content target
    // carries its own length, so a single global sentence could only ever be
    // right about one of them.
    if (sizeWords) parts.push(`độ dài: ${sizeWords}`);
  } else parts.push(KIND_LABELS[spec.kind]);

  if (spec.options?.length)
    parts.push(`giá trị hợp lệ: ${spec.options.join(" | ")}`);
  if (spec.isRequired) parts.push("bắt buộc");
  return parts.join(", ");
}

/**
 * Renders the skeleton the model fills in. The *order* of these lines is load
 * bearing: the streaming parser on the client decides a field is finished
 * only when it sees the next one start, so the prompt tells the model to keep
 * this exact order (see buildSystemPrompt).
 *
 * `sizeWords` holds each content target's length target, keyed by field key.
 */
export function renderSkeleton(
  specs: AiFieldSpec[],
  sizeWords?: Record<string, string>,
): string {
  return renderLines(specs, "", sizeWords);
}

function renderLines(
  specs: AiFieldSpec[],
  indent: string,
  // Applied at the top level only: sizes are chosen per target in the dialog,
  // and a nested field that happens to share a key with one is not that target.
  sizeWords: Record<string, string> | undefined,
): string {
  const lines: string[] = [];
  for (const spec of specs) {
    const desc = spec.description ? ` — ${spec.description}` : "";

    if (spec.kind === "object") {
      lines.push(`${indent}${spec.key} (nhóm, gồm): ${spec.label}${desc}`);
      lines.push(renderLines(spec.children ?? [], `${indent}  `, undefined));
      continue;
    }

    if (spec.kind === "array") {
      const element = spec.element!;
      if (element.kind === "object") {
        lines.push(
          `${indent}${spec.key} (danh sách các mục, mỗi mục gồm): ${spec.label}${desc}`,
        );
        lines.push(
          renderLines(element.children ?? [], `${indent}  `, undefined),
        );
      } else {
        lines.push(
          `${indent}${spec.key} (danh sách ${annotation(element)}): ${spec.label}${desc}`,
        );
      }
      continue;
    }

    lines.push(
      `${indent}${spec.key} (${annotation(spec, sizeWords?.[spec.key])}): ${spec.label}${desc}`,
    );
  }
  return lines.filter(Boolean).join("\n");
}
