import { createStore, get, set, type UseStore } from "idb-keyval";
import { useEffect, useState } from "react";

let store: UseStore | undefined;
function getStore(): UseStore {
  if (!store) {
    // A distinct DB name (not just a distinct store within some shared
    // "drystack-sidebar" DB) - idb-keyval's createStore only creates the
    // object store during onupgradeneeded, which won't fire for a DB that
    // already exists at version 1 under this session's earlier "collapsed"
    // naming, silently leaving the new store missing (see the same note on
    // persistence.tsx's getViewsStore).
    store = createStore("drystack-sidebar-groups", "expanded");
  }
  return store;
}

const EXPANDED_KEY = "expanded";

async function readExpandedGroups(): Promise<string[]> {
  const stored = await get(EXPANDED_KEY, getStore());
  return Array.isArray(stored) ? stored : [];
}

// Which nav-groups (by title - "Collections"/"Singletons"/"System", or a
// site's own config.ui.navigation section names) are expanded in the
// sidebar. Tracked as an "expanded" allowlist (not a "collapsed" denylist) so
// every group - including ones added to the config later - defaults to
// closed until a user explicitly opens it. Shared across every tab/site in
// this browser, like the recent text colors list (recent-colors.ts) - not
// scoped per entry or per session, just a standing UI preference.
export function useExpandedNavGroups(): [Set<string>, (title: string) => void] {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    readExpandedGroups().then((titles) => setExpanded(new Set(titles)));
  }, []);

  const toggle = (title: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) {
        next.delete(title);
      } else {
        next.add(title);
      }
      set(EXPANDED_KEY, [...next], getStore());
      return next;
    });
  };

  return [expanded, toggle];
}
