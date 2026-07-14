import { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  useCallback,
  useEffect,
  useRef,
} from 'react';

import { css, tokenSchema } from '@keystar/ui/style';
import { Icon } from '@keystar/ui/icon';
import { plusIcon } from '@keystar/ui/icon/icons/plusIcon';

import { useEditorViewRef } from './editor-view';
import {
  GRID_COLUMNS,
  GRID_DEFAULT_SPAN,
  GRID_GAP,
  clampSpan,
} from './grid';

type NodeViewProps = {
  node: ProseMirrorNode;
  children: ReactNode;
  getPos: () => number | undefined;
};

// The grid container the editor actually renders. `data-dry-grid` matches the
// serialized markup so the resize handles can locate their container, and the
// dashed border is an edit-only affordance (this class never reaches the
// published HTML — that comes from the serializer, not from here).
export function GridNodeView(props: NodeViewProps) {
  const { children, getPos } = props;
  const viewRef = useEditorViewRef();
  const getPosRef = useRef(getPos);
  getPosRef.current = getPos;

  const appendCell = useCallback(() => {
    const view = viewRef.current;
    const pos = getPosRef.current();
    if (!view || pos == null) return;
    const gridNode = view.state.doc.nodeAt(pos);
    if (!gridNode) return;
    const cellType = view.state.schema.nodes.grid_cell;
    const paragraphType = view.state.schema.nodes.paragraph;
    const newCell = cellType?.createAndFill(
      { span: GRID_DEFAULT_SPAN },
      paragraphType?.createAndFill() ?? undefined
    );
    if (!newCell) return;
    view.dispatch(
      view.state.tr.insert(pos + gridNode.nodeSize - 1, newCell)
    );
    view.focus();
  }, [viewRef]);

  return (
    <div className={gridClass} data-dry-grid="">
      {children}
      {/* the always-present trailing "+" appender — an editor affordance, not
          a real node, so it never serializes */}
      <button
        type="button"
        contentEditable={false}
        className={appendCellClass}
        // keep the pointer-down from collapsing the selection before click
        onMouseDown={event => event.preventDefault()}
        onClick={appendCell}
        aria-label="Add cell"
      >
        <Icon src={plusIcon} />
      </button>
    </div>
  );
}

type Drag = {
  startX: number;
  startWidth: number;
  pitch: number;
  gap: number;
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
      // (width + gap) / pitch == the unit count; snap to whole 1/24 steps
      const next = clampSpan((drag.startWidth + dx + drag.gap) / drag.pitch);
      if (next !== drag.lastSpan) {
        drag.lastSpan = next;
        commitSpan(next);
      }
    },
    [commitSpan]
  );

  const onDragEnd = useCallback(() => {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    dragRef.current = null;
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
      const startSpan = clampSpan(node.attrs.span);
      dragRef.current = {
        startX: event.clientX,
        startWidth: rect.width,
        // px per grid unit, gap included, derived from the cell's own size so
        // we never need to reason about where the row wraps
        pitch: (rect.width + gap) / startSpan,
        gap,
        lastSpan: startSpan,
      };
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
    },
    [node.attrs.span, onDragMove, onDragEnd]
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
      <span
        contentEditable={false}
        className={resizeHandleClass}
        onPointerDown={startDrag}
        aria-hidden="true"
      />
    </div>
  );
}

const gridClass = css({
  display: 'grid',
  gridTemplateColumns: `repeat(${GRID_COLUMNS}, minmax(0, 1fr))`,
  gap: GRID_GAP,
  alignItems: 'stretch',
  border: `1px dashed ${tokenSchema.color.border.neutral}`,
  borderRadius: tokenSchema.size.radius.regular,
  padding: tokenSchema.size.space.regular,
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
  // click a cell to focus it — just an outline, no fill (per the design)
  '&:focus-within': {
    outline: `2px solid ${tokenSchema.color.alias.borderSelected}`,
  },
});

const resizeHandleClass = css({
  position: 'absolute',
  top: 0,
  bottom: 0,
  insetInlineEnd: -tokenSchema.size.space.small,
  width: tokenSchema.size.space.medium,
  cursor: 'col-resize',
  touchAction: 'none',
  zIndex: 1,
  '&::after': {
    content: '""',
    position: 'absolute',
    top: '50%',
    insetInlineEnd: '50%',
    transform: 'translate(50%, -50%)',
    height: '40%',
    width: 2,
    borderRadius: 1,
    backgroundColor: tokenSchema.color.border.emphasis,
    opacity: 0,
  },
  '&:hover::after': {
    opacity: 1,
  },
});

const appendCellClass = css({
  gridColumn: 'span 2',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: tokenSchema.size.scale[600],
  border: `1px dashed ${tokenSchema.color.border.neutral}`,
  borderRadius: tokenSchema.size.radius.small,
  color: tokenSchema.color.foreground.neutralSecondary,
  backgroundColor: 'transparent',
  cursor: 'pointer',
  '&:hover': {
    borderColor: tokenSchema.color.alias.borderHovered,
    color: tokenSchema.color.foreground.neutral,
  },
});
