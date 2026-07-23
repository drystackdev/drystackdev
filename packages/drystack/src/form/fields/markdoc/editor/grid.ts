import { chainCommands } from "prosemirror-commands";
import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { NodeSelection, Selection } from "prosemirror-state";

// The grid is a flat CSS-grid with a fixed 12-unit track count (like a
// classic 12-column design grid - not user-configurable). Each `grid_cell`
// spans N of those tracks; cells that overflow the track count wrap onto a new
// visual row via the grid's auto-flow. On mobile the whole thing collapses to
// a single column (see GRID_RESPONSIVE_CSS).
export const GRID_DEFAULT_COLUMNS = 12;
export const GRID_DEFAULT_SPAN = 6;
export const GRID_DEFAULT_ROW_SPAN = 1;
export const GRID_DEFAULT_GAP = "0.5em";
// explicit row-track count - an even split of the grid's height into N equal
// (`1fr`) rows. `1` (the default) behaves the same as leaving it unset: a
// single auto-sized row that grows with content. Not user-configurable either
// - it's derived automatically from the tallest cell's rowSpan (see
// GridCellView's commitSpans in grid-node-view.tsx).
export const GRID_DEFAULT_ROWS = 1;
export const GRID_MOBILE_BREAKPOINT = 720;

// gap presets offered in the grid toolbar (0.25em … 3rem)
export const GRID_GAP_OPTIONS = [
  "0",
  "0.25em",
  "0.5em",
  "0.75em",
  "1em",
  "1.5em",
  "2em",
] as const;

export type GridPlaceAxis = "start" | "center" | "end";
// stored as `"<align-content> <justify-content>"` (vertical then horizontal),
// i.e. the value for the cell's `place-content`. null means "no explicit
// placement" - content just flows full-width from the top.
export type GridPlace = `${GridPlaceAxis} ${GridPlaceAxis}` | null;

// inline style for the grid container `<div data-dry-grid>`. Kept in one
// place so the HTML serializer and the clipboard `toDOM` fallback agree.
// `gap` and `rows` are per-grid attributes, editable from the toolbar.
export function gridContainerStyle(
  gap: string,
  columns: number,
  rows: number = GRID_DEFAULT_ROWS,
): string {
  return `display:grid;grid-template-columns:repeat(${columns},1fr);grid-template-rows:repeat(${rows},1fr);gap:${gap}`;
}

export function parseGridGap(style: string): string {
  const match = /(?:^|;)\s*gap\s*:\s*([^;]+)/i.exec(style);
  const value = match ? match[1].trim() : "";
  return value || GRID_DEFAULT_GAP;
}

export function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) return GRID_DEFAULT_COLUMNS;
  return Math.max(1, Math.min(48, Math.round(columns)));
}

