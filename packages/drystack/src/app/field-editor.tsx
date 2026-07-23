// Re-exports the pieces of the admin's field-editor engine needed to render
// the exact admin UI for one field's value outside of a full entry form -
// used by the visual editor's array-field dialog
// (packages/astro/src/editor/Toolbar.tsx) so editing a fields.array from the
// live site gets the same Add/Edit/Reorder/Delete UI as the admin, instead of
// a bespoke reimplementation. See plan/vei-array-object.md.
export { createGetPreviewProps } from "../form/preview-props";
export { FormValueContentFromPreviewProps } from "../form/form-from-preview";
export { clientSideValidateProp } from "../form/errors";
export { ArrayFieldListView } from "../form/fields/array/ui";
export { valueToUpdater } from "../form/get-value";
// Scopes the admin's ImageFieldInput/FileFieldInput "this entry's assets" tab
// to a singleton's own directory - without it those inputs fall back to
// library-only picking (see entry-form.tsx / form/fields/image/ui.tsx).
export { EntryDirectoryProvider, CurrentEntryRefProvider } from "./entry-form";
// A fields.slug schema's own `.Input` (SlugFieldInput) only turns on its real
// uniqueness/collision-bump logic when it can see `PathContext === [the
// collection's configured slugField]` and a `SlugFieldContext` carrying real
// sibling slugs (see form/fields/text/path-slug-context.tsx and
// form/fields/slug/ui.tsx) - FormValueContentFromPreviewProps always resets
// PathContext to `[]` for its own root, which is wrong for rendering a slug
// field standalone (outside a whole entry form), so the visual editor needs
// these two providers directly to wrap just that one field itself.
export {
  PathContextProvider,
  SlugFieldProvider,
  type SlugFieldInfo,
} from "../form/fields/text/path-slug-context";
// The fields.content editor, mounted onto an element the live page already
// rendered so the site's own CSS keeps applying while editing - used by the
// visual editor's inline content spots (editor/InlineContentEditors.tsx).
export { InlineDocumentEditor } from "../form/fields/content/inline";
// What a fields.content schema's parse() returns and serialize() takes.
// Re-exported so the visual editor can type its own state handling without
// taking a direct prosemirror dependency it has no other use for.
export type { EditorState as ContentEditorState } from "prosemirror-state";
