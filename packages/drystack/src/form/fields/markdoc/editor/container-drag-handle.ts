import { Node as ProsemirrorNode } from "prosemirror-model";
import { EditorState, NodeSelection, Plugin } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { css, tokenSchema } from "@keystar/ui/style";

import { setDragPayload } from "./block-handle";

// A grip pinned to the top-left corner of the table/grid the selection is
// in, dragged to move that whole container.
//
// `table` and `grid` are the two blocks whose content is nothing but cells,
// so every press inside one lands in a cell - which means the press-and-hold
// gesture (block-handle.ts) always resolves to a block *within* a cell and
// can never pick up the container itself. This grip is how the container as a
// whole moves. It hands prosemirror-view the same drag payload the
// press-and-hold handle does, so the drop lands - and shows its drop cursor -
// identically; only the way the gesture starts differs.
const CONTAINER_TYPES = new Set(["table", "grid"]);

// The grip is rendered as a widget decoration at the container's first inside
// position, which puts it in the container's own contentDOM: a `<tbody>` for a
// table, the `display:grid` container for a grid. In both cases it's the
// grip's `position: absolute` that keeps it out of the container's layout -
// an in-flow child there would become an anonymous table row / a grid item and
// push the real content around. Both containers are already `position:
// relative` (see `tableLayoutStyles` and `gridClass`), so absolute inset-0 is
// their own corner.
const GRIP_KEY = "container-drag-grip";
const GRIP_SIZE = 20;

type Container = { pos: number; node: ProsemirrorNode };

// The innermost table/grid around the selection - a table inside a grid cell
// gets the table's grip, matching how the popovers pick their node (see
// `TableInGridPopover`). The enclosing grid's own grip stays reachable from
// any of its cells outside that table.
function findContainer(state: EditorState): Container | null {
  const { selection } = state;
  // A node-selected container - what prosemirror-view leaves behind after
  // this grip drops one - has no ancestor to find: the selection *is* the
  // node. Checked before the ancestor walk so a node-selected table inside a
  // grid still resolves to the table rather than to the grid around it.
  if (
    selection instanceof NodeSelection &&
    CONTAINER_TYPES.has(selection.node.type.name)
  ) {
    return { pos: selection.from, node: selection.node };
  }
  const $from = selection.$from;
  for (let depth = $from.depth; depth > 0; depth--) {
    const node = $from.node(depth);
    if (CONTAINER_TYPES.has(node.type.name)) {
      return { pos: $from.before(depth), node };
    }
  }
  return null;
}

const gripSvg = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><circle cx="9" cy="12" r="1"/><circle cx="9" cy="5" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="19" r="1"/></svg>`;

function onDragStart(view: EditorView, event: DragEvent) {
  // Resolved from the live state rather than captured when the grip was
  // drawn: the same element is reused across every state change it stays on
  // screen for (see `GRIP_KEY`), so a position captured at draw time could
  // be stale by the time it's dragged.
  const container = findContainer(view.state);
  if (!container || !event.dataTransfer) {
    event.preventDefault();
    return;
  }
  setDragPayload(
    view,
    event,
    NodeSelection.create(view.state.doc, container.pos),
    view.nodeDOM(container.pos),
  );
}

function renderGrip(view: EditorView, label: string) {
  const grip = document.createElement("button");
  grip.type = "button";
  grip.className = gripClass;
  // `contenteditable="false"` (which prosemirror-view sets on every widget
  // that isn't `raw`) is what makes the browser's drag-vs-text-selection
  // disambiguation see a draggable target here instead of editable text -
  // the same reason block-handle.ts drags a non-editable proxy.
  grip.draggable = true;
  grip.setAttribute("data-drag-grip", "");
  grip.setAttribute("aria-label", label);
  grip.title = label;
  grip.innerHTML = gripSvg;
  grip.addEventListener("dragstart", (event) => onDragStart(view, event));
  grip.addEventListener("dragend", () => {
    // prosemirror-view's own `dragend` never runs for an event out of the
    // grip (see `stopEvent` below), so nothing else would clear a slice left
    // behind by a drag that ended outside the editor.
    view.dragging = null;
  });
  return grip;
}

export function containerDragHandle(dragToMoveLabel: string) {
  // Bound once so the widget's `toDOM` keeps a stable identity across
  // `decorations` calls, same reason as `key` below.
  const toDOM = (view: EditorView) => renderGrip(view, dragToMoveLabel);
  return new Plugin({
    props: {
      decorations(state) {
        const container = findContainer(state);
        if (!container) return null;
        return DecorationSet.create(state.doc, [
          Decoration.widget(container.pos + 1, toDOM, {
            side: -1,
            // Without a key prosemirror-view compares widgets by `toDOM`
            // identity and redraws this one on every state change - including
            // the selection change a press on the grip itself causes, which
            // would replace the element mid-gesture and the drag would never
            // start.
            key: GRIP_KEY,
            // The grip is a control, not content: keep prosemirror-view's own
            // mouse/drag handling off it (this makes `eventBelongsToView`
            // false for anything out of the grip, so its own `dragstart` owns
            // `view.dragging`) and keep the caret from being read out of it.
            stopEvent: () => true,
            ignoreSelection: true,
          }),
        ]);
      },
    },
  });
}

const gripClass = css({
  position: "absolute",
  top: 0,
  insetInlineStart: 0,
  // Straddles the corner rather than sitting inside it, so it never covers
  // the first cell's own content; the editor's content padding leaves room
  // for the overhang.
  transform: "translate(-50%, -50%)",
  width: GRIP_SIZE,
  height: GRIP_SIZE,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  boxSizing: "border-box",
  border: `${tokenSchema.size.border.regular} solid ${tokenSchema.color.alias.borderIdle}`,
  borderRadius: tokenSchema.size.radius.small,
  backgroundColor: tokenSchema.color.background.canvas,
  color: tokenSchema.color.foreground.neutralSecondary,
  cursor: "grab",
  // above the cell affordances that reach the same corner (a grid item's
  // edge strips, a selected cell's outline)
  zIndex: 4,
  // The editor is mounted read-only in the visual editor's view mode (see
  // `editable` in `useEditorView`), where a control like this must not appear.
  // Decorations are computed from state alone - which doesn't carry
  // editability - so this gates off the `contenteditable` prosemirror-view
  // writes onto the root from that same flag, which keeps the two exactly in
  // step.
  '.ProseMirror[contenteditable="false"] &': {
    display: "none",
  },
  "&:hover": {
    backgroundColor: tokenSchema.color.alias.backgroundHovered,
    color: tokenSchema.color.foreground.neutral,
  },
  "&:active": {
    cursor: "grabbing",
  },
  "& svg": {
    width: tokenSchema.size.icon.small,
    height: tokenSchema.size.icon.small,
  },
});