export function parseGridColumns(style: string): number {
  const match = /grid-template-columns\s*:\s*repeat\(\s*(\d+)/i.exec(style);
  return match ? clampColumns(parseInt(match[1], 10)) : GRID_DEFAULT_COLUMNS;
}

export function clampRows(rows: number): number {
  if (!Number.isFinite(rows)) return GRID_DEFAULT_ROWS;
  return Math.max(1, Math.min(24, Math.round(rows)));
}

export function parseGridRows(style: string): number {
  const match = /grid-template-rows\s*:\s*repeat\(\s*(\d+)/i.exec(style);
  return match ? clampRows(parseInt(match[1], 10)) : GRID_DEFAULT_ROWS;
}

// One media rule, emitted once per document (see the serializer). Needs
// `!important` to beat the inline `grid-template-columns` on the container.
// When the container drops to a single column, every cell's `grid-column:
// span N` clamps to that lone column, so cells go full-width without needing
// their own per-cell override.
export const GRID_RESPONSIVE_CSS = `@media(max-width:${GRID_MOBILE_BREAKPOINT}px){[data-dry-grid]{grid-template-columns:1fr!important}}`;

export function cellStyleString(attrs: {
  span: number;
  rowSpan: number;
  place: GridPlace;
}): string {
  let style = `grid-column:span ${attrs.span};grid-row:span ${attrs.rowSpan}`;
  if (attrs.place) {
    style += `;display:grid;place-content:${attrs.place}`;
  }
  return style;
}

// generic "clamp a span to [1, max]" - used for both a cell's column span
// (against the grid's `columns`) and its row span (against `rows`)
export function clampSpan(
  span: number,
  max: number = GRID_DEFAULT_COLUMNS,
): number {
  if (!Number.isFinite(span)) return Math.min(GRID_DEFAULT_SPAN, max);
  return Math.max(1, Math.min(max, Math.round(span)));
}

export function parseGridColumnSpan(
  style: string,
  columns: number = GRID_DEFAULT_COLUMNS,
): number {
  const match = /grid-column\s*:\s*span\s*(\d+)/i.exec(style);
  return match
    ? clampSpan(parseInt(match[1], 10), columns)
    : Math.min(GRID_DEFAULT_SPAN, columns);
}

export function parseGridRowSpan(
  style: string,
  rows: number = GRID_DEFAULT_ROWS,
): number {
  const match = /grid-row\s*:\s*span\s*(\d+)/i.exec(style);
  return match
    ? clampSpan(parseInt(match[1], 10), rows)
    : Math.min(GRID_DEFAULT_ROW_SPAN, rows);
}

export function parsePlaceContent(style: string): GridPlace {
  const match =
    /place-content\s*:\s*(start|center|end)\s+(start|center|end)/i.exec(style);
  return match
    ? (`${match[1].toLowerCase()} ${match[2].toLowerCase()}` as GridPlace)
    : null;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function makeCell(
  schema: NodeType["schema"],
  span: number = GRID_DEFAULT_SPAN,
): ProseMirrorNode | null {
  const cellType = schema.nodes.grid_cell;
  const paragraphType = schema.nodes.paragraph;
  if (!cellType || !paragraphType) return null;
  return cellType.createAndFill(
    { span },
    paragraphType.createAndFill() ?? undefined,
  );
}

// shared by `insertGrid` (fixed 2-cell, wired into the insert-menu) and
// `insertGridWithItemCount` (the toolbar's item-count dropdown) - kept out of
// `insertGrid` itself since that one is called as `(type, schema)` by
// `insertMenu.command` (see commands/misc.ts's note on the same hazard for
// `insertTable`), so it can't safely grow a `cellCount` parameter.
function buildGrid(
  gridType: NodeType,
  cellCount: number,
): ProseMirrorNode | null {
  const span = clampSpan(GRID_DEFAULT_COLUMNS / cellCount, GRID_DEFAULT_COLUMNS);
  const cells: ProseMirrorNode[] = [];
  for (let i = 0; i < cellCount; i++) {
    const cell = makeCell(gridType.schema, span);
    if (!cell) return null;
    cells.push(cell);
  }
  return gridType.createAndFill({}, cells);
}

// insert-menu factory (matches the `insertMenu.command` signature). Drops a
// fresh grid with two equal cells at the selection.
export function insertGrid(gridType: NodeType): Command {
  return (state, dispatch) => {
    const grid = buildGrid(gridType, 2);
    if (!grid) return false;
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(grid).scrollIntoView());
    }
    return true;
  };
}

// the toolbar's item-count dropdown (see Toolbar.tsx's `GridInsertMenu`)
// calls this directly, bypassing `insertMenu`.
export function insertGridWithItemCount(
  gridType: NodeType,
  cellCount: number,
): Command {
  return (state, dispatch) => {
    const grid = buildGrid(gridType, cellCount);
    if (!grid) return false;
    if (dispatch) {
      dispatch(state.tr.replaceSelectionWith(grid).scrollIntoView());
    }
    return true;
  };
}

type Located = { pos: number; node: ProseMirrorNode };

export function findGridCell(state: EditorState): Located | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "grid_cell") {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

export function findGrid(state: EditorState): Located | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === "grid") {
      return { pos: $from.before(depth), node };
    }
  }
  if (
    state.selection instanceof NodeSelection &&
    state.selection.node.type.name === "grid"
  ) {
    return { pos: state.selection.from, node: state.selection.node };
  }
  return null;
}

