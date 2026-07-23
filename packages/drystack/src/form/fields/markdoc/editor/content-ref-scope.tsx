import { createContext, useContext } from "react";
import type { EntryRef } from "../../../../app/path-utils";

// The EntryRef of the entry this content editor instance belongs to - lets
// the "Import content" button (content-ref.tsx) exclude the entry currently
// being edited from its own picker (an entry can't import its own top-level
// content field). `null` when there's no entry in scope.
const ContentRefScopeContext = createContext<EntryRef | null>(null);
export const ContentRefScopeProvider = ContentRefScopeContext.Provider;
export function useContentRefScope() {
  return useContext(ContentRefScopeContext);
}
