import { setBlockType } from "prosemirror-commands";
import { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import { Command, NodeSelection } from "prosemirror-state";
import { getEditorSchema } from "../schema";
import { PLACEHOLDER_SVG_MARKUP } from "../svg-markup";

// NB: passed straight into `insertMenu.command` in several node specs, which
// calls it as `(nodeType, editorSchema)`. Any second parameter added here would
// silently be handed the whole editor schema, so keep it single-argument - a
// node needing seeded attrs should write its own command (see `svg` in
// schema.tsx).
export function insertNode(nodeType: NodeType): Command {
  return (state, dispatch) => {
    if (
      state.selection instanceof NodeSelection &&
      state.selection.node.type === nodeType
    ) {
      return false;
    }
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(nodeType.createAndFill()!));
    }
    return true;
  };
}

// Its own command rather than `insertNode`, which fills every attr from its
// default - and `markup` has none, since an empty drawing isn't a thing.
// Seeds a placeholder for the author to replace via the node's edit dialog.
// Shared by the insert-menu's "Drawing" entry (schema.tsx) and the toolbar's
// drawing button (Toolbar.tsx).
export function insertSvgDrawing(nodeType: NodeType): Command {
  return (state, dispatch) => {
    if (dispatch) {
      dispatch(
        state.tr.replaceSelectionWith(
          nodeType.createChecked({ markup: PLACEHOLDER_SVG_MARKUP }),
        ),
      );
    }
    return true;
  };
}

export function toggleCodeBlock(
  codeBlock: NodeType,
  paragraph: NodeType,
): Command {
  return (state, dispatch, view) => {
    const codeBlockPositions: [start: number, end: number][] = [];
    for (const range of state.selection.ranges) {
      state.doc.nodesBetween(range.$from.pos, range.$to.pos, (node, pos) => {
        if (node.type === codeBlock) {
          codeBlockPositions.push([pos, pos + node.nodeSize]);
        }
      });
    }
    if (!codeBlockPositions.length) {
      return setBlockType(codeBlock)(state, dispatch, view);
    }
    if (dispatch) {
      const tr = state.tr;
      for (const [start, end] of codeBlockPositions) {
        tr.setBlockType(start, end, paragraph);
      }
      dispatch(tr);
    }
    return true;
  };
}

// shared by `insertTable` (fixed 3×3, wired into the insert-menu) and
// `insertTableWithSize` (the toolbar's hover-grid picker, see Toolbar.tsx's
// `TableInsertGridPicker`) - kept out of `insertTable` itself since that one
// is called as `(nodeType, editorSchema)` by `insertMenu.command` (see the
// note above), so it can't safely grow a `rows`/`columns` parameter.
function buildTable(
  tableType: NodeType,
  rows: number,
  columns: number,
): ProseMirrorNode {
  const rowType = tableType.contentMatch.defaultType!;
  const cellType = rowType.contentMatch.defaultType!;
  const headerType = getEditorSchema(tableType.schema).nodes.table_header!;
  // give every column an explicit, equal share up front rather than
  // leaving `widthPercent` at its `null` (auto) default - see
  // resolveEffectiveColumnWidths/rebalanceColumnWidthsForInsert, which rely
  // on columns already having a real width to redistribute when a new one
  // is inserted later.
  const widthPercent = Math.round((100 / columns) * 10) / 10;
  const headerCells = Array.from({ length: columns }, () =>
    headerType.createAndFill({ widthPercent })!,
  );
  const headerRow = rowType.create(undefined, headerCells);
  const bodyRows = Array.from({ length: Math.max(rows - 1, 0) }, () => {
    const cells = Array.from({ length: columns }, () =>
      cellType.createAndFill({ widthPercent })!,
    );
    return rowType.create(undefined, cells);
  });
  return tableType.create(undefined, [headerRow, ...bodyRows]);
}

export function insertTable(tableType: NodeType): Command {
  return (state, dispatch) => {
    dispatch?.(state.tr.replaceSelectionWith(buildTable(tableType, 3, 3)));
    return true;
  };
}

// the toolbar's Word-style hover-grid picker (see Toolbar.tsx's
// `TableInsertGridPicker`) calls this directly, bypassing `insertMenu` -
// `rows`/`columns` come from whichever cell in the 10×10 grid the user
// clicked.
export function insertTableWithSize(
  tableType: NodeType,
  rows: number,
  columns: number,
): Command {
  return (state, dispatch) => {
    dispatch?.(
      state.tr.replaceSelectionWith(buildTable(tableType, rows, columns)),
    );
    return true;
  };
}
