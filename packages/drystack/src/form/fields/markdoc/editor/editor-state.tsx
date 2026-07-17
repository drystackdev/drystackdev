import { history } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { Mark, Node } from "prosemirror-model";
import { EditorState, Selection } from "prosemirror-state";
import { tableEditing } from "prosemirror-tables";

import { tokenSchema } from "@keystar/ui/style";
import { SCHEME_AUTO, THEME_DEFAULT } from "@keystar/ui/primitives";

import { aiRewriteDecoration } from "./ai-rewrite";
import { autocompleteDecoration } from "./autocomplete/decoration";
import { blockHandle } from "./block-handle";
import { codeBlockSyntaxHighlighting } from "./code-block-highlighting";
import { keymapForSchema } from "./commands/keymap";
import { containerDragHandle } from "./container-drag-handle";
import { dropCursor } from "./dropcursor";
import { gapCursor } from "./gapcursor";
import { imageDropPlugin } from "./images";
import { inputRules } from "./inputrules/inputrules";
import {
  enterInputRulesForSchema,
  inputRulesForSchema,
} from "./inputrules/rules";
import { keydownHandler } from "./keydown";
import { pasteLinks } from "./links";
import { markdocClipboard } from "./markdoc/clipboard";
import { nodeInSelectionDecorations } from "./node-in-selection";
import { placeholderPlugin } from "./placeholder";
import { tableCellFocusHighlight } from "./popovers/table";
import { reactNodeViews } from "./react-node-views";
import { getEditorSchema } from "./schema";
import { tableColumnResizing } from "./table-column-resize";
import { tableRowResizing } from "./table-row-resize";
import { trailingParagraph } from "./trailing-paragraph";
import { ySyncPlugin, yCursorPlugin, yUndoPlugin } from "y-prosemirror";
import { Awareness } from "y-protocols/awareness.js";
import * as Y from "yjs";

const cursorBuilder = (user: any) => {
  const cursor = document.createElement("span");
  cursor.classList.add("ProseMirror-yjs-cursor");
  cursor.style.borderColor = user.color;
  const userDiv = document.createElement("div");
  userDiv.style.backgroundColor = user.color;
  userDiv.insertBefore(document.createTextNode(user.name), null);
  cursor.insertBefore(userDiv, null);
  return cursor;
};

export function createEditorState(
  doc: Node,
  selection?: Selection,
  storedMarks?: readonly Mark[] | null,
  yXmlFragment?: Y.XmlFragment,
  awareness?: Awareness,
) {
  const schema = getEditorSchema(doc.type.schema);
  return EditorState.create({
    selection,
    storedMarks,
    plugins: [
      pasteLinks(schema),
      imageDropPlugin(schema),
      keydownHandler(),
      ...(yXmlFragment && awareness
        ? [
            ySyncPlugin(yXmlFragment),
            yCursorPlugin(awareness, {
              cursorBuilder,
              awarenessStateFilter(userClientId, clientId, awarenessState) {
                const localState = awareness.getLocalState();
                return (
                  userClientId !== clientId &&
                  awarenessState.location === localState?.location &&
                  awarenessState.branch === localState?.branch
                );
              },
            }),
            yUndoPlugin(),
          ]
        : [history()]),
      dropCursor({
        color: tokenSchema.color.alias.borderSelected,
        width: 2,
        // The cursor element is appended to `editorView.dom.offsetParent`, which
        // for the inline visual editor is a live-page ancestor outside the
        // Keystar token scope - so its `--kui-*`-based colour (and the block
        // dropcursor's ::before/::after circles) would resolve to nothing and
        // the bar would be invisible. Carrying the token+scheme classes on the
        // element itself makes the vars resolve wherever it lands. Harmless in
        // the admin editor, where the offsetParent is already token-scoped.
        class: `${THEME_DEFAULT} ${SCHEME_AUTO}`,
      }),
      blockHandle(),
      // the other half of the drag story: `blockHandle` picks up the block a
      // press lands on, which inside a table/grid is always a block *within* a
      // cell - this grips the container itself
      containerDragHandle(),
      inputRules({
        rules: inputRulesForSchema(schema),
        enterRules: enterInputRulesForSchema(schema),
      }),
      gapCursor(),
      keymap(keymapForSchema(schema, !!(yXmlFragment && awareness))),
      markdocClipboard(),
      nodeInSelectionDecorations(),
      placeholderPlugin('Start writing or press "/" for commands…'),
      reactNodeViews(doc.type.schema),
      autocompleteDecoration(),
      // Inert until an AI rewrite is in flight, so the fields that never
      // offer one (markdoc, mdx) carry nothing but an idle plugin.
      aiRewriteDecoration(),
      tableColumnResizing(),
      tableRowResizing(),
      tableEditing(),
      tableCellFocusHighlight(),
      codeBlockSyntaxHighlighting(),
      trailingParagraph(doc.type.schema.nodes.paragraph),
    ],
    doc,
  });
}
