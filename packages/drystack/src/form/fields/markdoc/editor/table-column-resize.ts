import { Node as ProsemirrorNode } from 'prosemirror-model';
import { EditorState, Plugin, PluginKey, Transaction } from 'prosemirror-state';
import { Decoration, DecorationSet, EditorView, NodeView } from 'prosemirror-view';
import { TableMap, cellAround, pointsAtCell } from 'prosemirror-tables';

import { css } from '@keystar/ui/style';

// how close (in px) the pointer must be to a column boundary to activate
// its resize handle
const HANDLE_HITBOX = 6;
// columns can't be dragged smaller than this, in px — matches roughly to a
// couple of characters of padding so a column can't be squeezed to nothing
const MIN_COLUMN_WIDTH_PX = 40;

type CellRef = { pos: number };

type Dragging = {
  startX: number;
  leftPx: number;
  rightPx: number;
  tableWidthPx: number;
  minPx: number;
  leftCells: CellRef[];
  rightCells: CellRef[];
  // updated on every pointermove — `decorations()` reads this to render the
  // live cell-width preview (see `buildDragDecorations`)
  currentClientX: number;
  leftCol: number;
  rightCol: number;
  // every column's width at drag start (see resolveEffectiveColumnWidths),
  // committed back as-is for every column except leftCol/rightCol — so
  // dragging one boundary can't perturb columns it has nothing to do with
  // (see commitResize).
  effectiveWidths: number[];
};

type PluginState = {
  // doc position of the cell immediately to the left of the active/dragged
  // boundary, or -1 when no boundary is active
  activeHandle: number;
  dragging: Dragging | null;
};

export const tableColumnResizingKey = new PluginKey<PluginState>(
  'tableColumnResizing'
);

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function domCellAround(target: EventTarget | null): HTMLElement | null {
  let node = target as HTMLElement | null;
  while (node && node.nodeName !== 'TD' && node.nodeName !== 'TH') {
    if (node.classList?.contains('ProseMirror')) return null;
    node = node.parentElement;
  }
  return node;
}

// every plain (colspan === 1) cell that occupies column `col`, one per row
// it appears in — cells belonging to a column-spanning merge are skipped,
// since there's no single cell whose width represents just that column
function plainCellsInColumn(
  table: ProsemirrorNode,
  map: TableMap,
  tableStart: number,
  col: number
): CellRef[] {
  const cells: CellRef[] = [];
  for (let row = 0; row < map.height; row++) {
    const mapIndex = row * map.width + col;
    if (row > 0 && map.map[mapIndex] === map.map[mapIndex - map.width]) {
      continue; // rowspan continuation from the row above
    }
    const relPos = map.map[mapIndex];
    const node = table.nodeAt(relPos);
    if (!node || node.attrs.colspan !== 1 || map.colCount(relPos) !== col) {
      continue;
    }
    cells.push({ pos: tableStart + relPos });
  }
  return cells;
}

// one canonical width (as a %) per column, derived from whichever plain cell
// in that column carries a `widthPercent` — resize writes the same value to
// every plain cell in a column, so any match is authoritative. `null` for a
// column that's never been resized, matching the per-cell auto/remainder
// behavior described on `widthPercent` in schema.tsx. Used to render a
// `<colgroup>` that's immune to which row happens to hold a plain cell for
// a given column (unlike per-cell widths, which `table-layout: fixed` only
// honors on the table's first row).
export function getColumnWidthPercents(table: ProsemirrorNode): (number | null)[] {
  const map = TableMap.get(table);
  const widths: (number | null)[] = new Array(map.width).fill(null);
  for (let col = 0; col < map.width; col++) {
    for (let row = 0; row < map.height; row++) {
      const mapIndex = row * map.width + col;
      if (row > 0 && map.map[mapIndex] === map.map[mapIndex - map.width]) {
        continue; // rowspan continuation from the row above
      }
      const relPos = map.map[mapIndex];
      const node = table.nodeAt(relPos);
      if (!node || node.attrs.colspan !== 1 || map.colCount(relPos) !== col) {
        continue;
      }
      if (node.attrs.widthPercent) {
        widths[col] = node.attrs.widthPercent;
        break;
      }
    }
  }
  return widths;
}

