import isEqual from 'fast-deep-equal';
import { ComponentSchema, ObjectField } from '../../form/api';
import { FieldChange } from './ChangePreviewDialog';

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
// shape. Non-string values (arrays, objects, the rich-text `content` field)
// fall back to a pretty-printed JSON diff via stringifyFieldValue.
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
    const kind: FieldChange['kind'] =
      field.kind === 'form' &&
      (field as { columnKind?: string }).columnKind === 'image'
        ? 'image'
        : 'text';
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
