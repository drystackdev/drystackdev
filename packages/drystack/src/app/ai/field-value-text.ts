// Reads form values back out as plain text for the prompt's context block,
// and decides whether a field counts as "already filled" for the dialog's
// default column split.

import type { ComponentSchema } from '../../form/api';
import { getInitialPropsValue } from '../../form/initial-values';

/**
 * Whether the field still holds exactly what it was born with.
 *
 * Deliberately not `!value`: `false` on a checkbox and `0` on an integer are
 * real values a person may have chosen, and treating them as blank would put
 * the field in the "fill" column and let the AI overwrite a deliberate
 * choice. Comparing against the field's own initial value is the only test
 * that holds for every kind.
 */
export function isFieldEmpty(schema: ComponentSchema, value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;

  // A checkbox or a number is never blank — it holds a definite value even at
  // its default, so it belongs in the context column, not the fill one.
  // This matters most for a `publish` checkbox: defaulting it into "fill"
  // would hand the model the decision to put a post live, which is not a
  // decision it should be making by default. Ticking it across is still
  // allowed — it just isn't the default.
  if (typeof value === 'boolean' || typeof value === 'number') return false;

  // A ProseMirror EditorState — empty when the document has no text in it.
  if (isEditorState(value)) {
    return value.doc.textContent.trim() === '';
  }

  if (typeof value === 'object') {
    // Slug pair: blank when its human-readable half is.
    if ('name' in value && 'slug' in value) {
      return String((value as any).name ?? '').trim() === '';
    }
  }

  try {
    const initial = getInitialPropsValue(schema);
    return JSON.stringify(initial) === JSON.stringify(value);
  } catch {
    // A value that can't be compared is safer treated as filled: the worst
    // case is the AI is given it as context, not that it overwrites it.
    return false;
  }
}

/**
 * Flattens a form value into text for the prompt. Returns `''` for anything
 * with no useful textual form, which the caller drops from the context block.
 */
export function fieldToContextText(
  schema: ComponentSchema,
  value: unknown
): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';

  if (isEditorState(value)) {
    // The prose itself is what gives the model context; the markup around it
    // would only spend tokens.
    return value.doc.textContent;
  }

  if (Array.isArray(value)) {
    return value
      .map(item => fieldToContextText(elementSchema(schema), item))
      .filter(Boolean)
      .join('; ');
  }

  if (typeof value === 'object') {
    if ('name' in value && 'slug' in value) return String((value as any).name ?? '');
    const fields = (schema as any)?.fields as
      | Record<string, ComponentSchema>
      | undefined;
    if (!fields) return '';
    return Object.entries(value as Record<string, unknown>)
      .map(([key, child]) =>
        fields[key] ? fieldToContextText(fields[key], child) : ''
      )
      .filter(Boolean)
      .join(', ');
  }

  return '';
}

function elementSchema(schema: ComponentSchema): ComponentSchema {
  return (schema as any)?.element ?? schema;
}

function isEditorState(value: unknown): value is { doc: { textContent: string } } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'doc' in value &&
    typeof (value as any).doc?.textContent === 'string'
  );
}
