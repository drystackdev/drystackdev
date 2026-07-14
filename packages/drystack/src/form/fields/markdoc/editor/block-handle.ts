import { NodeSelection, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { css, tokenSchema } from '@keystar/ui/style';

// Press-and-hold drag-to-reorder. Pressing directly on a top-level block (p,
// h2, li, ...) and holding for HOLD_DELAY without moving arms a native HTML5
// drag: once armed, a transient `contenteditable="false"` proxy is placed
// over the block so the browser's drag-vs-text-selection disambiguation sees
// a draggable target instead of editable text on the very next pointer move.
// A quick press-drag — the ordinary gesture for selecting text — never stays
// still long enough to arm, so mouse text selection is unaffected. The drag
// payload is handed to `view.dragging`, so prosemirror-view's own `drop`
// handling performs the move and the existing `dropCursor()` plugin shows
// where it will land (same mechanism the previous gutter-icon handle used;
// see `dropcursor.ts` for the sibling technique).

const HOLD_DELAY = 200; // ms — how long a press must be held still before it arms
const MOVE_CANCEL_THRESHOLD = 4; // px — movement before arming cancels the hold

// Subtle highlight on the block itself while a drag is armed/in-flight, since
// there's no separate icon anymore to signal "this is what you're dragging".
const armedClass = css({
  backgroundColor: tokenSchema.color.alias.backgroundHovered,
  borderRadius: tokenSchema.size.radius.small,
  cursor: 'grabbing',
});

const LIST_TYPES = new Set(['ordered_list', 'unordered_list', 'list_item']);

type HandleTarget = { pos: number; isListItem: boolean };

// Shared between the plugin view (which sets it on dragstart) and the plugin's
// `handleDrop` prop (which reads it to enforce reorder-only lists). One object
// per editor — `blockHandle()` runs once when the state is created.
type DragState = { isListItem: boolean };

export const blockHandleKey = new PluginKey('blockHandle');

class BlockHandleView {
  private view: EditorView;
  private dragState: DragState;
  private target: HandleTarget | null = null;
  private targetDom: HTMLElement | null = null;
  private startPointer: { x: number; y: number } | null = null;
  private holdTimer: number | null = null;
  private proxy: HTMLDivElement | null = null;
  private isDragging = false;

  constructor(view: EditorView, dragState: DragState) {
    this.view = view;
    this.dragState = dragState;
    view.dom.addEventListener('mousedown', this.onMouseDown);
  }

  update(view: EditorView, prevState: EditorView['state']) {
    // positions shift on a doc change; drop any pending/in-flight gesture and
    // let the next press start fresh.
    if (prevState.doc !== view.state.doc) this.cancel();
  }

  destroy() {
    this.view.dom.removeEventListener('mousedown', this.onMouseDown);
    this.cancel();
  }

  private onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !this.view.editable) return;
    const eventTarget = event.target as HTMLElement;
    if (
      eventTarget.closest(
        'input, textarea, select, button, a[href], [data-resize-grip]'
      )
    )
      return;

    const target = this.resolveTarget(event.clientX, event.clientY);
    if (!target) return;

    this.cancel(); // safety: clear any stray previous gesture
    this.target = target;
    this.startPointer = { x: event.clientX, y: event.clientY };
    window.addEventListener('mousemove', this.onEarlyMouseMove);
    window.addEventListener('mouseup', this.onEarlyMouseUp);
    this.holdTimer = window.setTimeout(this.arm, HOLD_DELAY);
  };

  // Any real movement before the hold elapses means this is an ordinary
  // click-drag (placing the cursor / selecting text) — never arm for it.
  private onEarlyMouseMove = (event: MouseEvent) => {
    if (!this.startPointer) return;
    const dx = event.clientX - this.startPointer.x;
    const dy = event.clientY - this.startPointer.y;
    if (Math.hypot(dx, dy) > MOVE_CANCEL_THRESHOLD) this.cancel();
  };

  private onEarlyMouseUp = () => {
    // Once a native drag is underway, cleanup happens via dragend instead.
    if (!this.isDragging) this.cancel();
  };

  private arm = () => {
    this.holdTimer = null;
    if (!this.target) return;
    const dom = this.view.nodeDOM(this.target.pos);
    if (!(dom instanceof HTMLElement)) {
      this.cancel();
      return;
    }
    // Movement is expected (and desired) from here on — it's what triggers
    // the native drag — so stop cancelling on it. Only cleanup on mouseup
    // (released without ever actually dragging) remains armed.
    window.removeEventListener('mousemove', this.onEarlyMouseMove);

    this.targetDom = dom;
    dom.classList.add(...armedClass.split(' '));

    // A dedicated, non-editable draggable proxy sitting exactly over the
    // block: the next mousemove hit-tests against this instead of the
    // contenteditable text underneath, so the browser reliably starts a
    // native drag rather than extending a text selection.
    const rect = dom.getBoundingClientRect();
    const proxy = document.createElement('div');
    proxy.draggable = true;
    proxy.setAttribute('contenteditable', 'false');
    proxy.setAttribute('aria-hidden', 'true');
    proxy.style.position = 'fixed';
    proxy.style.left = `${rect.left}px`;
    proxy.style.top = `${rect.top}px`;
    proxy.style.width = `${rect.width}px`;
    proxy.style.height = `${rect.height}px`;
    proxy.style.zIndex = '50';
    proxy.style.background = 'transparent';
    // the proxy sits on top of the block, so it — not the block underneath —
    // is what the pointer is actually over; the cursor must be set here
    proxy.style.cursor = 'grabbing';
    proxy.addEventListener('dragstart', this.onDragStart);
    proxy.addEventListener('dragend', this.onDragEnd);
    document.body.appendChild(proxy);
    this.proxy = proxy;
  };

  // Find the block that should be armed for a pointer position: the top-level
  // block (direct child of `doc`), except inside a top-level list where we
  // retarget to the specific `list_item` under the pointer so each `li` can
  // be picked up independently. A `grid_cell` shares `doc`'s `block+` content
  // model, so the same logic re-applies relative to the nearest enclosing
  // cell — blocks nested inside a grid can be picked up and dragged out
  // individually too. Any other nested container (table cell, blockquote)
  // still resolves to its own top-level ancestor block, unchanged.
  private resolveTarget(clientX: number, clientY: number): HandleTarget | null {
    const view = this.view;
    if (!view.editable) return null;
    const found = view.posAtCoords({ left: clientX, top: clientY });
    if (!found) return null;
    // Resolve the position nearest the pointer — inside the block for interior
    // hovers. (Note: `found.inside` points *before* the containing node, i.e. a
    // doc-level position for a top-level block, which is not what we want.)
    let $pos = view.state.doc.resolve(found.pos);
    // Exactly on a boundary between top-level blocks: dive into the adjacent
    // one so we still resolve a block rather than the document itself.
    if ($pos.depth === 0) {
      if ($pos.nodeAfter) $pos = view.state.doc.resolve(found.pos + 1);
      else if ($pos.nodeBefore) $pos = view.state.doc.resolve(found.pos - 1);
      else return null;
    }
    if ($pos.depth === 0) return null;

    // root container depth for the "top-level block" notion: 0 for `doc`, or
    // the depth of the nearest enclosing `grid_cell` ancestor
    let rootDepth = 0;
    for (let depth = $pos.depth; depth >= 1; depth--) {
      if ($pos.node(depth).type.name === 'grid_cell') {
        rootDepth = depth;
        break;
      }
    }

    const childDepth = rootDepth + 1;
    if ($pos.depth < childDepth) return null;
    const childNode = $pos.node(childDepth);
    if (
      $pos.depth > childDepth &&
      (childNode.type.name === 'ordered_list' ||
        childNode.type.name === 'unordered_list')
    ) {
      return { pos: $pos.before(childDepth + 1), isListItem: true };
    }
    return { pos: $pos.before(childDepth), isListItem: false };
  }

  private onDragStart = (event: DragEvent) => {
    const view = this.view;
    if (!this.target || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const { pos, isListItem } = this.target;
    if (!view.state.doc.nodeAt(pos)) {
      event.preventDefault();
      return;
    }
    this.isDragging = true;
    // Build the drag payload without dispatching a transaction: mutating the
    // doc/selection synchronously inside `dragstart` can abort the native drag
    // in Chromium. `NodeSelection.content()` yields the slice directly, and
    // passing the selection as `node` lets prosemirror-view's drop handler
    // delete the source precisely on a move.
    const selection = NodeSelection.create(view.state.doc, pos);
    const slice = selection.content();
    event.dataTransfer.clearData();
    // browsers only start a drag when *some* data is set
    event.dataTransfer.setData('text/plain', ' ');
    event.dataTransfer.effectAllowed = 'copyMove';
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dom, 0, 0);
    }

    // `node` lets prosemirror-view delete precisely (node.replace) and remap
    // the source across doc changes; it's absent from the public type
    view.dragging = { slice, move: true, node: selection } as any;
    this.dragState.isListItem = isListItem;
  };

  private onDragEnd = () => {
    // On a successful drop over the editor, prosemirror-view's own drop
    // handler already cleared this. But when the drag is cancelled (dropped
    // outside the editor) nothing else clears it — PM's `dragend` is bound to
    // `view.dom`, not our proxy — so a stale slice would linger.
    this.view.dragging = null;
    this.dragState.isListItem = false;
    this.isDragging = false;
    this.cancel();
  };

  private cancel() {
    if (this.holdTimer != null) {
      clearTimeout(this.holdTimer);
      this.holdTimer = null;
    }
    window.removeEventListener('mousemove', this.onEarlyMouseMove);
    window.removeEventListener('mouseup', this.onEarlyMouseUp);
    if (this.targetDom) {
      this.targetDom.classList.remove(...armedClass.split(' '));
      this.targetDom = null;
    }
    if (this.proxy) {
      this.proxy.removeEventListener('dragstart', this.onDragStart);
      this.proxy.removeEventListener('dragend', this.onDragEnd);
      this.proxy.remove();
      this.proxy = null;
    }
    this.target = null;
    this.startPointer = null;
  }
}

// A `list_item` slice is only structurally valid inside a list, but
// prosemirror-view's replaceRange fitting can still wrap a dropped item into a
// fresh single-item list at the body level. To keep list drags "reorder only",
// cancel any list-item drop whose target isn't already inside a list.
function dropTargetIsInsideList(view: EditorView, event: DragEvent): boolean {
  const found = view.posAtCoords({ left: event.clientX, top: event.clientY });
  if (!found) return false;
  const $pos = view.state.doc.resolve(found.pos);
  for (let depth = $pos.depth; depth > 0; depth--) {
    if (LIST_TYPES.has($pos.node(depth).type.name)) return true;
  }
  return false;
}

export function blockHandle() {
  const dragState: DragState = { isListItem: false };
  return new Plugin({
    key: blockHandleKey,
    view: view => new BlockHandleView(view, dragState),
    props: {
      handleDrop(view, event) {
        if (!dragState.isListItem) return false;
        // swallow the drop (prevents the move) when a dragged list item would
        // land outside any list
        return !dropTargetIsInsideList(view, event as DragEvent);
      },
    },
  });
}
