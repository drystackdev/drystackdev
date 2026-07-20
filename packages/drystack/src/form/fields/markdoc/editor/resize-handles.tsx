// Drag-to-resize handles shared by the `image` and `svg` node views.
//
// Both nodes carry the same width/height/lockAspectRatio attrs and resize
// identically from the reader's point of view, so the behaviour lives here
// rather than in either view: an inline drawing should not resize subtly
// differently from an inline picture just because one is markup and the other
// is bytes. The views keep only what actually differs - what they render, and
// where the natural aspect ratio comes from.

import {
  CSSProperties,
  MutableRefObject,
  PointerEvent as ReactPointerEvent,
  RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { css, tokenSchema } from "@keystar/ui/style";

import { useEditorViewRef } from "./editor-view";

export const MIN_SIZE = 24;

type HandleDir = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

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
  {
    dir: "nw",
    hx: -1,
    vy: -1,
    cursor: "nwse-resize",
    position: { top: 0, left: 0 },
  },
  {
    dir: "n",
    hx: 0,
    vy: -1,
    cursor: "ns-resize",
    position: { top: 0, left: "50%" },
  },
  {
    dir: "ne",
    hx: 1,
    vy: -1,
    cursor: "nesw-resize",
    position: { top: 0, left: "100%" },
  },
  {
    dir: "e",
    hx: 1,
    vy: 0,
    cursor: "ew-resize",
    position: { top: "50%", left: "100%" },
  },
  {
    dir: "se",
    hx: 1,
    vy: 1,
    cursor: "nwse-resize",
    position: { top: "100%", left: "100%" },
  },
  {
    dir: "s",
    hx: 0,
    vy: 1,
    cursor: "ns-resize",
    position: { top: "100%", left: "50%" },
  },
  {
    dir: "sw",
    hx: -1,
    vy: 1,
    cursor: "nesw-resize",
    position: { top: "100%", left: 0 },
  },
  {
    dir: "w",
    hx: -1,
    vy: 0,
    cursor: "ew-resize",
    position: { top: "50%", left: 0 },
  },
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

export function useResizeHandles(opts: {
  // The element being resized - measured on drag start, so it must be the box
  // the handles visually surround, not the node view's outer container.
  targetRef: RefObject<Element | null>;
  // The node's current explicit width, if it has one. Only read when the lock
  // is switched on, to resync height against it.
  width: number | null;
  locked: boolean;
  // Filled in by the view once it knows the content's intrinsic ratio (an
  // image's `naturalWidth/naturalHeight`, an svg's `viewBox`). A ref rather
  // than a value because it's often learned asynchronously, after a load.
  naturalRatioRef: MutableRefObject<number | null>;
  getPos: () => number | undefined;
}) {
  const { targetRef, width, locked, naturalRatioRef } = opts;
  const viewRef = useEditorViewRef();
  const dragRef = useRef<DragState | null>(null);
  const [dragSize, setDragSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const lockedRef = useRef(locked);
  lockedRef.current = locked;
  const getPosRef = useRef(opts.getPos);
  getPosRef.current = opts.getPos;

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
    [viewRef],
  );

  const onDragMove = useCallback((event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    let w = Math.max(MIN_SIZE, drag.startWidth + drag.hx * dx);
    let h = Math.max(MIN_SIZE, drag.startHeight + drag.vy * dy);
    if (lockedRef.current) {
      // keep the aspect ratio: the horizontal handles drive width, the
      // top/bottom edge handles drive height.
      if (drag.hx !== 0) h = w / drag.ratio;
      else w = h * drag.ratio;
    }
    drag.lastWidth = Math.round(w);
    drag.lastHeight = Math.round(h);
    setDragSize({ width: drag.lastWidth, height: drag.lastHeight });
  }, []);

  const onDragEnd = useCallback(() => {
    window.removeEventListener("pointermove", onDragMove);
    window.removeEventListener("pointerup", onDragEnd);
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
      const target = targetRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const ratio =
        naturalRatioRef.current ?? (rect.height ? rect.width / rect.height : 1);
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
      window.addEventListener("pointermove", onDragMove);
      window.addEventListener("pointerup", onDragEnd);
    },
    [naturalRatioRef, onDragEnd, onDragMove, targetRef],
  );

  useEffect(() => {
    return () => {
      window.removeEventListener("pointermove", onDragMove);
      window.removeEventListener("pointerup", onDragEnd);
    };
  }, [onDragEnd, onDragMove]);

  // the lock toggle (in the node's edit popover) only flips the attr - as
  // soon as it flips on, resync height to the natural ratio at the *current*
  // width, rather than waiting for the next resize to notice
  const wasLockedRef = useRef(locked);
  useEffect(() => {
    const wasLocked = wasLockedRef.current;
    wasLockedRef.current = locked;
    if (wasLocked || !locked) return;
    const ratio = naturalRatioRef.current;
    const w = width ?? targetRef.current?.getBoundingClientRect().width;
    if (ratio && w) {
      commitAttrs({ height: Math.round(w / ratio) });
    }
  }, [locked, width, commitAttrs, naturalRatioRef, targetRef]);

  return { dragSize, commitAttrs, startDrag };
}

export function ResizeHandles(props: {
  onStart: (handle: Handle, event: ReactPointerEvent) => void;
}) {
  return (
    <>
      {HANDLES.map((handle) => (
        <span
          key={handle.dir}
          contentEditable={false}
          onPointerDown={(event) => props.onStart(handle, event)}
          className={handleClass}
          style={{ ...handle.position, cursor: handle.cursor }}
        />
      ))}
    </>
  );
}

// outlining the node view's own wrapper (rather than the content nested inside
// it) so a block-level, centered wrapper is outlined as one block, matching how
// the browser actually lays it out
export const selectableWrapperClass = css({
  '&[data-selected="true"]': {
    outline: `2px solid ${tokenSchema.color.alias.borderSelected}`,
  },
});

const handleClass = css({
  position: "absolute",
  width: 10,
  height: 10,
  transform: "translate(-50%, -50%)",
  boxSizing: "border-box",
  borderRadius: "50%",
  backgroundColor: tokenSchema.color.background.canvas,
  border: `2px solid ${tokenSchema.color.alias.borderSelected}`,
  zIndex: 1,
});
