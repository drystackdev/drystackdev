import { Node as ProseMirrorNode } from "prosemirror-model";
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import type { EditorState } from "prosemirror-state";

import { css, tokenSchema } from "@keystar/ui/style";

import { useEditorViewRef, useEditorState } from "./editor-view";
import { GRID_DEFAULT_COLUMNS, GRID_DEFAULT_ROWS, clampSpan } from "./grid";

// A ProseMirror editor is a *single* contenteditable, so `document.activeElement`
// is always the editor root — never an individual cell. That means CSS
// `:focus-within` on a cell never fires. Instead we ask the editor state
// whether the current selection lives inside this cell (by matching the cell's
// position against the selection's ancestors) and mark it as active ourselves.
function isSelectionInsideCell(state: EditorState, cellPos: number): boolean {
  const $from = state.selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    if ($from.before(depth) === cellPos) return true;
  }
  return false;
}

type NodeViewProps = {
  node: ProseMirrorNode;
  children: ReactNode;
  getPos: () => number | undefined;
};

// The grid container the editor actually renders. `data-dry-grid` matches the
// serialized markup so the resize handles can locate their container. `gap`
// comes from the node attr (editable from the toolbar). The container itself
// has no border/padding — the dashed edit affordance lives on each cell.
export function GridNodeView(props: NodeViewProps) {
  const columns: number = props.node.attrs.columns ?? GRID_DEFAULT_COLUMNS;
  const rows: number = props.node.attrs.rows ?? GRID_DEFAULT_ROWS;
  return (
    <div
      className={gridClass}
      style={{
        gap: props.node.attrs.gap,
        // track count is per-grid (node attr), so it lives inline rather than
        // in the static class
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
      data-dry-grid=""
    >
      {props.children}
    </div>
  );
}

// which dimension(s) a given handle drives — the corner handle drives both,
// the edge strips drive only their own axis
type ResizeAxis = "column" | "row" | "both";

type Drag = {
  axis: ResizeAxis;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  columnGap: number;
  rowGap: number;
  colPitch: number;
  rowPitch: number;
  columns: number;
  rows: number;
  lastSpan: number;
  lastRowSpan: number;
};

export function GridCellView(props: NodeViewProps) {
  const { node, children, getPos } = props;
  const span: number = node.attrs.span;
  const rowSpan: number = node.attrs.rowSpan;
  const place: string | null = node.attrs.place;

  // is the caret/selection currently inside this cell? drives the accent
  // "active item" outline (see isSelectionInsideCell for why not :focus-within)
  const editorState = useEditorState();
  const selfPos = getPos();
  const isActive =
    selfPos != null && isSelectionInsideCell(editorState, selfPos);

  const viewRef = useEditorViewRef();
  const getPosRef = useRef(getPos);
  getPosRef.current = getPos;
  const cellRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // live "span/columns  rowSpan/rows" readout, shown only while a resize
  // drag is active
  const [resizeLabel, setResizeLabel] = useState<{
    span: number;
    columns: number;
    rowSpan: number;
    rows: number;
  } | null>(null);

  const commitSpans = useCallback(
    (nextSpan: number, nextRowSpan: number) => {
      const view = viewRef.current;
      const pos = getPosRef.current();
      if (!view || pos == null) return;
      const current = view.state.doc.nodeAt(pos);
      if (!current) return;
      if (
        current.attrs.span === nextSpan &&
        current.attrs.rowSpan === nextRowSpan
      ) {
        return;
      }
      let tr = view.state.tr;
      if (current.attrs.span !== nextSpan) {
        tr = tr.setNodeAttribute(pos, "span", nextSpan);
      }
      if (current.attrs.rowSpan !== nextRowSpan) {
        tr = tr.setNodeAttribute(pos, "rowSpan", nextRowSpan);
      }
      view.dispatch(tr);
    },
    [viewRef],
  );

  const onDragMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      // (size + gap) / pitch == the unit count; snap to whole 1/N steps.
      // An edge strip only drives its own axis — the other stays put.
      const nextSpan =
        drag.axis === "row"
          ? drag.lastSpan
          : clampSpan(
              (drag.startWidth + dx + drag.columnGap) / drag.colPitch,
              drag.columns,
            );
      const nextRowSpan =
        drag.axis === "column"
          ? drag.lastRowSpan
          : clampSpan(
              (drag.startHeight + dy + drag.rowGap) / drag.rowPitch,
              drag.rows,
            );
      if (nextSpan !== drag.lastSpan || nextRowSpan !== drag.lastRowSpan) {
        drag.lastSpan = nextSpan;
        drag.lastRowSpan = nextRowSpan;
        commitSpans(nextSpan, nextRowSpan);
        setResizeLabel({
          span: nextSpan,
          columns: drag.columns,
          rowSpan: nextRowSpan,
          rows: drag.rows,
        });
      }
    },
    [commitSpans],
  );

  const onDragEnd = useCallback(() => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
    dragRef.current = null;
    setResizeLabel(null);
  }, [onDragMove]);

  const startDrag = useCallback(
    (event: ReactPointerEvent, axis: ResizeAxis) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const cell = cellRef.current;
      if (!cell) return;
      const rect = cell.getBoundingClientRect();
      const gridEl = cell.closest("[data-dry-grid]") as HTMLElement | null;
      const computed = gridEl ? getComputedStyle(gridEl) : null;
      const columnGap = (computed && parseFloat(computed.columnGap)) || 16;
      const rowGap = (computed && parseFloat(computed.rowGap)) || 16;
      // the grid's track counts live on the parent grid node — read them off
      // ProseMirror state so the drag snaps (and the readout reads) against
      // this grid's own column/row count
      const view = viewRef.current;
      const pos = getPosRef.current();
      let columns = GRID_DEFAULT_COLUMNS;
      let rows = GRID_DEFAULT_ROWS;
      if (view && pos != null) {
        const parent = view.state.doc.resolve(pos).parent;
        if (parent.type.name === "grid") {
          columns = parent.attrs.columns;
          rows = parent.attrs.rows;
        }
      }
      const startSpan = clampSpan(node.attrs.span, columns);
      const startRowSpan = clampSpan(node.attrs.rowSpan, rows);
      dragRef.current = {
        axis,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        columnGap,
        rowGap,
        // px per grid unit, gap included, derived from the cell's own size so
        // we never need to reason about where the row wraps
        colPitch: (rect.width + columnGap) / startSpan,
        rowPitch: (rect.height + rowGap) / startRowSpan,
        columns,
        rows,
        lastSpan: startSpan,
        lastRowSpan: startRowSpan,
      };
      setResizeLabel({ span: startSpan, columns, rowSpan: startRowSpan, rows });
      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", onDragEnd);
    },
    [node.attrs.span, node.attrs.rowSpan, onDragMove, onDragEnd, viewRef],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragEnd);
    };
  }, [onDragMove, onDragEnd]);

  const innerStyle: CSSProperties = place
    ? { display: "grid", placeContent: place as CSSProperties["placeContent"] }
    : {};

  return (
    <div
      ref={cellRef}
      className={cellClass}
      style={innerStyle}
      data-span={span}
      data-row-span={rowSpan}
      data-active={isActive || undefined}
    >
      {/* when the cell is placed (display:grid + place-content), wrap the
          editable content in a real block so the paragraphs aren't direct grid
          items — Chromium drops the caret from an *empty* editable grid item */}
      {place ? <div className={placeContentClass}>{children}</div> : children}
      {resizeLabel && (
        <span
          className={resizeBadgeClass}
          contentEditable={false}
          aria-hidden="true"
        >
          {resizeLabel.span}/{resizeLabel.columns} · {resizeLabel.rowSpan}/
          {resizeLabel.rows}
        </span>
      )}
      {/* invisible edge strips — hover to reveal, drag to resize a single
          axis (right edge: columns, bottom edge: rows) */}
      <span
        contentEditable={false}
        className={edgeHandleRightClass}
        data-resize-grip=""
        onPointerDown={(event) => startDrag(event, "column")}
        aria-hidden="true"
      />
      <span
        contentEditable={false}
        className={edgeHandleBottomClass}
        data-resize-grip=""
        onPointerDown={(event) => startDrag(event, "row")}
        aria-hidden="true"
      />
      {/* corner handle drives both dimensions at once — dragging
          horizontally resizes the column span, vertically the row span */}
      <span
        contentEditable={false}
        className={resizeHandleClass}
        data-resize-grip=""
        onPointerDown={(event) => startDrag(event, "both")}
        aria-hidden="true"
      >
        <GridResizeIcon />
      </span>
    </div>
  );
}

