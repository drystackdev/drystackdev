import { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { css, tokenSchema } from '@keystar/ui/style';

import { resolveMediaLibraryBytes } from '../../../../app/media-library/bridge';
import { useEditorSchema, useEditorViewRef } from './editor-view';
import { ImageAlign } from './image-layout';

const MIN_SIZE = 24;

type HandleDir = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';

type Handle = {
  dir: HandleDir;
  hx: -1 | 0 | 1;
  vy: -1 | 0 | 1;
  cursor: string;
  position: CSSProperties;
};

// 4 corners + 4 edge midpoints. `hx`/`vy` say which side the handle sits on:
// +1 = east/south (drag towards + grows), -1 = west/north (drag towards + shrinks).
const HANDLES: Handle[] = [
  { dir: 'nw', hx: -1, vy: -1, cursor: 'nwse-resize', position: { top: 0, left: 0 } },
  { dir: 'n', hx: 0, vy: -1, cursor: 'ns-resize', position: { top: 0, left: '50%' } },
  { dir: 'ne', hx: 1, vy: -1, cursor: 'nesw-resize', position: { top: 0, left: '100%' } },
  { dir: 'e', hx: 1, vy: 0, cursor: 'ew-resize', position: { top: '50%', left: '100%' } },
  { dir: 'se', hx: 1, vy: 1, cursor: 'nwse-resize', position: { top: '100%', left: '100%' } },
  { dir: 's', hx: 0, vy: 1, cursor: 'ns-resize', position: { top: '100%', left: '50%' } },
  { dir: 'sw', hx: -1, vy: 1, cursor: 'nesw-resize', position: { top: '100%', left: 0 } },
  { dir: 'w', hx: -1, vy: 0, cursor: 'ew-resize', position: { top: '50%', left: 0 } },
];

type DragState = {
  hx: number;
  vy: number;
  startX: number;
  startY: number;
  startWidth: number;
  startHeight: number;
  ratio: number;
  lastWidth: number;
  lastHeight: number;
};

export function useImageObjectUrl(node: ProseMirrorNode): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  const src: Uint8Array = node.attrs.src;
  const filename: string = node.attrs.filename;
  useEffect(() => {
    let cancelled = false;
    let created: string | undefined;
    const setFromBytes = (bytes: Uint8Array) => {
      const blob = new Blob([bytes], {
        type: filename.endsWith('.svg') ? 'image/svg+xml' : undefined,
      });
      created = URL.createObjectURL(blob);
      setUrl(created);
    };
    if (src.byteLength > 0) {
      setFromBytes(src);
    } else {
      // parsed from stored HTML without embedded bytes; the media library
      // directory is the source of truth for the actual file content
      resolveMediaLibraryBytes(filename).then(bytes => {
        if (cancelled || !bytes) return;
        setFromBytes(bytes);
      });
    }
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src, filename]);
  return url;
}

// `float` (left/right) is applied to the outer, ProseMirror-tracked node
// view container instead — see `imageContainerAlignStyle` — not here.
// Floated content is taken out of normal flow, so if it only floated at
// this inner level, the outer container (which `view.nodeDOM` and popover
// positioning rely on) would have no in-flow content to size itself by
// and would collapse to a zero-size box at its text position.
function wrapperAlignStyle(align: ImageAlign | null): CSSProperties {
  if (align === 'center') {
    return { display: 'block', marginInline: 'auto' };
  }
  return {};
}

// Applied to the outer node view container (see react-node-views.tsx's
// `containerStyle`) so the float itself — and thus the box everything
// measures the image node by — lives on the element ProseMirror actually
// tracks, not several layers of React-rendered content deep inside it.
export function imageContainerAlignStyle(align: ImageAlign | null): CSSProperties {
  if (align === 'left') {
    return { float: 'left', marginInlineEnd: '1em', marginBlockEnd: '0.5em' };
  }
  if (align === 'right') {
    return { float: 'right', marginInlineStart: '1em', marginBlockEnd: '0.5em' };
  }
  return {};
}

