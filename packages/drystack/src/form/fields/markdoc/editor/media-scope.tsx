import { createContext, useContext } from "react";
import { MediaLibraryLocalScope } from "../../../../app/media-library/bridge";

// the "this entry's own images" tab to offer alongside the shared library
// when opening the media dialog from within this content editor instance -
// `null` when the editor isn't scoped to an entry (e.g. inside a singleton)
const MediaScopeContext = createContext<MediaLibraryLocalScope | null>(null);
export const MediaScopeProvider = MediaScopeContext.Provider;
export function useMediaScope() {
  return useContext(MediaScopeContext);
}