// `getColumnWidthPercents`, with every `null` (never explicitly resized)
// column filled in with its actual rendered share — the remaining
// percentage split equally among just the `null` columns, matching the CSS
// fixed-layout auto behavior those columns currently render with. Used
// wherever a calculation needs every column's *true current* width, e.g.
// rebalancing for a newly inserted column — treating a `null` column as 0
// (instead of its real auto share) would let a resize elsewhere silently
// steal width from columns that were never touched.
export function resolveEffectiveColumnWidths(table: ProsemirrorNode): number[] {
  const widths = getColumnWidthPercents(table);
  const explicitSum = widths.reduce(
    (sum: number, w) => sum + (w ?? 0),
    0
  );
  const nullCount = widths.filter(w => w == null).length;
  const autoShare = nullCount > 0 ? round1((100 - explicitSum) / nullCount) : 0;
  return widths.map(w => w ?? autoShare);
}

// Rebalances existing column widths to make room for one new column at
// `insertIndex`, so that every column — old or new — keeps at least an
// equal (`100 / newColumnCount`) share instead of the new column being
// squeezed to nothing (or existing columns overflowing past 100% combined).
// The new column gets exactly that minimum share; existing columns are
// scaled down proportionally to free it up, with any column that would fall
// below the minimum clamped there and the shortfall pulled proportionally
// from columns that still have slack above it.
export function rebalanceColumnWidthsForInsert(
  oldWidths: readonly number[],
  insertIndex: number
): number[] {
  const newCount = oldWidths.length + 1;
  const minPercent = 100 / newCount;
  const oldSum = oldWidths.reduce((sum, w) => sum + w, 0) || 100;
  const available = 100 - minPercent;

  let scaled = oldWidths.map(w => (w / oldSum) * available);

  let deficit = 0;
  scaled = scaled.map(w => {
    if (w < minPercent) {
      deficit += minPercent - w;
      return minPercent;
    }
    return w;
  });
  if (deficit > 0) {
    const slackTotal = scaled.reduce((sum, w) => sum + Math.max(0, w - minPercent), 0);
    if (slackTotal > 0) {
      scaled = scaled.map(w => {
        const slack = Math.max(0, w - minPercent);
        return w - (slack / slackTotal) * deficit;
      });
    }
  }

  const result = scaled.map(round1);
  result.splice(insertIndex, 0, round1(minPercent));
  return result;
}

// Applies `widths[col]` to every plain cell of column `col`, for every
// column — the same per-column write `commitResize` does for just the two
// dragged columns, generalized to the whole table (see
// rebalanceColumnWidthsForInsert). Positions are read from `table`/`map` as
// they are *before* any of these calls — safe here because attr-only
// changes never shift sibling positions, so resolving them all up front
// this way (rather than re-mapping after each write) is fine.
export function setAllColumnWidthPercents(
  tr: Transaction,
  tableStart: number,
  table: ProsemirrorNode,
  widths: readonly number[]
): Transaction {
  const map = TableMap.get(table);
  for (let col = 0; col < map.width; col++) {
    for (const { pos } of plainCellsInColumn(table, map, tableStart, col)) {
      tr = tr.setNodeAttribute(pos, 'widthPercent', widths[col]);
    }
  }
  return tr;
}

// A `<colgroup>` written once via `toDOM` never updates again on its own:
// ProseMirror only re-invokes a node spec's `toDOM` to build brand new DOM,
// not on every attr change to a descendant (a resized cell, here) — it
// patches the existing `<td>`/`<th>` DOM in place instead and leaves the
// table's own wrapper untouched. A NodeView's `update` hook, by contrast,
// runs on every state update that touches this node, so it's the only place
// that can keep a derived, table-wide `<colgroup>` in sync with per-cell
// resizes. Mirrors the shape of prosemirror-tables' own bundled `TableView`
// (see `updateColumnsOnResize` in the `prosemirror-tables` package), adapted
// to this schema's percentage-based `widthPercent` (rather than pixel
// `colwidth`) and to reading any row's plain cell for a column (rather than
// only the first row's), which is what actually fixes the merged-header case
// this was written for.
export class TableColgroupNodeView implements NodeView {
  dom: HTMLTableElement;
  contentDOM: HTMLElement;
  private node: ProsemirrorNode;
  private colgroup: HTMLElement;

  constructor(node: ProsemirrorNode, tableClass: string) {
    this.node = node;
    this.dom = document.createElement('table');
    this.dom.className = tableClass;
    this.colgroup = this.dom.appendChild(document.createElement('colgroup'));
    this.contentDOM = this.dom.appendChild(document.createElement('tbody'));
    this.syncColgroup(node);
  }

  update(node: ProsemirrorNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.syncColgroup(node);
    return true;
  }

  ignoreMutation(record: MutationRecord | { type: 'selection'; target: Node }): boolean {
    return (
      record.type === 'attributes' &&
      (record.target === this.dom || this.colgroup.contains(record.target as Node))
    );
  }