// insert a new cell immediately after the focused one ("thêm cột" - the
// focused cell is the anchor), inheriting the focused cell's span so the new
// item matches its current width
export const addCellAfterFocused: Command = (state, dispatch) => {
  const cell = findGridCell(state);
  if (!cell) return false;
  const newCell = makeCell(state.schema, cell.node.attrs.span);
  if (!newCell) return false;
  if (dispatch) {
    const insertPos = cell.pos + cell.node.nodeSize;
    const tr = state.tr.insert(insertPos, newCell);
    // drop the caret into the fresh cell so the user can type right away
    tr.setSelection(Selection.near(tr.doc.resolve(insertPos + 1), 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// append a new cell at the very end of the enclosing grid ("thêm item" / the
// trailing "+"). The new cell inherits the current span - the focused cell's
// if one is focused, otherwise the grid's last cell - rather than snapping
// back to the default width.
export const appendCellToGrid: Command = (state, dispatch) => {
  const grid = findGrid(state);
  if (!grid) return false;
  const span =
    findGridCell(state)?.node.attrs.span ??
    grid.node.lastChild?.attrs.span ??
    GRID_DEFAULT_SPAN;
  const newCell = makeCell(state.schema, span);
  if (!newCell) return false;
  if (dispatch) {
    // -1 to land just inside the grid's closing token
    const insertPos = grid.pos + grid.node.nodeSize - 1;
    const tr = state.tr.insert(insertPos, newCell);
    // drop the caret into the fresh cell so the user can type right away
    tr.setSelection(Selection.near(tr.doc.resolve(insertPos + 1), 1));
    dispatch(tr.scrollIntoView());
  }
  return true;
};

// the toolbar "+" - insert a new cell to the right of the focused one, falling
// back to appending at the grid's end when nothing is focused so the button is
// never a dead click.
export const addCell: Command = chainCommands(
  addCellAfterFocused,
  appendCellToGrid,
);

// delete the focused cell; if it's the last one, remove the whole grid so we
// never leave an empty grid behind
export const deleteFocusedCell: Command = (state, dispatch) => {
  const cell = findGridCell(state);
  const grid = findGrid(state);
  if (!cell || !grid) return false;
  if (dispatch) {
    if (grid.node.childCount <= 1) {
      dispatch(state.tr.delete(grid.pos, grid.pos + grid.node.nodeSize));
    } else {
      dispatch(state.tr.delete(cell.pos, cell.pos + cell.node.nodeSize));
    }
  }
  return true;
};

// move the caret into the previous/next sibling cell within the same grid.
// Bound to Tab / Shift-Tab. Tab at the grid's *last* cell adds a new one
// (mirroring the toolbar's "+"), so tabbing through a grid can grow it the
// same way tabbing through a table's last cell adds a row. Shift-Tab at the
// *first* cell has nowhere sensible to go, so it just consumes the key - an
// unhandled Tab would otherwise blur the whole contenteditable.
export function moveToAdjacentCell(direction: 1 | -1): Command {
  return (state, dispatch) => {
    const cell = findGridCell(state);
    const grid = findGrid(state);
    if (!cell || !grid) return false;
    const cellPositions: number[] = [];
    grid.node.forEach((_child, offset) => {
      cellPositions.push(grid.pos + 1 + offset);
    });
    const index = cellPositions.indexOf(cell.pos);
    const targetPos =
      index === -1 ? undefined : cellPositions[index + direction];
    if (targetPos === undefined) {
      if (direction === 1) return addCellAfterFocused(state, dispatch);
      return true;
    }
    if (dispatch) {
      // land the caret at the start of the target cell's content
      const $target = state.doc.resolve(targetPos + 1);
      dispatch(
        state.tr.setSelection(Selection.near($target, 1)).scrollIntoView(),
      );
    }
    return true;
  };
}

// Backspace/Delete inside an *empty* grid cell removes the whole cell (or the
// grid, if it was the only cell) rather than joining paragraphs across the cell
// boundary. Non-empty cells return false so the normal delete behaviour runs.
export const deleteEmptyGridCell: Command = (state, dispatch) => {
  const cell = findGridCell(state);
  if (!cell || gridHasContent(cell.node)) return false;
  return deleteFocusedCell(state, dispatch);
};

export function setFocusedCellPlace(place: GridPlace): Command {
  return (state, dispatch) => {
    const cell = findGridCell(state);
    if (!cell) return false;
    if (dispatch) {
      dispatch(state.tr.setNodeAttribute(cell.pos, "place", place));
    }
    return true;
  };
}

// used by the toolbar's delete-with-confirm: is there anything worth warning
// about before removing the grid?
export function gridHasContent(grid: ProseMirrorNode): boolean {
  if (grid.textContent.trim().length > 0) return true;
  let hasLeaf = false;
  grid.descendants((node) => {
    if (node.isLeaf && node.type.name !== "text") hasLeaf = true;
  });
  return hasLeaf;
}
