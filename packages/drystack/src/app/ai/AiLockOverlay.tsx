import { ReactNode } from "react";

import { css, tokenSchema } from "@keystar/ui/style";

import { useIsAiLocked } from "./lock-context";

/**
 * Makes a field inert while the AI is writing it.
 *
 * `pointer-events: none` rather than each field's own `isReadOnly`: that prop
 * isn't on `FormFieldInputProps`, so honouring it would mean touching every
 * field kind's Input. One wrapper covers them all. The rich-text editor is
 * the exception - a mouse guard can't stop the keyboard once the caret is
 * inside it, so it also flips ProseMirror's own `editable` (see
 * useEditorView).
 */
export function AiLockOverlay(props: { children: ReactNode }) {
  const isLocked = useIsAiLocked();
  if (!isLocked) return <>{props.children}</>;
  return (
    <div
      aria-busy="true"
      className={css({
        pointerEvents: "none",
        opacity: 0.7,
        // This div only exists while the AI writes, so it must not resize the
        // field on its way in. A no-op wherever the parent's height is auto
        // (every field in a form layout); it matters in the content pane, whose
        // editor sizes against its parent — see app/entry-form.tsx.
        height: "100%",
        // Marks it as "being written" without shifting layout - a border or
        // padding here would make every field jump as the stream progresses.
        outline: `1px dashed ${tokenSchema.color.border.accent}`,
        outlineOffset: tokenSchema.size.space.xsmall,
        borderRadius: tokenSchema.size.radius.small,
        transition: `opacity ${tokenSchema.animation.duration.short}`,
      })}
    >
      {props.children}
    </div>
  );
}
