import type { Node as ProseMirrorNode, NodeType } from 'prosemirror-model';
import type { Command, EditorState } from 'prosemirror-state';
import { NodeSelection } from 'prosemirror-state';

// The grid is a flat CSS-grid with a fixed 24-track column system (like a
// 24-unit design grid). Each `grid_cell` spans N of those tracks; cells that
// overflow 24 wrap onto a new visual row via the grid's auto-flow. On mobile
// the whole thing collapses to a single column (see GRID_RESPONSIVE_CSS).
export const GRID_COLUMNS = 24;
export const GRID_DEFAULT_SPAN = 12;
export const GRID_GAP = '1rem';
export const GRID_MOBILE_BREAKPOINT = 720;

export type GridPlaceAxis = 'start' | 'center' | 'end';
// stored as `"<align-content> <justify-content>"` (vertical then horizontal),
// i.e. the value for the cell's `place-content`. null means "no explicit
// placement" — content just flows full-width from the top.
export type GridPlace = `${GridPlaceAxis} ${GridPlaceAxis}` | null;

// inline style for the grid container `<div data-dry-grid>`. Kept in one
// place so the HTML serializer, the clipboard `toDOM` fallback and the editor
// node view all agree.
export const GRID_CONTAINER_STYLE = `display:grid;grid-template-columns:repeat(${GRID_COLUMNS},1fr);gap:${GRID_GAP}`;

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

export function clampSpan(span: number): number {
  if (!Number.isFinite(span)) return GRID_DEFAULT_SPAN;
  return Math.max(1, Math.min(GRID_COLUMNS, Math.round(span)));
}

export function parseGridColumnSpan(style: string): number {
  const match = /grid-column\s*:\s*span\s*(\d+)/i.exec(style);
  return match ? clampSpan(parseInt(match[1], 10)) : GRID_DEFAULT_SPAN;
}

export function parsePlaceContent(style: string): GridPlace {
  const match = /place-content\s*:\s*(start|center|end)\s+(start|center|end)/i.exec(
    style
  );
  return match
    ? (`${match[1].toLowerCase()} ${match[2].toLowerCase()}` as GridPlace)
    : null;
}

// ---------------------------------------------------------------------------
// commands
// ---------------------------------------------------------------------------

function makeCell(schema: NodeType['schema']): ProseMirrorNode | null {
  const cellType = schema.nodes.grid_cell;
  const paragraphType = schema.nodes.paragraph;
  if (!cellType || !paragraphType) return null;
  return cellType.createAndFill(
    { span: GRID_DEFAULT_SPAN },
    paragraphType.createAndFill() ?? undefined
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
    if (node.type.name === 'grid_cell') {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

export function findGrid(state: EditorState): Located | null {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (node.type.name === 'grid') {
      return { pos: $from.before(depth), node };
    }
  }
  if (
    state.selection instanceof NodeSelection &&
    state.selection.node.type.name === 'grid'
  ) {
    return { pos: state.selection.from, node: state.selection.node };
  }
  return null;
}

// insert a new cell immediately after the focused one ("thêm cột" — the
// focused cell is the anchor)
export const addCellAfterFocused: Command = (state, dispatch) => {
  const cell = findGridCell(state);
  if (!cell) return false;
  const newCell = makeCell(state.schema);
  if (!newCell) return false;
  if (dispatch) {
    dispatch(state.tr.insert(cell.pos + cell.node.nodeSize, newCell));
  }
  return true;
};

// append a new cell at the very end of the enclosing grid ("thêm item" / the
// trailing "+")
export const appendCellToGrid: Command = (state, dispatch) => {
  const grid = findGrid(state);
  if (!grid) return false;
  const newCell = makeCell(state.schema);
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
      dispatch(state.tr.setNodeAttribute(cell.pos, 'place', place));
    }
    return true;
  };
}

// used by the toolbar's delete-with-confirm: is there anything worth warning
// about before removing the grid?
export function gridHasContent(grid: ProseMirrorNode): boolean {
  if (grid.textContent.trim().length > 0) return true;
  let hasLeaf = false;
  grid.descendants(node => {
    if (node.isLeaf && node.type.name !== 'text') hasLeaf = true;
  });
  return hasLeaf;
}
