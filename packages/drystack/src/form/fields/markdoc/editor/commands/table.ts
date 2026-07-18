import { Command, Transaction } from "prosemirror-state";
import {
  CellSelection,
  TableMap,
  TableRect,
  addColSpan,
  addColumnAfter,
  addColumnBefore,
  cellAround,
  rowIsHeader,
  selectedRect,
  splitCellWithType,
  tableNodeTypes,
} from "prosemirror-tables";
import {
  rebalanceColumnWidthsForInsert,
  resolveEffectiveColumnWidths,
  setAllColumnWidthPercents,
} from "../table-column-resize";

// Merge/unmerge is only wired up for the `content` (HTML) field today - the
// underlying editor/schema is shared with the `markdoc`/`mdx` document
// fields, so these commands also become reachable there, but the
// colspan/rowspan attrs they produce aren't persisted by
// `markdoc/serialize.ts` or `mdx/serialize.ts`/`mdx/parse.ts`. That's
// accepted: those two fields are no longer in active use in this project.

// Ported from prosemirror-tables (not part of its public API) - the same
// "does this selection cut a merged cell in half" guard `mergeCells` uses
// internally, kept in sync with `selectedRect`'s `TableRect` shape.
function cellsOverlapRectangle(map: TableMap, rect: TableRect) {
  const { width, height } = map;
  let indexTop = rect.top * width + rect.left;
  let indexLeft = indexTop;
  let indexBottom = (rect.bottom - 1) * width + rect.left;
  let indexRight = indexTop + (rect.right - rect.left - 1);
  for (let i = rect.top; i < rect.bottom; i++) {
    if (
      (rect.left > 0 && map.map[indexLeft] === map.map[indexLeft - 1]) ||
      (rect.right < width && map.map[indexRight] === map.map[indexRight + 1])
    ) {
      return true;
    }
    indexLeft += width;
    indexRight += width;
  }
  for (let i = rect.left; i < rect.right; i++) {
    if (
      (rect.top > 0 && map.map[indexTop] === map.map[indexTop - width]) ||
      (rect.bottom < height &&
        map.map[indexBottom] === map.map[indexBottom + width])
    ) {
      return true;
    }
    indexTop++;
    indexBottom++;
  }
  return false;
}

/**
 * Like prosemirror-tables' `mergeCells`, but discards the content of every
 * cell except the top-left one instead of concatenating it into the merge.
 */
export const mergeCellsKeepFirst: Command = (state, dispatch) => {
  const sel = state.selection;
  if (
    !(sel instanceof CellSelection) ||
    sel.$anchorCell.pos === sel.$headCell.pos
  ) {
    return false;
  }
  const rect = selectedRect(state);
  const { map } = rect;
  if (cellsOverlapRectangle(map, rect)) return false;

  if (dispatch) {
    const tr = state.tr;
    const seen: Record<number, boolean> = {};
    let mergedPos: number | undefined;
    let mergedCell: import("prosemirror-model").Node | undefined;
    for (let row = rect.top; row < rect.bottom; row++) {
      for (let col = rect.left; col < rect.right; col++) {
        const cellPos = map.map[row * map.width + col];
        const cell = rect.table.nodeAt(cellPos);
        if (seen[cellPos] || !cell) continue;
        seen[cellPos] = true;
        if (mergedPos == null) {
          mergedPos = cellPos;
          mergedCell = cell;
        } else {
          const mapped = tr.mapping.map(cellPos + rect.tableStart);
          tr.delete(mapped, mapped + cell.nodeSize);
        }
      }
    }
    if (mergedPos == null || !mergedCell) return true;
    // `addColSpan` types its `attrs` param as prosemirror-tables' own
    // (unexported) CellAttrs shape, not prosemirror-model's generic `Attrs` -
    // this cell node's attrs always match it at runtime (it's a table cell).
    const cellAttrs = mergedCell.attrs as {
      colspan: number;
      rowspan: number;
      colwidth: number[] | null;
    };
    tr.setNodeMarkup(mergedPos + rect.tableStart, null, {
      ...addColSpan(
        cellAttrs,
        cellAttrs.colspan,
        rect.right - rect.left - cellAttrs.colspan,
      ),
      rowspan: rect.bottom - rect.top,
    });
    tr.setSelection(
      new CellSelection(tr.doc.resolve(mergedPos + rect.tableStart)),
    );
    dispatch(tr);
  }
  return true;
};

// `splitCell` already keeps the original merged cell's content only in the
// top-left resulting cell and leaves the rest empty - exactly the "keep
// first, discard rest" behavior we want for unmerge too. But its default
// `getCellType` copies the *merged* cell's own type onto every resulting
// cell, which turns entire non-header rows into `th` whenever a header cell
// was merged into them. Only table row 0 may become `th`, and only when the
// header row is actually enabled - every other row is always `td`.
export const unmergeCell: Command = (state, dispatch) => {
  const types = tableNodeTypes(state.schema);
  let headerRowEnabled: boolean | undefined;
  return splitCellWithType(({ row }) => {
    if (row !== 0) return types.cell;
    if (headerRowEnabled === undefined) {
      const rect = selectedRect(state);
      headerRowEnabled = rowIsHeader(rect.map, rect.table, 0);
    }
    return headerRowEnabled ? types.header_cell : types.cell;
  })(state, dispatch);
};

// Wraps a column-inserting command so the new column isn't squeezed to
// nothing (or existing columns pushed past 100% combined): reads the
// pre-insert table's effective widths (see resolveEffectiveColumnWidths),
// lets the wrapped command build its own transaction, then rebalances every
// column's `widthPercent` in that same transaction (see
// rebalanceColumnWidthsForInsert) before dispatching - one undo step, not
// two. The inserted column is always a plain cell, so its position in the
// resulting table matches `rect.left` (insert before) / `rect.right`
// (insert after) from the *original* selection's rect.
function withColumnRebalance(command: Command, before: boolean): Command {
  return (state, dispatch) => {
    if (!command(state)) return false;
    if (!dispatch) return true;

    const rect = selectedRect(state);
    const oldWidths = resolveEffectiveColumnWidths(rect.table);
    const insertIndex = before ? rect.left : rect.right;

    let tr: Transaction | undefined;
    command(state, (transaction) => {
      tr = transaction;
    });
    if (!tr) return false;

    try {
      // `tr.selection.$anchor` is typically a cursor *inside* the cell's
      // content (several depths deeper than the cell itself) - `cellAround`
      // walks up to the position actually depth-aligned with the cell, the
      // same way `startDrag`/`edgeCellPos` do in table-column-resize.ts, so
      // that `.node(-1)`/`.start(-1)` resolve to the table, not some node
      // partway down (e.g. the cell's own paragraph).
      const $cell = cellAround(tr.selection.$anchor);
      if (!$cell) throw new RangeError("No cell found around selection");
      const table = $cell.node(-1);
      const tableStart = $cell.start(-1);
      const widths = rebalanceColumnWidthsForInsert(oldWidths, insertIndex);
      tr = setAllColumnWidthPercents(tr, tableStart, table, widths);
    } catch {
      // selection didn't resolve to a cell as expected - fall back to
      // dispatching the plain insert, unresized
    }
    dispatch(tr);
    return true;
  };
}

export const addColumnBeforeWithRebalance: Command = withColumnRebalance(
  addColumnBefore,
  true,
);
export const addColumnAfterWithRebalance: Command = withColumnRebalance(
  addColumnAfter,
  false,
);