// dot-grid resize-corner glyph for the grid item's resize grip
function GridResizeIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="M22 22h-2v-2h2zm0-4h-2v-2h2zm-4 4h-2v-2h2zm0-4h-2v-2h2zm-4 4h-2v-2h2zm8-8h-2v-2h2z"
      />
    </svg>
  );
}

const gridClass = css({
  display: "grid",
  // `gap` and `grid-template-columns` are applied inline from the node attrs;
  // no border/padding on the container itself
  alignItems: "stretch",
});

// the single in-flow grid item that `place-content` positions when a cell is
// aligned; keeps the editable paragraphs as ordinary blocks (so they render a
// caret) rather than direct grid items
const placeContentClass = css({
  minWidth: 0,
});

const cellClass = css({
  position: "relative",
  height: "100%",
  boxSizing: "border-box",
  minWidth: 0,
  outline: `1px dashed ${tokenSchema.color.border.muted}`,
  // the resize grip appears while the cell is hovered or is the active item
  "&:hover [data-resize-grip], &[data-active] [data-resize-grip]": {
    opacity: 1,
  },
});

// diameter of the corner handle — the two edge strips below stop short of
// it (rather than overlapping) so each handle owns a clean hit zone
const CORNER_HANDLE_SIZE = 24;

// bottom-right corner grip — dragging it resizes both the column span
// (horizontal) and row span (vertical) in one gesture. Centered on the
// cell's corner point (offset by half its own size) rather than floating
// out in the gap, so it reads as attached to the corner.
const resizeHandleClass = css({
  position: "absolute",
  insetInlineEnd: -(CORNER_HANDLE_SIZE / 2),
  insetBlockEnd: -(CORNER_HANDLE_SIZE / 2),
  width: CORNER_HANDLE_SIZE,
  height: CORNER_HANDLE_SIZE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "nwse-resize",
  touchAction: "none",
  zIndex: 3,
  // hidden until the cell is hovered/focused (revealed by `cellClass`)
  opacity: 0,
  transition: "opacity 0.15s",
  color: tokenSchema.color.border.emphasis,
  "& svg": {
    width: "100%",
    height: "100%",
    transition: "color 0.15s, transform 0.15s",
  },
  "&:hover": {
    color: tokenSchema.color.alias.borderSelected,
  },
  "&:hover svg": {
    transform: "scale(1.15)",
  },
});

