import { Node as ProseMirrorNode } from "prosemirror-model";
import { CSSProperties, useEffect, useRef, useState } from "react";

import { tokenSchema } from "@keystar/ui/style";

import { resolveMediaLibraryBytes } from "../../../../app/media-library/bridge";
import { useEditorSchema } from "./editor-view";
import { ImageAlign } from "./image-layout";
import { Figcaption } from "./figcaption";
import {
  ResizeHandles,
  selectableWrapperClass,
  useResizeHandles,
} from "./resize-handles";

export function useImageObjectUrl(node: ProseMirrorNode): string | undefined {
  const [blobUrl, setBlobUrl] = useState<string | undefined>(undefined);
  const src: Uint8Array = node.attrs.src;
  const filename: string = node.attrs.filename;
  const srcUrl: string = node.attrs.srcUrl;
  useEffect(() => {
    let cancelled = false;
    let created: string | undefined;
    const setFromBytes = (bytes: Uint8Array) => {
      if (cancelled) return;
      const blob = new Blob([bytes as BlobPart], {
        type: filename.endsWith(".svg") ? "image/svg+xml" : undefined,
      });
      created = URL.createObjectURL(blob);
      setBlobUrl(created);
    };
    setBlobUrl(undefined);
    if (src.byteLength > 0) {
      setFromBytes(src);
    } else {
      // parsed from stored HTML without embedded bytes; the media library
      // directory is the source of truth for the actual file content
      resolveMediaLibraryBytes(filename).then((bytes) => {
        if (!bytes) return;
        setFromBytes(bytes);
      });
    }
    return () => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [src, filename]);

  // Bytes win when there are any - they're the only copy of an image that was
  // inserted or replaced this session, and of an unsaved edit generally. But
  // they're not always reachable: a node parsed from a live page whose assets
  // couldn't be listed has none, and no resolver to find them either. Its
  // `srcUrl` already renders on that very page, so use it rather than emitting
  // a src-less <img>. Also covers the gap before the blob URL exists, since
  // the effect above only runs after the first paint.
  return blobUrl ?? (srcUrl || undefined);
}

// `float` (left/right) is applied to the outer, ProseMirror-tracked node
// view container instead - see `imageContainerAlignStyle` - not here.
// Floated content is taken out of normal flow, so if it only floated at
// this inner level, the outer container (which `view.nodeDOM` and popover
// positioning rely on) would have no in-flow content to size itself by
// and would collapse to a zero-size box at its text position.
function wrapperAlignStyle(align: ImageAlign | null): CSSProperties {
  if (align === "center") {
    return { display: "block", marginInline: "auto" };
  }
  return {};
}

// Applied to the outer node view container (see react-node-views.tsx's
// `containerStyle`) so the float itself - and thus the box everything
// measures the image node by - lives on the element ProseMirror actually
// tracks, not several layers of React-rendered content deep inside it.
//
// `lineHeight: 0` isn't cosmetic. Floating makes this container a block box,
// so it lays its child out in an inline formatting context - and the child is
// the inline-block wrapper below, which therefore sits on the container's text
// baseline with the strut's descender space left over beneath it. Measured at
// 8px with a 16px/1.6 host font: the container came out 238px tall around a
// 230px image. The published HTML floats the bare <img> (no baseline involved,
// no gap), so the editor has to hug the image the same way. Only reachable
// when floated - an unaligned image returns {} and stays inline, where sitting
// on the baseline is exactly what a plain <img> does too.
export function imageContainerAlignStyle(
  align: ImageAlign | null,
): CSSProperties {
  if (align === "left") {
    return {
      float: "left",
      marginInlineEnd: "1em",
      marginBlock: "0.5em",
      lineHeight: 0,
    };
  }
  if (align === "right") {
    return {
      float: "right",
      marginInlineStart: "1em",
      marginBlock: "0.5em",
      lineHeight: 0,
    };
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

  const objectUrl = useImageObjectUrl(node);

  const imgRef = useRef<HTMLImageElement | null>(null);
  const naturalRatioRef = useRef<number | null>(null);
  // the lock toggle lives in the image edit popover now; the node attr is
  // the shared source of truth between that toggle and this drag handling
  const locked: boolean = node.attrs.lockAspectRatio ?? true;

  const [renderedSize, setRenderedSize] = useState<{
    width: number;
    height: number;
  } | null>(null);

  const { dragSize, startDrag } = useResizeHandles({
    targetRef: imgRef,
    width,
    locked,
    naturalRatioRef,
    getPos: props.getPos,
  });

  const displayWidth = dragSize?.width ?? width ?? renderedSize?.width;
  const displayHeight = dragSize?.height ?? height ?? renderedSize?.height;

  const imgStyle: CSSProperties = {
    display: "block",
    // The editor's own rounded corners are an admin aesthetic - the published
    // <img> has none, so imposing them on a host page (the visual editor's
    // inline spots) would make the image visibly change shape on entering
    // edit mode. See createEditorSchema's `hostTypography`.
    borderRadius: schema.hostTypography
      ? undefined
      : tokenSchema.size.radius.regular,
    maxWidth: "100%",
    // Caps an unsized image so it can't dominate the admin's editing pane.
    // The published <img> has no such cap, so on a host page this would shrink
    // an image the moment edit mode turned on - there, whatever the page
    // already does with it is by definition right.
    maxHeight:
      schema.hostTypography || dragSize?.height != null || height != null
        ? undefined
        : tokenSchema.size.scale[3600],
    width: dragSize?.width ?? width ?? undefined,
    height: dragSize?.height ?? height ?? undefined,
    objectFit:
      displayWidth != null && displayHeight != null ? "contain" : undefined,
  };

  const wrapperStyle: CSSProperties = {
    position: "relative",
    display: align === "center" ? "block" : "inline-block",
    // a block-level, non-replaced <span> would otherwise stretch to fill the
    // paragraph's full width - shrink it back to the image's own size so the
    // outline (and the `margin-inline: auto` centering) apply to the image,
    // not an invisible full-width box around it
    width: align === "center" ? "fit-content" : undefined,
    lineHeight: 0,
    ...wrapperAlignStyle(align),
  };

  const showControls = editable && isSelected;

  return (
    <span
      style={wrapperStyle}
      className={selectableWrapperClass}
      data-selected={isSelected}
    >
      <img
        ref={imgRef}
        src={objectUrl}
        alt={node.attrs.alt}
        title={node.attrs.title || undefined}
        data-filename={node.attrs.filename}
        draggable={false}
        style={imgStyle}
        onLoad={(event) => {
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

      <Figcaption
        text={node.attrs.caption}
        hostTypography={schema.hostTypography}
      />

      {showControls && <ResizeHandles onStart={startDrag} />}
    </span>
  );
}