  private syncColgroup(node: ProsemirrorNode) {
    const widths = getColumnWidthPercents(node);
    while (this.colgroup.childElementCount > widths.length) {
      this.colgroup.lastChild!.remove();
    }
    while (this.colgroup.childElementCount < widths.length) {
      this.colgroup.appendChild(document.createElement('col'));
    }
    widths.forEach((pct, i) => {
      const col = this.colgroup.children[i] as HTMLElement;
      const width = pct != null ? `${pct}%` : '';
      if (col.style.width !== width) col.style.width = width;
    });
  }
}

// resolves the doc position of the cell to the left of the boundary nearest
// `event`'s x-position on the given side of the hovered cell — or -1 if
// that boundary isn't resizable (table edge, or either side is a merged
// cell that doesn't cleanly represent a single column)
function edgeCellPos(
  view: EditorView,
  event: PointerEvent,
  side: 'left' | 'right'
): number {
  const offset = side === 'right' ? -HANDLE_HITBOX : HANDLE_HITBOX;
  const found = view.posAtCoords({
    left: event.clientX + offset,
    top: event.clientY,
  });
  if (!found) return -1;
  const $cell = cellAround(view.state.doc.resolve(found.pos));
  if (!$cell) return -1;
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const relPos = $cell.pos - tableStart;
  const cellNode = table.nodeAt(relPos);
  if (!cellNode || cellNode.attrs.colspan !== 1) return -1;
  const col = map.colCount(relPos);
  const row = Math.floor(map.map.indexOf(relPos) / map.width);
  const neighborCol = side === 'left' ? col - 1 : col + 1;
  if (neighborCol < 0 || neighborCol >= map.width) return -1;
  const neighborRelPos = map.map[row * map.width + neighborCol];
  const neighborNode = table.nodeAt(neighborRelPos);
  if (!neighborNode || neighborNode.attrs.colspan !== 1) return -1;
  return tableStart + (side === 'left' ? neighborRelPos : relPos);
}

function draggedWidths(dragging: Dragging, clientX: number) {
  const dx = clientX - dragging.startX;
  const totalPx = dragging.leftPx + dragging.rightPx;
  const newLeftPx = Math.min(
    Math.max(dragging.leftPx + dx, dragging.minPx),
    totalPx - dragging.minPx
  );
  const newRightPx = totalPx - newLeftPx;
  return {
    leftPct: round1((newLeftPx / dragging.tableWidthPx) * 100),
    rightPct: round1((newRightPx / dragging.tableWidthPx) * 100),
  };
}

// Live preview during a drag, cell half: renders a `style="width:…%"`
// override on every dragged cell via decorations — the ProseMirror-
// sanctioned way to apply a transient visual change. A raw DOM edit to a
// cell doesn't work here: table_cell/table_header have no custom NodeView
// (contrast the colgroup, see `TableColgroupNodeView`), so there's nowhere
// to add an `ignoreMutation` override, and ProseMirror's DOM-mutation
// observer detects the unprotected edit and reverts it within
// milliseconds. `style` attrs from a node decoration are appended after
// (and so, per CSS cascade, win over) the cell's own `toDOM`-rendered
// `style`, and — being decorations rather than raw edits — never trip the
// observer.
//
// This alone isn't sufficient, though: `table-layout: fixed` gives an
// explicit `<colgroup>` width priority over a cell's own `style="width"`
// (CSS2.1 17.5.2.1), so once a column has already been resized once and
// gained a colgroup width, decorating its cells has no visible effect on
// its own — see the companion colgroup mutation in `move` (in
// `startDrag`), which is a raw DOM edit but a safe one (protected by
// `TableColgroupNodeView.ignoreMutation`). The two are kept in sync every
// frame; empirically (verified in Chromium), leaving either one on a
// stale value while the other changes renders a stale mix of old-and-new
// column widths.
function buildDragDecorations(state: EditorState, dragging: Dragging): Decoration[] {
  const { leftPct, rightPct } = draggedWidths(dragging, dragging.currentClientX);
  const decorations: Decoration[] = [];
  const addRange = (cells: CellRef[], pct: number) => {
    for (const { pos } of cells) {
      const node = state.doc.nodeAt(pos);
      if (!node) continue;
      decorations.push(
        Decoration.node(pos, pos + node.nodeSize, { style: `width:${pct}%` })
      );
    }
  };
  addRange(dragging.leftCells, leftPct);
  addRange(dragging.rightCells, rightPct);
  return decorations;
}

