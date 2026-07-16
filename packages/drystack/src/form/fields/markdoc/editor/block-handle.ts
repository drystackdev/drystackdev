import { NodeSelection, Selection, TextSelection, Plugin, PluginKey } from 'prosemirror-state';
import { EditorView } from 'prosemirror-view';
import { css, tokenSchema } from '@keystar/ui/style';

// Press-and-hold drag-to-reorder. Pressing directly on a top-level block (p,
// h2, li, ...) and holding for HOLD_DELAY without moving arms a native HTML5
// drag: once armed, a transient `contenteditable="false"` proxy is placed
// over the block(s) so the browser's drag-vs-text-selection disambiguation
// sees a draggable target instead of editable text on the very next pointer
// move. A quick press-drag — the ordinary gesture for selecting text — never
// stays still long enough to arm, so mouse text selection is unaffected. If
// the press lands inside an existing selection that already spans more than
// one block, the whole spanned range is picked up together instead of just
// the block under the pointer. The drag payload is handed to `view.dragging`,
// so prosemirror-view's own `drop` handling performs the move and the
// existing `dropCursor()` plugin shows where it will land (same mechanism
// the previous gutter-icon handle used; see `dropcursor.ts` for the sibling
// technique).

const HOLD_DELAY = 500; // ms — how long a press must be held still before it arms
const MOVE_CANCEL_THRESHOLD = 4; // px — movement before arming cancels the hold

// Subtle highlight on the block(s) while a drag is armed/in-flight, since
// there's no separate icon anymore to signal "this is what you're dragging".
const armedClass = css({
  backgroundColor: tokenSchema.color.alias.backgroundHovered,
  borderRadius: tokenSchema.size.radius.small,
  cursor: 'grabbing',
});

const LIST_TYPES = new Set(['ordered_list', 'unordered_list', 'list_item']);

// A span of one or more sibling blocks at the same depth: `[from, to)`
// bounds the run of nodes to pick up (a single block, a run of list items,
// or a run of top-level/grid-cell blocks spanned by an existing selection).
type HandleTarget = {
  from: number;
  to: number;
  isListItem: boolean;
  // Position right before the enclosing `grid_cell`, set only when this
  // target is every block the cell has — see the comment on
  // `emptiedGridCellPos` below.
  emptiedGridCellPos: number | null;
};

// Shared between the plugin view (which sets it on dragstart) and the plugin's
// `handleDrop`/`appendTransaction` props (which read it to enforce
// reorder-only lists and to clean up a drained grid cell). One object per
// editor — `blockHandle()` runs once when the state is created.
type DragState = {
  isListItem: boolean;
  emptiedGridCellPos: number | null;
  // Set on this handle's own dragstart and consumed by `appendTransaction` on
  // the matching drop. Tells a drop that started here apart from any other
  // drag landing in the editor (an image from the desktop, a browser-native
  // text drag) — those keep whatever selection prosemirror-view gives them.
  fromHandle: boolean;
};

export const blockHandleKey = new PluginKey('blockHandle');

class BlockHandleView {
  private view: EditorView;
  private dragState: DragState;
  private target: HandleTarget | null = null;
  private targetDoms: HTMLElement[] = [];
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
    const doms = this.blocksInRange(this.target.from, this.target.to)
      .map(pos => this.view.nodeDOM(pos))
      .filter((dom): dom is HTMLElement => dom instanceof HTMLElement);
    if (doms.length === 0) {
      this.cancel();
      return;
    }
    // Movement is expected (and desired) from here on — it's what triggers
    // the native drag — so stop cancelling on it. Only cleanup on mouseup
    // (released without ever actually dragging) remains armed.
    window.removeEventListener('mousemove', this.onEarlyMouseMove);

    this.targetDoms = doms;
    for (const dom of doms) dom.classList.add(...armedClass.split(' '));