// right-edge strip — invisible until hovered, drags to resize the column
// span only. Runs the full height of the cell; where it overlaps the corner
// handle's zone, the corner wins (higher z-index) so the two don't fight
// over the same pixels.
const edgeHandleRightClass = css({
  position: "absolute",
  top: 0,
  bottom: 0,
  insetInlineEnd: `calc(${tokenSchema.size.space.small} * -1)`,
  width: tokenSchema.size.space.regular,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "col-resize",
  touchAction: "none",
  zIndex: 2,
  opacity: 0,
  transition: "opacity 0.15s",
});

// bottom-edge strip — mirrors the right-edge strip, resizing the row span
// only. Runs the full width of the cell; same corner overlap handling.
const edgeHandleBottomClass = css({
  position: "absolute",
  left: 0,
  right: 0,
  insetBlockEnd: `calc(${tokenSchema.size.space.small} * -1)`,
  height: tokenSchema.size.space.regular,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "row-resize",
  touchAction: "none",
  zIndex: 2,
  opacity: 0,
  transition: "opacity 0.15s",
});

// the "span/columns  rowSpan/rows" pill shown at the cell's top-right while
// resizing
const resizeBadgeClass = css({
  position: "absolute",
  top: tokenSchema.size.space.small,
  insetInlineEnd: tokenSchema.size.space.small,
  zIndex: 3,
  pointerEvents: "none",
  paddingBlock: tokenSchema.size.space.xsmall,
  paddingInline: tokenSchema.size.space.small,
  borderRadius: tokenSchema.size.radius.small,
  backgroundColor: tokenSchema.color.foreground.neutralSecondary,
  color: tokenSchema.color.foreground.inverse,
  fontSize: tokenSchema.typography.text.small.size,
  fontWeight: tokenSchema.typography.fontWeight.medium,
  lineHeight: 1,
  fontVariantNumeric: "tabular-nums",
  whiteSpace: "nowrap",
});
