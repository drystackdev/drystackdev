import { EditorState } from 'prosemirror-state';

import { createEditorState } from '../markdoc/editor/editor-state';
import { EditorSchema } from '../markdoc/editor/schema';
import { htmlToProseMirror } from '../markdoc/editor/html/parse';
import { serializeFromEditorStateToHTML } from '../markdoc/editor/html/serialize';

export { createEditorSchema } from '../markdoc/editor/schema';
export { DocumentFieldInput } from '../markdoc/ui';

export function getDefaultValue(schema: EditorSchema) {
  return createEditorState(schema.nodes.doc.createAndFill()!);
}

export function parseToEditorStateHTML(
  content: string,
  schema: EditorSchema,
  other: ReadonlyMap<string, Uint8Array>
) {
  const doc = htmlToProseMirror(content, schema, other);
  return createEditorState(doc);
}

export function serializeFromEditorStateHTML(value: EditorState) {
  const other = new Map<string, Uint8Array>();
  const html = serializeFromEditorStateToHTML(value.doc, other);
  return { value: html, other };
}
