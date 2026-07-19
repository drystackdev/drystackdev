import { ReactNode, createContext, useContext, useMemo } from "react";

import { PathContext } from "../../form/fields/text/path-slug-context";
import {
  FieldMagicWriteProvider,
  FieldMagicWriteValue,
} from "./field-magic-write-context";

// Which top-level fields the AI is mid-write on. A context rather than a prop
// because the lock has to reach the editor at the bottom of the form
// (Field → Editor → ProseMirrorEditor → useEditorView) and every field's
// Input in between, none of which otherwise care that AI exists.
const AiLockedKeysContext = createContext<ReadonlySet<string>>(new Set());

/**
 * Everything the form below needs from the AI feature: which fields are
 * locked, and (when the entry is opted in) what a per-field button would need
 * to start a write. Combined into one provider because they always mount
 * together at the same point - the page that owns the entry's state.
 */
export function AiLockProvider(props: {
  lockedKeys: ReadonlySet<string>;
  fieldMagicWrite?: FieldMagicWriteValue | null;
  children: ReactNode;
}) {
  return (
    <AiLockedKeysContext.Provider value={props.lockedKeys}>
      <FieldMagicWriteProvider value={props.fieldMagicWrite ?? null}>
        {props.children}
      </FieldMagicWriteProvider>
    </AiLockedKeysContext.Provider>
  );
}

/**
 * Whether the field at the current form path is being written right now.
 *
 * Locks are held at the top-level key: an object or array stays locked as a
 * whole until its block is fully parsed, so items never appear one at a time
 * and half-built structures are never editable.
 */
export function useIsAiLocked(): boolean {
  const lockedKeys = useContext(AiLockedKeysContext);
  const path = useContext(PathContext);
  return useMemo(() => {
    if (!lockedKeys.size) return false;
    const root = path[0];
    return typeof root === "string" && lockedKeys.has(root);
  }, [lockedKeys, path]);
}
