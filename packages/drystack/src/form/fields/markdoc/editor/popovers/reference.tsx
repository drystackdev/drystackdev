import { ReferenceElement, VirtualElement } from "@floating-ui/react";
import { useLayoutEffect, useState } from "react";
import { useEditorViewInEffect } from "../editor-view";
import { EditorView } from "prosemirror-view";

function getReferenceElementForRange(
  view: EditorView,
  from: number,
  to: number,
): ReferenceElement | null {
  const nodeAtFrom = view.state.doc.nodeAt(from);
  if (nodeAtFrom !== null && to === from + nodeAtFrom.nodeSize) {
    const node = view.nodeDOM(from);
    if (node instanceof Element) {
      return virtualElement(node, view);
    }
  }
  const fromDom = view.domAtPos(from);
  const toDom = view.domAtPos(to);
  const range = document.createRange();
  range.setStart(fromDom.node, fromDom.offset);
  range.setEnd(toDom.node, toDom.offset);
  return virtualElement(range, view);
}

export function useEditorReferenceElement(
  from: number,
  to: number,
): ReferenceElement | null {
  const [referenceElement, setReferenceElement] =
    useState<ReferenceElement | null>(null);
  const getEditorView = useEditorViewInEffect();
  useLayoutEffect(() => {
    const view = getEditorView();
    if (!view) {
      setReferenceElement(null);
      return;
    }
    const update = () =>
      setReferenceElement(getReferenceElementForRange(view, from, to));
    update();

    // the referenced node's box can change size without any scroll/resize
    // event floating-ui's own autoUpdate would catch - e.g. dragging an
    // image's resize handles just mutates its inline style. Watch the node's
    // DOM directly and hand floating-ui a fresh virtual element (new object
    // identity) whenever that happens, so the popover keeps tracking it
    // instead of lagging behind mid-drag.
    const nodeAtFrom = view.state.doc.nodeAt(from);
    const dom =
      nodeAtFrom !== null && to === from + nodeAtFrom.nodeSize
        ? view.nodeDOM(from)
        : null;
    if (dom instanceof Element) {
      const observer = new ResizeObserver(update);
      observer.observe(dom);
      return () => observer.disconnect();
    }
  }, [getEditorView, from, to]);
  return referenceElement;
}

/**
 * Normalize API for node, range, etc. and include `contextElement` to ensure
 * clipping and position update detection works as expected.
 * @see https://floating-ui.com/docs/virtual-elements
 */
function virtualElement(el: VirtualElement, view: EditorView) {
  const contextElement = view.dom;
  const getBoundingClientRect = () => el.getBoundingClientRect();
  return { contextElement, getBoundingClientRect };
}