export function ImageNodeView(props: {
  node: ProseMirrorNode;
  hasNodeSelection: boolean;
  isNodeCompletelyWithinSelection: boolean;
  getPos: () => number | undefined;
}) {
  const { node } = props;
  const width: number | null = node.attrs.width;
  const height: number | null = node.attrs.height;
  const align: ImageAlign | null = node.attrs.align;

  const schema = useEditorSchema();
  const editable = schema.config.htmlLayout;
  const isSelected =
    props.hasNodeSelection || props.isNodeCompletelyWithinSelection;

  const viewRef = useEditorViewRef();
  const objectUrl = useImageObjectUrl(node);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const naturalRatioRef = useRef<number | null>(null);
  const dragRef = useRef<DragState | null>(null);
  // the lock toggle lives in the image edit popover now; the node attr is
  // the shared source of truth between that toggle and this drag handling
  const locked: boolean = node.attrs.lockAspectRatio ?? true;
  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const getPosRef = useRef(props.getPos);
  getPosRef.current = props.getPos;

  const [dragSize, setDragSize] = useState<{
    width: number;
    height: number;
  } | null>(null);
  const [renderedSize, setRenderedSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const commitAttrs = useCallback(
    (patch: Record<string, number | null>) => {
      const pos = getPosRef.current();
      const view = viewRef.current;
      if (pos == null || !view) return;
      let tr = view.state.tr;
      for (const [key, value] of Object.entries(patch)) {
        tr = tr.setNodeAttribute(pos, key, value);
      }
      view.dispatch(tr);
    },
    [viewRef]
  );

  const onDragMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let w = Math.max(MIN_SIZE, drag.startWidth + drag.hx * dx);
    let h = Math.max(MIN_SIZE, drag.startHeight + drag.vy * dy);
    if (lockedRef.current) {
      // keep the image's aspect ratio: the horizontal handles drive width, the
      // top/bottom edge handles drive height.
      if (drag.hx !== 0) h = w / drag.ratio;
      else w = h * drag.ratio;
    }
    drag.lastWidth = Math.round(w);
    drag.lastHeight = Math.round(h);
    setDragSize({ width: drag.lastWidth, height: drag.lastHeight });
  }, []);

  const onDragEnd = useCallback(() => {
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    const drag = dragRef.current;
    dragRef.current = null;
    setDragSize(null);
    if (drag) {
      commitAttrs({ width: drag.lastWidth, height: drag.lastHeight });
    }
  }, [commitAttrs, onDragMove]);

  const startDrag = useCallback(
    (handle: Handle, event: ReactPointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      const img = imgRef.current;
      if (!img) return;
      const rect = img.getBoundingClientRect();
      const ratio =
        naturalRatioRef.current ??
        (rect.height ? rect.width / rect.height : 1);
      dragRef.current = {
        hx: handle.hx,
        vy: handle.vy,
        startX: event.clientX,
        startY: event.clientY,
        startWidth: rect.width,
        startHeight: rect.height,
        ratio,
        lastWidth: Math.round(rect.width),
        lastHeight: Math.round(rect.height),
      };
      setDragSize({
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
      window.addEventListener('pointermove', onDragMove);
      window.addEventListener('pointerup', onDragEnd);
    },
    [onDragEnd, onDragMove]
  );

  useEffect(() => {
    return () => {
      window.removeEventListener('pointermove', onDragMove);
      window.removeEventListener('pointerup', onDragEnd);
    };
  }, [onDragEnd, onDragMove]);

  // the lock toggle (in the image edit popover) only flips the attr — as
  // soon as it flips on, resync height to the image's natural ratio at the
  // *current* width, rather than waiting for the next resize to notice
  const wasLockedRef = useRef(locked);
  useEffect(() => {
    const wasLocked = wasLockedRef.current;
    wasLockedRef.current = locked;
    if (wasLocked || !locked) return;
    const ratio = naturalRatioRef.current;
    const w = width ?? imgRef.current?.getBoundingClientRect().width;
    if (ratio && w) {
      commitAttrs({ height: Math.round(w / ratio) });
    }
  }, [locked, width, commitAttrs]);

  const displayWidth = dragSize?.width ?? width ?? renderedSize?.width;
  const displayHeight = dragSize?.height ?? height ?? renderedSize?.height;

  const imgStyle: CSSProperties = {
    display: 'block',
    borderRadius: tokenSchema.size.radius.regular,
    maxWidth: '100%',
    maxHeight:
      dragSize?.height != null || height != null
        ? undefined
        : tokenSchema.size.scale[3600],
    width: dragSize?.width ?? width ?? undefined,
    height: dragSize?.height ?? height ?? undefined,
    objectFit: displayWidth != null && displayHeight != null ? 'contain' : undefined,
  };

  const wrapperStyle: CSSProperties = {
    position: 'relative',
    display: align === 'center' ? 'block' : 'inline-block',
    // a block-level, non-replaced <span> would otherwise stretch to fill the
    // paragraph's full width — shrink it back to the image's own size so the
    // outline (and the `margin-inline: auto` centering) apply to the image,
    // not an invisible full-width box around it
    width: align === 'center' ? 'fit-content' : undefined,
    lineHeight: 0,
    ...wrapperAlignStyle(align),
  };

  const showControls = editable && isSelected;

  return (
    <span style={wrapperStyle} className={wrapperClass} data-selected={isSelected}>
      <img
        ref={imgRef}
        src={objectUrl}
        alt={node.attrs.alt}
        title={node.attrs.title || undefined}
        data-filename={node.attrs.filename}
        draggable={false}
        style={imgStyle}
        onLoad={event => {
          const img = event.currentTarget;
          if (img.naturalHeight) {
            naturalRatioRef.current = img.naturalWidth / img.naturalHeight;
          }
          const rect = img.getBoundingClientRect();
          setRenderedSize({
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          });
        }}
      />

      {showControls &&
        HANDLES.map(handle => (
          <span
            key={handle.dir}
            contentEditable={false}
            onPointerDown={event => startDrag(handle, event)}
            className={handleClass}
            style={{
              ...handle.position,
              cursor: handle.cursor,
            }}
          />
        ))}
    </span>
  );
}

const wrapperClass = css({
  // outlining the wrapper itself (rather than the nested `img`) so a
  // block-level, centered wrapper is outlined as one block, matching how the
  // browser actually lays it out
  '&[data-selected="true"]': {
    outline: `2px solid ${tokenSchema.color.alias.borderSelected}`,
  },
});

const handleClass = css({
  position: 'absolute',
  width: 10,
  height: 10,
  transform: 'translate(-50%, -50%)',
  boxSizing: 'border-box',
  borderRadius: '50%',
  backgroundColor: tokenSchema.color.background.canvas,
  border: `2px solid ${tokenSchema.color.alias.borderSelected}`,
  zIndex: 1,
});