// Applies a plugin-only meta transaction directly via `view.updateState`
// instead of `view.dispatch`. This app's `dispatchTransaction` (see
// editor-view.tsx) forwards every dispatched transaction to the form's
// `onChange`, which is a React state update — fine for the occasional
// hover-boundary change, but the drag preview fires on every animation
// frame, and funneling that through React (60/sec, marking the form dirty
// the whole time for a change that isn't even part of the document) was
// enough to trip React's nested-update guard ("Maximum update depth
// exceeded"). `updateState` re-syncs the view's own DOM/decorations
// exactly like `dispatch` would, without involving React at all — the only
// transaction that should reach `dispatch` is the final commit on drop.
function updateViewMeta(view: EditorView, meta: unknown) {
  const tr = view.state.tr.setMeta(tableColumnResizingKey, meta);
  view.updateState(view.state.apply(tr));
}

// Commits the dragged pair's new split, and — in the same transaction —
// re-writes every other column's `widthPercent` to exactly the value it
// already had at drag start (see `dragging.effectiveWidths`). Nothing in
// the document changed for those columns during the drag, so this is a
// no-visual-op for them, but it converts them from "auto" (CSS distributes
// the remainder) to an explicit, committed value — which is what keeps a
// *future*, unrelated resize (or a column insert, see
// rebalanceColumnWidthsForInsert in commands/table.ts) from being able to
// shift them again.
function commitResize(view: EditorView, dragging: Dragging, leftPct: number, rightPct: number) {
  const widths = dragging.effectiveWidths.slice();
  widths[dragging.leftCol] = leftPct;
  widths[dragging.rightCol] = rightPct;

  const $cell = view.state.doc.resolve(dragging.leftCells[0].pos);
  const table = $cell.node(-1);
  const tableStart = $cell.start(-1);

  let tr = setAllColumnWidthPercents(view.state.tr, tableStart, table, widths);
  tr = tr.setMeta(tableColumnResizingKey, { setHandle: -1 });
  view.dispatch(tr);
}

function startDrag(view: EditorView, activeHandle: number, event: PointerEvent) {
  const $cell = view.state.doc.resolve(activeHandle);
  const table = $cell.node(-1);
  const map = TableMap.get(table);
  const tableStart = $cell.start(-1);
  const relPos = $cell.pos - tableStart;
  const leftCol = map.colCount(relPos);
  const rightCol = leftCol + 1;
  const leftCells = plainCellsInColumn(table, map, tableStart, leftCol);
  const rightCells = plainCellsInColumn(table, map, tableStart, rightCol);
  if (!leftCells.length || !rightCells.length) return;

  const leftDom = view.nodeDOM(activeHandle) as HTMLElement | null;
  const tableDom = leftDom?.closest('table') ?? null;
  const row = Math.floor(map.map.indexOf(relPos) / map.width);
  const rightRelPos = map.map[row * map.width + rightCol];
  const rightDom = view.nodeDOM(tableStart + rightRelPos) as HTMLElement | null;
  if (!leftDom || !rightDom || !tableDom) return;

  // The live preview writes straight into these two `<col>` elements (see
  // `move` below), in lockstep with the per-cell decorations built by
  // `buildDragDecorations` — see the comment there for why a table needs
  // *both* kept in sync every frame, not just one. `TableColgroupNodeView
  // .ignoreMutation` tells ProseMirror's DOM observer to leave attribute
  // changes inside the colgroup alone, so mutating it here directly is
  // safe — `syncColgroup` overwrites it with the authoritative value on
  // the next real state update (i.e. on commit, see `commitResize`).
  const colgroupCols = tableDom.querySelector(':scope > colgroup')?.children;

  const leftPx = leftDom.getBoundingClientRect().width;
  const rightPx = rightDom.getBoundingClientRect().width;
  const tableWidthPx = tableDom.getBoundingClientRect().width;
  const totalPx = leftPx + rightPx;
  const minPx = Math.min(MIN_COLUMN_WIDTH_PX, totalPx / 2);

  const dragging: Dragging = {
    startX: event.clientX,
    leftPx,
    rightPx,
    tableWidthPx,
    minPx,
    leftCells,
    rightCells,
    currentClientX: event.clientX,
    leftCol,
    rightCol,
    effectiveWidths: resolveEffectiveColumnWidths(table),
  };
  updateViewMeta(view, { setDragging: dragging });

  const win = view.dom.ownerDocument.defaultView ?? window;
  let lastClientX = event.clientX;
  let rafId: number | null = null;

  const move = (moveEvent: PointerEvent) => {
    lastClientX = moveEvent.clientX;
    if (rafId != null) return;
    rafId = win.requestAnimationFrame(() => {
      rafId = null;
      // refreshes the cell decorations (see buildDragDecorations) — must
      // come before the colgroup write below, since a state update may
      // re-invoke TableColgroupNodeView.update and reset the colgroup to
      // its last-committed (stale) value as a side effect
      updateViewMeta(view, { updateDragX: lastClientX });
      const { leftPct, rightPct } = draggedWidths(dragging, lastClientX);
      if (colgroupCols) {
        const leftColEl = colgroupCols[leftCol] as HTMLElement | undefined;
        const rightColEl = colgroupCols[rightCol] as HTMLElement | undefined;
        if (leftColEl) leftColEl.style.width = `${leftPct}%`;
        if (rightColEl) rightColEl.style.width = `${rightPct}%`;
      }
    });
  };
  const finish = () => {
    win.removeEventListener('pointermove', move);
    win.removeEventListener('pointerup', finish);
    if (rafId != null) {
      win.cancelAnimationFrame(rafId);
      rafId = null;
    }
    if (!tableColumnResizingKey.getState(view.state)?.dragging) return;
    const { leftPct, rightPct } = draggedWidths(dragging, lastClientX);
    commitResize(view, dragging, leftPct, rightPct);
  };
  win.addEventListener('pointermove', move);
  win.addEventListener('pointerup', finish);
}

