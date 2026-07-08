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
