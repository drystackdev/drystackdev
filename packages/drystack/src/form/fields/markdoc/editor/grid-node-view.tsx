import { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { css, tokenSchema } from '@keystar/ui/style';

import { useEditorViewRef } from './editor-view';
import { GRID_DEFAULT_COLUMNS, clampSpan } from './grid';

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
  return (
    <div
      className={gridClass}
      style={{
        gap: props.node.attrs.gap,
        // track count is per-grid (node attr), so it lives inline rather than
        // in the static class
        gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
      }}
      data-dry-grid=""
    >
      {props.children}
    </div>
  );
}

type Drag = {
  startX: number;
  startWidth: number;
  pitch: number;
  gap: number;
  columns: number;
  lastSpan: number;
};

export function GridCellView(props: NodeViewProps) {
  const { node, children, getPos } = props;
  const span: number = node.attrs.span;
  const place: string | null = node.attrs.place;

  const viewRef = useEditorViewRef();
  const getPosRef = useRef(getPos);
  getPosRef.current = getPos;
  const cellRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<Drag | null>(null);
  // live "span / columns" readout, shown only while a resize drag is active
  const [resizeLabel, setResizeLabel] = useState<{
    span: number;
    columns: number;
  } | null>(null);

  const commitSpan = useCallback(
    (nextSpan: number) => {
      const view = viewRef.current;
      const pos = getPosRef.current();
      if (!view || pos == null) return;
      if (view.state.doc.nodeAt(pos)?.attrs.span === nextSpan) return;
      view.dispatch(view.state.tr.setNodeAttribute(pos, 'span', nextSpan));
    },
    [viewRef]
  );

  const onDragMove = useCallback(
    (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const dx = event.clientX - drag.startX;
      // (width + gap) / pitch == the unit count; snap to whole 1/N steps
      const next = clampSpan(
        (drag.startWidth + dx + drag.gap) / drag.pitch,
        drag.columns
      );
      if (next !== drag.lastSpan) {
        drag.lastSpan = next;
        commitSpan(next);
        setResizeLabel({ span: next, columns: drag.columns });
      }
    },
    [commitSpan]
  );

  const onDragEnd = useCallback(() => {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    dragRef.current = null;
    setResizeLabel(null);
  }, [onDragMove]);

  const startDrag = useCallback(
    (event: ReactPointerEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      const cell = cellRef.current;
      if (!cell) return;
      const rect = cell.getBoundingClientRect();
      const gridEl = cell.closest('[data-dry-grid]') as HTMLElement | null;
      const gap = gridEl
        ? parseFloat(getComputedStyle(gridEl).columnGap) || 16
        : 16;
      // the grid's track count lives on the parent grid node — read it off
      // ProseMirror state so the drag snaps (and the readout reads) against
      // this grid's own column count
      const view = viewRef.current;
      const pos = getPosRef.current();
      let columns = GRID_DEFAULT_COLUMNS;
      if (view && pos != null) {
        const parent = view.state.doc.resolve(pos).parent;
        if (parent.type.name === 'grid') columns = parent.attrs.columns;
      }
      const startSpan = clampSpan(node.attrs.span, columns);
      dragRef.current = {
        startX: event.clientX,
        startWidth: rect.width,
        // px per grid unit, gap included, derived from the cell's own size so
        // we never need to reason about where the row wraps
        pitch: (rect.width + gap) / startSpan,
        gap,
        columns,
        lastSpan: startSpan,
      };
      setResizeLabel({ span: startSpan, columns });
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
    },
    [node.attrs.span, onDragMove, onDragEnd, viewRef]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
    };
  }, [onDragMove, onDragEnd]);

  const innerStyle: CSSProperties = place
    ? { display: 'grid', placeContent: place as CSSProperties['placeContent'] }
    : {};

  return (
    <div
      ref={cellRef}
      className={cellClass}
      style={innerStyle}
      data-span={span}
    >
      {children}
      {resizeLabel && (
        <span className={resizeBadgeClass} contentEditable={false} aria-hidden="true">
          {resizeLabel.span}/{resizeLabel.columns}
        </span>
      )}
      <span
        contentEditable={false}
        className={resizeHandleClass}
        data-resize-grip=""
        onPointerDown={startDrag}
        aria-hidden="true"
      />
    </div>
  );
}

const gridClass = css({
  display: 'grid',
  // `gap` and `grid-template-columns` are applied inline from the node attrs;
  // no border/padding on the container itself
  alignItems: 'stretch',
  marginBlock: '1em',
});

const cellClass = css({
  position: 'relative',
  // fill the grid item (the PM-tracked container stretches to the row's
  // height via `align-items: stretch`) so vertical `place-content` has room
  // to work across cells of differing content height
  height: '100%',
  boxSizing: 'border-box',
  minHeight: tokenSchema.size.scale[600],
  minWidth: 0,
  borderRadius: tokenSchema.size.radius.small,
  padding: tokenSchema.size.space.small,
  outline: `1px dashed ${tokenSchema.color.border.muted}`,
  outlineOffset: -1,
  // click a cell to focus it — a solid, saturated primary/accent outline
  // (foreground.accent = the strong indigo, not the faint indigo6 border
  // token) makes it obvious which item is the active target
  '&:focus-within': {
    outline: `2px solid ${tokenSchema.color.foreground.accent}`,
    outlineOffset: -1,
  },
  // the resize grip only appears while the cell is hovered or focused
  '&:hover [data-resize-grip], &:focus-within [data-resize-grip]': {
    opacity: 1,
  },
});

const resizeHandleClass = css({
  position: 'absolute',
  top: 0,
  bottom: 0,
  // straddle the cell's right edge (sitting in the grid gap) with a wide
  // enough hit zone to grab easily
  insetInlineEnd: `calc(${tokenSchema.size.space.regular} * -0.5)`,
  width: tokenSchema.size.space.large,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'col-resize',
  touchAction: 'none',
  zIndex: 2,
  // hidden until the cell is hovered/focused (revealed by `cellClass`)
  opacity: 0,
  transition: 'opacity 0.15s',
  // a vertical grip; highlighted when the grip itself is hovered
  '&::after': {
    content: '""',
    height: '55%',
    minHeight: 20,
    width: tokenSchema.size.space.xsmall,
    borderRadius: tokenSchema.size.radius.full,
    backgroundColor: tokenSchema.color.border.emphasis,
    transition: 'background-color 0.15s, transform 0.15s',
  },
  '&:hover::after': {
    backgroundColor: tokenSchema.color.alias.borderSelected,
    transform: 'scaleX(1.6)',
  },
});

// the "span / columns" pill shown at the cell's top-right while resizing
const resizeBadgeClass = css({
  position: 'absolute',
  top: tokenSchema.size.space.small,
  insetInlineEnd: tokenSchema.size.space.small,
  zIndex: 3,
  pointerEvents: 'none',
  paddingBlock: tokenSchema.size.space.xsmall,
  paddingInline: tokenSchema.size.space.small,
  borderRadius: tokenSchema.size.radius.small,
  backgroundColor: tokenSchema.color.foreground.neutralSecondary,
  color: tokenSchema.color.foreground.inverse,
  fontSize: tokenSchema.typography.text.small.size,
  fontWeight: tokenSchema.typography.fontWeight.medium,
  lineHeight: 1,
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
});

