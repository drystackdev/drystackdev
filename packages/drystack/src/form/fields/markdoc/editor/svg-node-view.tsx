import { Node as ProseMirrorNode } from "prosemirror-model";
import { CSSProperties, useMemo, useRef } from "react";

import { css, tokenSchema } from "@keystar/ui/style";

import { useEditorSchema } from "./editor-view";
import { ImageAlign } from "./image-layout";
import { Figcaption } from "./figcaption";
import { svgNaturalRatio } from "./svg-markup";
import {
  ResizeHandles,
  selectableWrapperClass,
  useResizeHandles,
} from "./resize-handles";

/**
 * Renders an `svg` node's markup inline, the same way the published page will.
 *
 * That "same way" is the entire point of the node: the drawing is part of the
 * host document, so `currentColor`, inherited `font-family`, and any theme
 * custom properties it references resolve against whatever surrounds it - in
 * the editor, the admin's own theme; on the site, the site's. An `<img>`
 * pointing at the same bytes would render identically in both, and match
 * neither.
 */
export function SvgNodeView(props: {
  node: ProseMirrorNode;
  hasNodeSelection: boolean;
  isNodeCompletelyWithinSelection: boolean;
  getPos: () => number | undefined;
}) {
  const { node } = props;
  const markup: string = node.attrs.markup;
  const width: number | null = node.attrs.width;
  const height: number | null = node.attrs.height;
  const align: ImageAlign | null = node.attrs.align;

  const schema = useEditorSchema();
  const editable = schema.config.htmlLayout;
  const isSelected =
    props.hasNodeSelection || props.isNodeCompletelyWithinSelection;

  const holderRef = useRef<HTMLSpanElement | null>(null);
  // An svg declares its own proportions up front (`viewBox`), so unlike an
  // image there's nothing to wait for a load event to learn - the ratio is
  // known before the first paint, and the handles can lock to it immediately.
  const naturalRatio = useMemo(() => svgNaturalRatio(markup), [markup]);
  const naturalRatioRef = useRef<number | null>(naturalRatio);
  naturalRatioRef.current = naturalRatio;

  const locked: boolean = node.attrs.lockAspectRatio ?? true;
  const { dragSize, startDrag } = useResizeHandles({
    targetRef: holderRef,
    width,
    locked,
    naturalRatioRef,
    getPos: props.getPos,
  });

  const displayWidth = dragSize?.width ?? width;
  const displayHeight = dragSize?.height ?? height;

  const holderStyle = {
    display: align === "center" ? "block" : "inline-block",
    lineHeight: 0,
    // Selecting the `<text>` inside a chart the way you'd select prose only
    // ever produces a confusing partial selection - the node is an atom as far
    // as the document is concerned, so let a click select the whole thing.
    userSelect: "none",
    "--dry-svg-width": displayWidth != null ? `${displayWidth}px` : undefined,
    "--dry-svg-height": displayHeight != null ? `${displayHeight}px` : undefined,
    // Caps an unsized drawing so it can't dominate the admin's editing pane -
    // same reasoning (and the same escape hatch) as the image node view. On a
    // host page that supplies its own typography, whatever the page already
    // does with the svg is by definition right.
    "--dry-svg-max-height":
      schema.hostTypography || displayHeight != null
        ? "none"
        : tokenSchema.size.scale[3600],
  } as CSSProperties;

  const wrapperStyle: CSSProperties = {
    position: "relative",
    display: align === "center" ? "block" : "inline-block",
    // a block-level, non-replaced <span> would otherwise stretch to fill the
    // paragraph's full width - shrink it back to the drawing's own size so the
    // outline (and the `margin-inline: auto` centering) apply to the svg, not
    // an invisible full-width box around it
    width: align === "center" ? "fit-content" : undefined,
    ...(align === "center" ? { marginInline: "auto" } : {}),
    lineHeight: 0,
  };

  return (
    <span
      style={wrapperStyle}
      className={selectableWrapperClass}
      data-selected={isSelected}
    >
      {/*
        The markup is set as HTML rather than rendered through React because it
        *is* the value - an author's (or a model's) drawing, kept verbatim so it
        serializes back byte-for-byte. It is only ever markup that came out of
        sanitizeSvgElement (see svg-markup.ts, and the `markup` attr's parseDOM
        in schema.tsx): no node can hold anything else.
      */}
      <span
        ref={holderRef}
        className={svgHolderClass}
        style={holderStyle}
        dangerouslySetInnerHTML={{ __html: markup }}
      />

      <Figcaption
        text={node.attrs.caption}
        hostTypography={schema.hostTypography}
      />

      {editable && isSelected && <ResizeHandles onStart={startDrag} />}
    </span>
  );
}

// Sizing the drawing through custom properties rather than an inline `style` on
// the svg itself, because the svg element is owned by `dangerouslySetInnerHTML`
// - React re-creates it wholesale on every markup change and would drop any
// attribute set on it from the outside.
const svgHolderClass = css({
  "& > svg": {
    display: "block",
    width: "var(--dry-svg-width, auto)",
    height: "var(--dry-svg-height, auto)",
    maxWidth: "100%",
    maxHeight: "var(--dry-svg-max-height, none)",
  },
});