    // A dedicated, non-editable draggable proxy sitting exactly over the
    // block(s): the next mousemove hit-tests against this instead of the
    // contenteditable text underneath, so the browser reliably starts a
    // native drag rather than extending a text selection.
    const rect = this.unionRect(doms);
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
    // the proxy sits on top of the block(s), so it — not the content
    // underneath — is what the pointer is actually over; the cursor must be
    // set here
    proxy.style.cursor = 'grabbing';
    proxy.addEventListener('dragstart', this.onDragStart);
    proxy.addEventListener('dragend', this.onDragEnd);
    document.body.appendChild(proxy);
    this.proxy = proxy;
  };

  private unionRect(doms: HTMLElement[]) {
    const rects = doms.map(dom => dom.getBoundingClientRect());
    const left = Math.min(...rects.map(r => r.left));
    const top = Math.min(...rects.map(r => r.top));
    const right = Math.max(...rects.map(r => r.right));
    const bottom = Math.max(...rects.map(r => r.bottom));
    return { left, top, width: right - left, height: bottom - top };
  }

  // Walk the direct siblings spanned by [from, to) — `from` must sit exactly
  // on a child boundary (as produced by resolveTarget).
  private blocksInRange(from: number, to: number): number[] {
    const positions: number[] = [];
    const doc = this.view.state.doc;
    let pos = from;
    while (pos < to) {
      const node = doc.nodeAt(pos);
      if (!node) break;
      positions.push(pos);
      pos += node.nodeSize;
    }
    return positions;
  }

  // Find the span that should be armed for a pointer position: normally just
  // the single top-level block under the pointer (direct child of `doc`), or
  // the specific `list_item` when inside a top-level list. A `grid_cell`
  // shares `doc`'s `block+` content model, so the same logic re-applies
  // relative to the nearest enclosing cell — blocks nested inside a grid can
  // be picked up and dragged out individually too. Any other nested
  // container (table cell, blockquote) still resolves to its own top-level
  // ancestor block, unchanged. If the press lands inside an existing
  // selection spanning more than one sibling at that level, the whole
  // spanned range is returned instead — selecting across (even partially
  // into) 2-3 blocks and dragging moves all of them together.
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
    const isListChild =
      childNode.type.name === 'ordered_list' || childNode.type.name === 'unordered_list';
    const itemDepth = $pos.depth > childDepth && isListChild ? childDepth + 1 : childDepth;
    const isListItem = itemDepth === childDepth + 1;

    const range = this.rangeForSelection(view.state.selection, found.pos, itemDepth);
    const { from, to } = range ?? {
      from: $pos.before(itemDepth),
      to: $pos.after(itemDepth),
    };

    // `grid_cell` is `isolating`, so — unlike every other `block+` container
    // here — ProseMirror won't cascade-delete it when its last child goes
    // away; it fills the now-invalid empty cell with a default paragraph
    // instead, which sits there as unwanted clutter with no way to remove it
    // via the drag gesture itself. Flag it here (only when the whole cell's
    // content is the thing being dragged out) so `appendTransaction` can
    // clean up that filler — or drop the now-sole-empty cell entirely —
    // once the move lands.
    const emptiedGridCellPos =
      rootDepth > 0 && from === $pos.start(rootDepth) && to === $pos.end(rootDepth)
        ? $pos.before(rootDepth)
        : null;

    return { from, to, isListItem, emptiedGridCellPos };
  }

  // When the press falls inside a non-empty selection, and that selection's
  // two ends are siblings at `itemDepth` spanning more than one of them,
  // return the whole spanned range. Returns null for a collapsed selection,
  // one entirely inside a single sibling, or one whose ends aren't
  // comparable siblings at that depth — those fall back to the plain
  // single-block pick-up.
  private rangeForSelection(
    selection: EditorView['state']['selection'],
    pointerPos: number,
    itemDepth: number
  ): { from: number; to: number } | null {
    if (selection.empty) return null;
    if (pointerPos < selection.from || pointerPos > selection.to) return null;
    const { $from, $to } = selection;
    if ($from.depth < itemDepth || $to.depth < itemDepth) return null;
    if ($from.node(itemDepth - 1) !== $to.node(itemDepth - 1)) return null; // not siblings
    if ($from.before(itemDepth) === $to.before(itemDepth)) return null; // single sibling
    return { from: $from.before(itemDepth), to: $to.after(itemDepth) };
  }

  private onDragStart = (event: DragEvent) => {
    const view = this.view;
    if (!this.target || !event.dataTransfer) {
      event.preventDefault();
      return;
    }
    const { from, to, isListItem, emptiedGridCellPos } = this.target;
    const soleNode = view.state.doc.nodeAt(from);
    if (!soleNode) {
      event.preventDefault();
      return;
    }
    this.isDragging = true;
    // Build the drag payload without dispatching a transaction: mutating the
    // doc/selection synchronously inside `dragstart` can abort the native drag
    // in Chromium. A single block uses `NodeSelection`; a multi-block span
    // (from an existing cross-block selection) uses a plain range instead,
    // since `NodeSelection` only ever wraps exactly one node. Either way,
    // passing the selection as `node` lets prosemirror-view's drop handler
    // delete the source precisely on a move.
    const isSole = from + soleNode.nodeSize === to;
    const selection: Selection = isSole
      ? NodeSelection.create(view.state.doc, from)
      : new TextSelection(view.state.doc.resolve(from), view.state.doc.resolve(to));
    const slice = selection.content();
    event.dataTransfer.clearData();
    // browsers only start a drag when *some* data is set
    event.dataTransfer.setData('text/plain', ' ');
    event.dataTransfer.effectAllowed = 'copyMove';
    const dom = view.nodeDOM(from);
    if (dom instanceof HTMLElement) {
      event.dataTransfer.setDragImage(dom, 0, 0);
    }

    // `node` lets prosemirror-view delete precisely (node.replace) and remap
    // the source across doc changes; it's absent from the public type
    view.dragging = { slice, move: true, node: selection } as any;
    this.dragState.isListItem = isListItem;
    this.dragState.emptiedGridCellPos = emptiedGridCellPos;
    this.dragState.fromHandle = true;
  };

  private onDragEnd = () => {
    // On a successful drop over the editor, prosemirror-view's own drop
    // handler already cleared this. But when the drag is cancelled (dropped
    // outside the editor) nothing else clears it — PM's `dragend` is bound to
    // `view.dom`, not our proxy — so a stale slice would linger.
    this.view.dragging = null;
    this.dragState.isListItem = false;
    this.dragState.emptiedGridCellPos = null;
    // Already consumed by `appendTransaction` on a successful drop (which runs
    // first); this only matters for a drag that ended without one.
    this.dragState.fromHandle = false;
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
    for (const dom of this.targetDoms) dom.classList.remove(...armedClass.split(' '));
    this.targetDoms = [];
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
  const dragState: DragState = {
    isListItem: false,
    emptiedGridCellPos: null,
    fromHandle: false,
  };
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
    appendTransaction(transactions, oldState, newState) {
      if (!transactions.some(tr => tr.getMeta('uiEvent') === 'drop')) return null;

      // one-shot: both only ever describe the drop they were armed for
      const pos = dragState.emptiedGridCellPos;
      const fromHandle = dragState.fromHandle;
      dragState.emptiedGridCellPos = null;
      dragState.fromHandle = false;

      const tr = newState.tr;
      let changed = false;

      if (pos != null) {
        const mapped = transactions.reduce((p, t) => t.mapping.map(p), pos);
        const cell = newState.doc.nodeAt(mapped);
        if (cell && cell.type === newState.schema.nodes.grid_cell) {
          // Only the schema-mandated filler paragraph — leave it alone if the
          // user has actually typed something into it since the drop.
          const isEmptyFiller =
            cell.childCount === 1 &&
            cell.firstChild!.type === newState.schema.nodes.paragraph &&
            cell.firstChild!.content.size === 0;
          if (isEmptyFiller) {
            const $cell = newState.doc.resolve(mapped);
            const grid = $cell.parent;
            if (grid.childCount <= 1) {
              // last cell left in the grid — drop the whole grid rather than
              // leave a single-cell layout containing nothing
              const from = $cell.before($cell.depth);
              tr.delete(from, from + grid.nodeSize);
            } else {
              tr.delete(mapped, mapped + cell.nodeSize);
            }
            changed = true;
          }
        }
      }

      // prosemirror-view's drop handling leaves the moved block(s) selected —
      // for a node drag that's a full NodeSelection ring around what was just
      // dropped, which reads as "still holding it" once the gesture is over.
      // Collapse to a plain cursor inside the landed content instead, but only
      // when the drop actually moved something: `doc.eq` (not `!==`, which any
      // transaction makes true) so a drop that put the block back exactly
      // where it came from leaves the selection untouched.
      if (fromHandle && !oldState.doc.eq(newState.doc)) {
        const $at = tr.doc.resolve(tr.mapping.map(newState.selection.from));
        tr.setSelection(Selection.near($at, 1));
        changed = true;
      }

      return changed ? tr : null;
    },
  });
}
