import { Node, NodeType } from "prosemirror-model";
import { Plugin } from "prosemirror-state";

// Non-textblock last nodes (table, horizontal_rule, atom block components,
// ...) leave no clickable space below them - clicking past the end of the
// document doesn't resolve to any position, since there's no textblock
// there to land in. Guaranteeing the doc always ends with an (empty)
// paragraph gives the user a place to click/type below any such block.
function needsTrailingParagraph(doc: Node, paragraphType: NodeType) {
  const last = doc.lastChild;
  return !!last && last.type !== paragraphType;
}

export function trailingParagraph(paragraphType: NodeType) {
  return new Plugin({
    appendTransaction(_transactions, _oldState, newState) {
      if (!needsTrailingParagraph(newState.doc, paragraphType)) return null;
      return newState.tr.insert(
        newState.doc.content.size,
        paragraphType.create(),
      );
    },
    view(editorView) {
      // `appendTransaction` only runs in response to a dispatched
      // transaction - a document loaded straight from storage that already
      // ends in a table won't get fixed up until something else happens to
      // trigger one. Nudge a transaction through once at startup instead.
      if (needsTrailingParagraph(editorView.state.doc, paragraphType)) {
        Promise.resolve().then(() => {
          if (editorView.isDestroyed) return;
          const { state } = editorView;
          if (!needsTrailingParagraph(state.doc, paragraphType)) return;
          editorView.dispatch(
            state.tr.insert(state.doc.content.size, paragraphType.create()),
          );
        });
      }
      return {};
    },
  });
}
