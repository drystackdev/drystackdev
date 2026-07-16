// Toggling edit mode rewrites parts of the live page underneath the visitor —
// most visibly a fields.content spot, whose server-rendered markup is swapped
// wholesale for ProseMirror's render of the same document (and back again on
// exit). Even when the two render identically, the swap lands in a single
// frame, so any difference in height snaps the rest of the page up or down.
//
// The View Transitions API is the fix that fits: it snapshots the page, lets
// the mutation happen off-screen, then cross-fades old into new — so a swap
// that used to jolt reads as a dissolve. Callers hand their DOM mutation to
// `withViewTransition` instead of running it directly.

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => unknown;
};

/**
 * Runs `mutate` inside a View Transition, falling back to running it straight
 * through where there isn't one to use — Firefox and older Safari have no
 * `startViewTransition`, and a visitor who asked for reduced motion shouldn't
 * be handed a cross-fade. The fallback is why callers must treat the
 * transition as decoration only: `mutate` itself does the real work, and
 * nothing downstream may depend on the animation having run.
 *
 * `mutate` may return a promise, which the transition waits on before
 * snapshotting the new state — the hook a caller needs when the DOM isn't
 * final by the time its synchronous work returns.
 */
export function withViewTransition(mutate: () => void | Promise<void>): void {
  const start = (document as ViewTransitionDocument).startViewTransition;
  if (
    typeof start !== 'function' ||
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    void mutate();
    return;
  }
  start.call(document, mutate);
}
