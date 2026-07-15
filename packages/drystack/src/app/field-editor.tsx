// Re-exports the pieces of the admin's field-editor engine needed to render
// the exact admin UI for one field's value outside of a full entry form —
// used by the visual editor's array-field dialog
// (packages/astro/src/editor/Toolbar.tsx) so editing a fields.array from the
// live site gets the same Add/Edit/Reorder/Delete UI as the admin, instead of
// a bespoke reimplementation. See plan/vei-array-object.md.
export { createGetPreviewProps } from '../form/preview-props';
export { FormValueContentFromPreviewProps } from '../form/form-from-preview';
export { clientSideValidateProp } from '../form/errors';
export { ArrayFieldListView } from '../form/fields/array/ui';
export { valueToUpdater } from '../form/get-value';
// Scopes the admin's ImageFieldInput/FileFieldInput "this entry's assets" tab
// to a singleton's own directory — without it those inputs fall back to
// library-only picking (see entry-form.tsx / form/fields/image/ui.tsx).
export { EntryDirectoryProvider } from './entry-form';
