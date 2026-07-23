import type { ComponentSchema } from '../../api';

// identifies the HTML rich-text `fields.content` field (as opposed to plain
// image/file assets fields) so `entryLayout: 'content'` can auto-select it as
// the main content pane. see `htmlContentEditor` in AssetsFormField and the
// marker set in `content/index.tsx`.
//
// kept in its own UI-free module so consumers (e.g. the entry form layout) can
// import it without pulling in the editor bundle.
export function isContentEditorField(field: ComponentSchema): boolean {
  return (
    field.kind === 'form' &&
    field.formKind === 'assets' &&
    field.htmlContentEditor === true
  );
}

// The top-level (not nested in an object/array) content fields of a
// singleton/collection's own schema - the only fields the "Import content"
// picker (app/content-ref) offers as a source, per its no-nested-imports,
// top-level-only scope.
export function listTopLevelContentFields(
  schema: Record<string, ComponentSchema>,
): string[] {
  return Object.keys(schema).filter((key) => isContentEditorField(schema[key]));
}
