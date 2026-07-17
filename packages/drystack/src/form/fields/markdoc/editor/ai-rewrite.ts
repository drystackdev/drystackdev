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

type AiRewriteTrMeta = { action: "add"; from: number; to: number } | { action: "remove" };

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
  return tr.setMeta(key, { action: "add", from, to } satisfies AiRewriteTrMeta);
}

export function clearAiRewriteRange(tr: Transaction): Transaction {
  return tr.setMeta(key, { action: "remove" } satisfies AiRewriteTrMeta);
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
        if (meta?.action === "add") {
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
