import isEqual from "fast-deep-equal";
import { ArrayField, ComponentSchema, ObjectField } from "../../form/api";
import {
  FieldChange,
  prettifyContentHtml,
  summarizeContentChange,
} from "./ChangePreviewDialog";
import {
  getSyncableFieldKind,
  isAssetKind,
  resolveValueAtFieldPath,
  spliceValueEdit,
} from "../edit-sync";
import type { ContentSummary } from "../../form/fields/content";

const textDecoder = new TextDecoder();

// A content field's form value is a ProseMirror editor state; its serialize()
// hands back the { wordCount, charCount } summary as `value` (the HTML body
// goes to `content`), which is exactly what the dialog shows. Undefined for a
// field the entry hasn't got a value for yet.
// A non-inline content field's serialize() hands back the { wordCount,
// charCount } summary here; an inline one (no separate .html file) hands
// back the raw HTML string instead - summarizeContentChange accepts either.
function contentSummaryOf(
  fieldSchema: ComponentSchema,
  value: unknown,
): ContentSummary | string | undefined {
  if (value === undefined || value === null) return undefined;
  const serialize = (
    fieldSchema as unknown as {
      serialize(v: unknown): { value: unknown };
    }
  ).serialize;
  return serialize(value).value as ContentSummary | string;
}

// The same serialize() call's other half - the real HTML body, for the diff
// view (see FieldChange.diffBefore/diffAfter). A non-inline field's body
// comes back as `content` bytes; an inline field has no separate file, so
// its body is `value` itself (a raw HTML string).
function contentHtmlOf(
  fieldSchema: ComponentSchema,
  value: unknown,
): string | undefined {
  if (value === undefined || value === null) return undefined;
  const serialize = (
    fieldSchema as unknown as {
      serialize(v: unknown): { value: unknown; content?: Uint8Array };
    }
  ).serialize;
  const out = serialize(value);
  if (out.content !== undefined) return textDecoder.decode(out.content);
  return typeof out.value === "string" ? out.value : undefined;
}

function stringifyFieldValue(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

// Walks one field at any depth, recursing into array/object containers down
// to their leaf fields instead of stopping at the top level - the visual
// editor's own review dialog (Toolbar.tsx's getPendingChanges) already shows
// one row per leaf (it binds DOM spots that deep), so this mirrors that
// granularity via dotted keys ("cards.0.title") rather than falling back to
// a whole-container JSON diff, which used to be the only option here and
// read as an unreviewable wall of text for any edit inside a nested field.
// `sublabel` carries the dotted path once nested, since two same-named
// leaves in different array items (two cards' "Title") would otherwise be
// indistinguishable rows.
function walk(
  path: string,
  label: string,
  fieldSchema: ComponentSchema,
  before: unknown,
  after: unknown,
  changes: FieldChange[],
  stringFormatter?: Parameters<typeof summarizeContentChange>[1],
): void {
  if (isEqual(before, after)) return;
  const kind = getSyncableFieldKind(fieldSchema);
  const sublabel = path.includes(".") ? path : undefined;

  if (kind === "content") {
    changes.push({
      key: path,
      label,
      sublabel,
      kind: "text",
      before: summarizeContentChange(
        contentSummaryOf(fieldSchema, before),
        stringFormatter,
      ),
      after: summarizeContentChange(
        contentSummaryOf(fieldSchema, after),
        stringFormatter,
      ),
      diffBefore: prettifyContentHtml(contentHtmlOf(fieldSchema, before) ?? ""),
      diffAfter: prettifyContentHtml(contentHtmlOf(fieldSchema, after) ?? ""),
    });
    return;
  }

  if (kind === "object") {
    const beforeObj =
      before && typeof before === "object" && !Array.isArray(before)
        ? (before as Record<string, unknown>)
        : {};
    const afterObj =
      after && typeof after === "object" && !Array.isArray(after)
        ? (after as Record<string, unknown>)
        : {};
    for (const [seg, subSchema] of Object.entries(
      (fieldSchema as ObjectField).fields,
    )) {
      walk(
        `${path}.${seg}`,
        (subSchema as { label?: string }).label ?? seg,
        subSchema,
        beforeObj[seg],
        afterObj[seg],
        changes,
        stringFormatter,
      );
    }
    return;
  }

  if (kind === "array") {
    const element = (fieldSchema as ArrayField<ComponentSchema>).element;
    const elementLabel = (element as { label?: string }).label ?? label;
    const beforeArr = Array.isArray(before) ? before : [];
    const afterArr = Array.isArray(after) ? after : [];
    const len = Math.max(beforeArr.length, afterArr.length);
    for (let i = 0; i < len; i++) {
      walk(
        `${path}.${i}`,
        elementLabel,
        element,
        beforeArr[i],
        afterArr[i],
        changes,
        stringFormatter,
      );
    }
    return;
  }

  const columnKind =
    fieldSchema.kind === "form"
      ? (fieldSchema as { columnKind?: string }).columnKind
      : undefined;
  const rowKind: FieldChange["kind"] = isAssetKind(columnKind)
    ? columnKind
    : "text";
  changes.push({
    key: path,
    label,
    sublabel,
    kind: rowKind,
    before: stringifyFieldValue(before),
    after: stringifyFieldValue(after),
  });
}

// Walks the entry's own fields, recursing into nested array/object fields
// down to their leaf fields (see `walk` above) - kept identical to how the
// visual editor's Toolbar.tsx computes its own pending-changes list so the
// two review dialogs never disagree about what changed for the same edit.
export function computeFieldChanges(
  schema: ObjectField<Record<string, ComponentSchema>>,
  initialState: Record<string, unknown> | null,
  state: Record<string, unknown>,
  stringFormatter?: Parameters<typeof summarizeContentChange>[1],
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [key, field] of Object.entries(schema.fields)) {
    const before = initialState ? initialState[key] : undefined;
    const after = state[key];
    const label = (field as { label?: string }).label ?? key;
    walk(key, label, field, before, after, changes, stringFormatter);
  }
  return changes;
}

// Reverts a single FieldChange row (identified by its possibly-nested dotted
// `key`, e.g. "cards.0.title") back to its original value within `state`,
// without disturbing any other pending edit to the same top-level field.
// Shared by ItemPage.tsx and SingletonPage.tsx's `onRevertField`, which used
// to only handle a bare top-level key - a leftover from before this file
// started emitting nested keys.
export function revertFieldAtKey(
  schema: ObjectField<Record<string, ComponentSchema>>,
  state: Record<string, unknown>,
  resetState: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  const [baseField, ...rest] = key.split(".");
  if (rest.length === 0) {
    return { ...state, [baseField]: resetState[baseField] };
  }
  const baseSchema = schema.fields[baseField];
  if (!baseSchema) return state;
  const resetLeaf = resolveValueAtFieldPath(
    resetState[baseField],
    rest.join("."),
  );
  return {
    ...state,
    [baseField]: spliceValueEdit(state[baseField], rest, baseSchema, () => resetLeaf),
  };
}
