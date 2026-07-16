import isEqual from 'fast-deep-equal';
import { ComponentSchema, ObjectField } from '../../form/api';
import { FieldChange, summarizeContentChange } from './ChangePreviewDialog';
import { getSyncableFieldKind, isAssetKind } from '../edit-sync';
import type { ContentSummary } from '../../form/fields/content';

// A content field's form value is a ProseMirror editor state; its serialize()
// hands back the { wordCount, charCount } summary as `value` (the HTML body
// goes to `content`), which is exactly what the dialog shows. Undefined for a
// field the entry hasn't got a value for yet.
function contentSummaryOf(
  fieldSchema: ComponentSchema,
  value: unknown
): ContentSummary | undefined {
  if (value === undefined || value === null) return undefined;
  const serialize = (
    fieldSchema as unknown as {
      serialize(v: unknown): { value: unknown };
    }
  ).serialize;
  return serialize(value).value as ContentSummary;
}

function stringifyFieldValue(value: unknown): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean' || typeof value === 'number') {
    return String(value);
  }
  return JSON.stringify(value, null, 2);
}

// Top-level-only: walks the entry's own fields, not into nested
// array/object/conditional fields — good enough for a first pass at "what
// changed", and avoids having to special-case every field kind's internal
// shape. Non-string values (arrays, objects) fall back to a pretty-printed
// JSON diff via stringifyFieldValue; the rich-text `content` field is shown as
// its word/character counts instead (summarizeContentChange), since its value
// is an editor state whose JSON is neither readable nor what VEI shows.
export function computeFieldChanges(
  schema: ObjectField<Record<string, ComponentSchema>>,
  initialState: Record<string, unknown> | null,
  state: Record<string, unknown>
): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const [key, field] of Object.entries(schema.fields)) {
    const before = initialState ? initialState[key] : undefined;
    const after = state[key];
    if (isEqual(before, after)) continue;
    const label = (field as { label?: string }).label ?? key;
    // Compared above on the real values, summarized only for display — see
    // summarizeContentChange for why those must stay separate.
    if (getSyncableFieldKind(field) === 'content') {
      changes.push({
        key,
        label,
        kind: 'text',
        before: summarizeContentChange(contentSummaryOf(field, before)),
        after: summarizeContentChange(contentSummaryOf(field, after)),
      });
      continue;
    }
    const columnKind =
      field.kind === 'form'
        ? (field as { columnKind?: string }).columnKind
        : undefined;
    const kind: FieldChange['kind'] = isAssetKind(columnKind) ? columnKind : 'text';
    changes.push({
      key,
      label,
      kind,
      before: stringifyFieldValue(before),
      after: stringifyFieldValue(after),
    });
  }
  return changes;
}
