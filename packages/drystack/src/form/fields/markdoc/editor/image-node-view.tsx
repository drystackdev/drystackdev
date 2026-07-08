import { Node as ProseMirrorNode } from 'prosemirror-model';
import {
  CSSProperties,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';

import { ToggleButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { alignCenterIcon } from '@keystar/ui/icon/icons/alignCenterIcon';
import { alignLeftIcon } from '@keystar/ui/icon/icons/alignLeftIcon';
import { alignRightIcon } from '@keystar/ui/icon/icons/alignRightIcon';
import { link2Icon } from '@keystar/ui/icon/icons/link2Icon';
import { link2OffIcon } from '@keystar/ui/icon/icons/link2OffIcon';
import { Flex } from '@keystar/ui/layout';
import { NumberField } from '@keystar/ui/number-field';
import { css, tokenSchema } from '@keystar/ui/style';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';

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

function useImageObjectUrl(node: ProseMirrorNode): string | undefined {
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

function wrapperAlignStyle(align: ImageAlign | null): CSSProperties {
  if (align === 'left') {
    return { float: 'left', marginInlineEnd: '1em', marginBlockEnd: '0.5em' };
  }
  if (align === 'right') {
    return { float: 'right', marginInlineStart: '1em', marginBlockEnd: '0.5em' };
  }
  if (align === 'center') {
    return { display: 'block', marginInline: 'auto' };
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
  const lockedRef = useRef(false);
  const getPosRef = useRef(props.getPos);
  getPosRef.current = props.getPos;

  const [locked, setLocked] = useState(false);
  lockedRef.current = locked;
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

  const ratioForField = () => {
    const img = imgRef.current;
    return (
      naturalRatioRef.current ??
      (img && img.naturalHeight
        ? img.naturalWidth / img.naturalHeight
        : renderedSize && renderedSize.height
          ? renderedSize.width / renderedSize.height
          : 1)
    );
  };

  const onWidthField = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const w = Math.round(value);
    commitAttrs({
      width: w,
      height: locked ? Math.round(w / ratioForField()) : height,
    });
  };
  const onHeightField = (value: number) => {
    if (!Number.isFinite(value) || value <= 0) return;
    const h = Math.round(value);
    commitAttrs({
      height: h,
      width: locked ? Math.round(h * ratioForField()) : width,
    });
  };

  const toggleAlign = (value: ImageAlign) => {
    commitAttrs({ align: (align === value ? null : value) as any });
  };

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

      {showControls && (
        <>
          {HANDLES.map(handle => (
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

          <div
            contentEditable={false}
            className={toolbarClass}
            onPointerDown={event => event.stopPropagation()}
            onMouseDown={event => event.stopPropagation()}
          >
            <Flex gap="regular" alignItems="center">
              <NumberField
                aria-label="Width (px)"
                width="scale.1000"
                minValue={MIN_SIZE}
                step={1}
                hideStepper
                value={displayWidth ?? undefined}
                onChange={onWidthField}
              />
              <TooltipTrigger>
                <ToggleButton
                  prominence="low"
                  isSelected={locked}
                  aria-label="Lock aspect ratio"
                  onPress={() => setLocked(v => !v)}
                >
                  <Icon src={locked ? link2Icon : link2OffIcon} />
                </ToggleButton>
                <Tooltip>Lock aspect ratio</Tooltip>
              </TooltipTrigger>
              <NumberField
                aria-label="Height (px)"
                width="scale.1000"
                minValue={MIN_SIZE}
                step={1}
                hideStepper
                value={displayHeight ?? undefined}
                onChange={onHeightField}
              />
              <TooltipTrigger>
                <ToggleButton
                  prominence="low"
                  isSelected={align === 'left'}
                  aria-label="Float left"
                  onPress={() => toggleAlign('left')}
                >
                  <Icon src={alignLeftIcon} />
                </ToggleButton>
                <Tooltip>Float left</Tooltip>
              </TooltipTrigger>
              <TooltipTrigger>
                <ToggleButton
                  prominence="low"
                  isSelected={align === 'center'}
                  aria-label="Center"
                  onPress={() => toggleAlign('center')}
                >
                  <Icon src={alignCenterIcon} />
                </ToggleButton>
                <Tooltip>Center</Tooltip>
              </TooltipTrigger>
              <TooltipTrigger>
                <ToggleButton
                  prominence="low"
                  isSelected={align === 'right'}
                  aria-label="Float right"
                  onPress={() => toggleAlign('right')}
                >
                  <Icon src={alignRightIcon} />
                </ToggleButton>
                <Tooltip>Float right</Tooltip>
              </TooltipTrigger>
            </Flex>
          </div>
        </>
      )}
    </span>
  );
}

const wrapperClass = css({
  '&[data-selected="true"] img': {
    outline: `2px solid ${tokenSchema.color.alias.borderSelected}`,
    outlineOffset: 2,
  },
});

const handleClass = css({
  position: 'absolute',
  width: 10,
  height: 10,
  marginLeft: -5,
  marginTop: -5,
  boxSizing: 'border-box',
  borderRadius: 2,
  backgroundColor: tokenSchema.color.background.canvas,
  border: `2px solid ${tokenSchema.color.alias.borderSelected}`,
  zIndex: 1,
});

const toolbarClass = css({
  position: 'absolute',
  bottom: '100%',
  left: '50%',
  transform: 'translate(-50%, -8px)',
  zIndex: 2,
  padding: tokenSchema.size.space.regular,
  borderRadius: tokenSchema.size.radius.medium,
  backgroundColor: tokenSchema.color.background.surface,
  border: `${tokenSchema.size.border.regular} solid ${tokenSchema.color.border.neutral}`,
  boxShadow: `0 1px 4px ${tokenSchema.color.shadow.regular}`,
  whiteSpace: 'nowrap',
});