// Percentage-based column resizing for tables: dragging a handle trades
// width between the two columns on either side of it (their combined width
// stays constant) instead of growing/shrinking the whole table, and commits
// the result as a `widthPercent` attr on every plain cell in each column —
// rendered as inline `style="width:…%"` (see `cellSpanDOMAttrs` in
// schema.tsx).
export function tableColumnResizing(): Plugin<PluginState> {
  return new Plugin<PluginState>({
    key: tableColumnResizingKey,
    state: {
      init: () => ({ activeHandle: -1, dragging: null }),
      apply(tr, prev) {
        const meta = tr.getMeta(tableColumnResizingKey);
        if (meta && 'setHandle' in meta) {
          return { activeHandle: meta.setHandle, dragging: null };
        }
        if (meta && 'setDragging' in meta) {
          return { ...prev, dragging: meta.setDragging };
        }
        if (meta && 'updateDragX' in meta && prev.dragging) {
          return {
            ...prev,
            dragging: { ...prev.dragging, currentClientX: meta.updateDragX },
          };
        }
        if (prev.activeHandle > -1 && tr.docChanged) {
          const mapped = tr.mapping.map(prev.activeHandle, -1);
          return {
            ...prev,
            activeHandle: pointsAtCell(tr.doc.resolve(mapped)) ? mapped : -1,
          };
        }
        return prev;
      },
    },
    props: {
      attributes(state): Record<string, string> {
        const pluginState = tableColumnResizingKey.getState(state);
        return pluginState && pluginState.activeHandle > -1
          ? { class: resizeCursorClass }
          : {};
      },
      decorations(state) {
        const pluginState = tableColumnResizingKey.getState(state);
        if (!pluginState?.dragging) return;
        return DecorationSet.create(
          state.doc,
          buildDragDecorations(state, pluginState.dragging)
        );
      },
      handleDOMEvents: {
        pointermove(view, event) {
          if (!view.editable) return false;
          const pluginState = tableColumnResizingKey.getState(view.state);
          if (!pluginState || pluginState.dragging) return false;
          const target = domCellAround(event.target);
          let handle = -1;
          if (target) {
            const rect = target.getBoundingClientRect();
            if (event.clientX - rect.left <= HANDLE_HITBOX) {
              handle = edgeCellPos(view, event, 'left');
            } else if (rect.right - event.clientX <= HANDLE_HITBOX) {
              handle = edgeCellPos(view, event, 'right');
            }
          }
          if (handle !== pluginState.activeHandle) {
            updateViewMeta(view, { setHandle: handle });
          }
          return false;
        },
        pointerleave(view) {
          const pluginState = tableColumnResizingKey.getState(view.state);
          if (pluginState && pluginState.activeHandle > -1 && !pluginState.dragging) {
            updateViewMeta(view, { setHandle: -1 });
          }
          return false;
        },
        pointerdown(view, event) {
          if (!view.editable) return false;
          const pluginState = tableColumnResizingKey.getState(view.state);
          if (!pluginState || pluginState.activeHandle === -1 || pluginState.dragging) {
            return false;
          }
          startDrag(view, pluginState.activeHandle, event);
          event.preventDefault();
          return true;
        },
      },
    },
  });
}

// A resizable boundary announces itself through the cursor alone — no painted
// line on the column's edge. The hitbox is geometric (see the `pointermove`
// handler), so nothing but the cursor depends on this.
const resizeCursorClass = css({
  '& td, & th': { cursor: 'col-resize' },
});
