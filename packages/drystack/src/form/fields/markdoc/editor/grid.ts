import type { Node as ProseMirrorNode, NodeType } from "prosemirror-model";
import type { Command, EditorState } from "prosemirror-state";
import { NodeSelection } from "prosemirror-state";

// The grid is a flat CSS-grid whose track count is configurable per grid (the
// `columns` attr, default 24 — like a 24-unit design grid). Each `grid_cell`
// spans N of those tracks; cells that overflow the track count wrap onto a new
// visual row via the grid's auto-flow. On mobile the whole thing collapses to
// a single column (see GRID_RESPONSIVE_CSS).
export const GRID_DEFAULT_COLUMNS = 24;
export const GRID_DEFAULT_SPAN = 12;
export const GRID_DEFAULT_GAP = "0.5em";
export const GRID_MOBILE_BREAKPOINT = 720;

// column-count presets offered in the grid toolbar
export const GRID_COLUMN_OPTIONS = [6, 12, 16, 24] as const;

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
// placement" — content just flows full-width from the top.
export type GridPlace = `${GridPlaceAxis} ${GridPlaceAxis}` | null;

// inline style for the grid container `<div data-dry-grid>`. Kept in one
// place so the HTML serializer and the clipboard `toDOM` fallback agree.
// `gap` is a per-grid attribute, editable from the toolbar.
export function gridContainerStyle(gap: string, columns: number): string {
  return `display:grid;grid-template-columns:repeat(${columns},1fr);gap:${gap}`;
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

// One media rule, emitted once per document (see the serializer). Needs
// `!important` to beat the inline `grid-template-columns` on the container.
// When the container drops to a single column, every cell's `grid-column:
// span N` clamps to that lone column, so cells go full-width without needing
// their own per-cell override.
export const GRID_RESPONSIVE_CSS = `@media(max-width:${GRID_MOBILE_BREAKPOINT}px){[data-dry-grid]{grid-template-columns:1fr!important}}`;

export function cellStyleString(attrs: {
  span: number;
  place: GridPlace;
}): string {
  let style = `grid-column:span ${attrs.span}`;
  if (attrs.place) {
    style += `;display:grid;place-content:${attrs.place}`;
  }
  return style;
}

export function clampSpan(
  span: number,
  columns: number = GRID_DEFAULT_COLUMNS,
): number {
  if (!Number.isFinite(span)) return Math.min(GRID_DEFAULT_SPAN, columns);
  return Math.max(1, Math.min(columns, Math.round(span)));
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

// insert-menu factory (matches the `insertMenu.command` signature). Drops a
// fresh grid with two equal cells at the selection.
export function insertGrid(gridType: NodeType): Command {
  return (state, dispatch) => {
    const cellA = makeCell(gridType.schema);
    const cellB = makeCell(gridType.schema);
    if (!cellA || !cellB) return false;
    const grid = gridType.createAndFill({}, [cellA, cellB]);
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

// insert a new cell immediately after the focused one ("thêm cột" — the
// focused cell is the anchor), inheriting the focused cell's span so the new
// item matches its current width
export const addCellAfterFocused: Command = (state, dispatch) => {
  const cell = findGridCell(state);
  if (!cell) return false;
  const newCell = makeCell(state.schema, cell.node.attrs.span);
  if (!newCell) return false;
  if (dispatch) {
    dispatch(state.tr.insert(cell.pos + cell.node.nodeSize, newCell));
  }
  return true;
};

// append a new cell at the very end of the enclosing grid ("thêm item" / the
// trailing "+"). The new cell inherits the current span — the focused cell's
// if one is focused, otherwise the grid's last cell — rather than snapping
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
    dispatch(state.tr.insert(grid.pos + grid.node.nodeSize - 1, newCell));
  }
  return true;
};

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

// set the grid's track count and rescale every cell's span proportionally so
// the visual layout is preserved across the change (two 50% cells stay 50%).
// `gridPos` is the position *before* the grid node.
export function setGridColumns(gridPos: number, columns: number): Command {
  return (state, dispatch) => {
    const grid = state.doc.nodeAt(gridPos);
    if (!grid || grid.type.name !== "grid") return false;
    const nextColumns = clampColumns(columns);
    const oldColumns: number = grid.attrs.columns;
    if (nextColumns === oldColumns) return false;
    if (dispatch) {
      // setNodeAttribute uses a SetAttr step, so no child positions shift —
      // each cell sits at `gridPos + 1 + offset` throughout the transaction
      let tr = state.tr.setNodeAttribute(gridPos, "columns", nextColumns);
      grid.forEach((cell, offset) => {
        const nextSpan = clampSpan(
          (cell.attrs.span * nextColumns) / oldColumns,
          nextColumns,
        );
        if (nextSpan !== cell.attrs.span) {
          tr = tr.setNodeAttribute(gridPos + 1 + offset, "span", nextSpan);
        }
      });
      dispatch(tr);
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
