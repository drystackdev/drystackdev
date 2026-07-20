import { EditorState, Plugin, PluginKey, Transaction } from "prosemirror-state";
import { Decoration, DecorationSet } from "prosemirror-view";

import { css, tokenSchema } from "@keystar/ui/style";

// Where the AI's answer will land once it arrives.
//
// The range has to survive the wait: the request takes seconds, the editor
// stays live, and anything the user types meanwhile shifts the positions the
// selection was captured at. Holding {from, to} in a React ref would rot the
// moment they typed a word above the passage. Plugin state doesn't - every
// transaction runs through `apply`, so the range maps itself.
type AiRewriteState =
  | { kind: "inactive" }
  | { kind: "active"; decorations: DecorationSet };

type AiRewriteTrMeta =
  | { action: "add-range"; from: number; to: number }
  | { action: "add-point"; pos: number }
  | { action: "remove" };

const key = new PluginKey<AiRewriteState>("ai-rewrite");

const inactive: AiRewriteState = { kind: "inactive" };

const pendingHighlight = css({
  backgroundColor: tokenSchema.color.alias.backgroundSelected,
  borderRadius: tokenSchema.size.radius.small,
});

/** Marks the range the AI is currently rewriting. */
export function setAiRewriteRange(
  tr: Transaction,
  from: number,
  to: number,
): Transaction {
  return tr.setMeta(key, {
    action: "add-range",
    from,
    to,
  } satisfies AiRewriteTrMeta);
}

export function clearAiRewriteRange(tr: Transaction): Transaction {
  return tr.setMeta(key, { action: "remove" } satisfies AiRewriteTrMeta);
}

/**
 * Marks the point where AI-generated content will land once ready - the
 * magic-write "insert" flow's equivalent of a rewrite range. Tracked through
 * the same plugin (so it survives whatever the user types while the request
 * is in flight) but as a widget, not a zero-width inline decoration: inline
 * decorations require `from < to` (`InlineType.valid`/`.map` both drop
 * anything narrower, even across a transaction that never touches the doc),
 * so a point has nothing to be. A widget's `map` only drops on deletion.
 */
export function setAiInsertPoint(tr: Transaction, pos: number): Transaction {
  return tr.setMeta(key, { action: "add-point", pos } satisfies AiRewriteTrMeta);
}

export function getAiInsertPoint(state: EditorState): number | undefined {
  return getAiRewriteRange(state)?.from;
}

/**
 * The tracked range as of `state`, already mapped through everything that has
 * happened since it was set. `undefined` once it's been cleared, or if the
 * passage it covered is gone entirely.
 */
export function getAiRewriteRange(
  state: EditorState,
): { from: number; to: number } | undefined {
  const pluginState = key.getState(state);
  if (pluginState?.kind !== "active") return undefined;
  const found = pluginState.decorations.find();
  if (found.length !== 1) return undefined;
  const { from, to } = found[0];
  return { from, to };
}

export function aiRewriteDecoration(): Plugin<AiRewriteState> {
  return new Plugin<AiRewriteState>({
    key,
    state: {
      init: () => inactive,
      apply(tr, value): AiRewriteState {
        const meta = tr.getMeta(key) as AiRewriteTrMeta | undefined;
        if (meta?.action === "add-range") {
          const deco = Decoration.inline(
            meta.from,
            meta.to,
            { class: pendingHighlight },
            // Text typed at either edge is new writing, not part of the
            // passage the user picked - so the range must not swallow it.
            { inclusiveStart: false, inclusiveEnd: false },
          );
          return { kind: "active", decorations: DecorationSet.create(tr.doc, [deco]) };
        }
        if (meta?.action === "add-point") {
          // No visible marker - a widget with no width renders nothing.
          // `side: -1` keeps it glued to the content before it, so text typed
          // right at the point lands after the marker instead of splitting it
          // off to whichever side the browser's caret happened to bias.
          const deco = Decoration.widget(meta.pos, () => document.createElement("span"), {
            side: -1,
          });
          return { kind: "active", decorations: DecorationSet.create(tr.doc, [deco]) };
        }
        if (value.kind === "inactive") return value;
        if (meta?.action === "remove") return inactive;

        const decorations = value.decorations.map(tr.mapping, tr.doc);
        // The passage can be deleted mid-flight (select-all then type). The
        // decoration collapses to nothing and mapping drops it; without a
        // range to replace, the answer has nowhere to go.
        if (decorations.find().length !== 1) return inactive;
        return { kind: "active", decorations };
      },
    },
    props: {
      decorations(state) {
        const pluginState = key.getState(state);
        return pluginState?.kind === "active" ? pluginState.decorations : null;
      },
    },
  });
}
