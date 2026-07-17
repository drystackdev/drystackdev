import { useEffect, useRef } from "react";

type FreshUploadTracker = (path: string) => void;

let currentTracker: FreshUploadTracker | null = null;

// Records that `path` (repo-relative; a leading slash, if any, is stripped)
// was freshly created - i.e. it didn't already exist - while the currently
// open entry's form is mounted. Called from the two real upload-commit
// points: `useFileManagerUpload`'s `commit()` and the eager
// `useMediaLibraryUpload` bridge, but only for paths that didn't overwrite
// something pre-existing (see each call site). A no-op whenever no entry
// form is mounted - e.g. uploads made from the standalone File Manager page
// never register a tracker, so nothing there is ever swept - see
// useEntryUploadSession, which is what registers one.
export function trackFreshUpload(path: string) {
  currentTracker?.(path.replace(/^\/+/, ""));
}

// Tracks fresh uploads for the life of one entry's editing session, used by
// useUpsertItem to clean up anything left referenced by nothing once the
// entry is actually saved. `entryKey` should be the entry's own `basePath`:
// ItemPage/CreateItem don't remount per-entry (they're keyed by collection),
// so resetting on every render would lose uploads mid-session, but never
// resetting would leak tracked paths from a previously viewed entry into
// this one - keying the reset off `entryKey` changing gets both right.
export function useEntryUploadSession(entryKey: string) {
  const pathsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    pathsRef.current = new Set();
    currentTracker = (path) => pathsRef.current.add(path);
    return () => {
      currentTracker = null;
    };
  }, [entryKey]);

  return {
    // read-only - use to check what's tracked without consuming it.
    paths(): string[] {
      return [...pathsRef.current];
    },
    // call only after a save actually succeeds; a failed save must leave
    // tracked paths in place so a retry can still clean them up.
    clear() {
      pathsRef.current.clear();
    },
  };
}
