import { createStore, get, set, type UseStore } from "idb-keyval";
import { useEffect, useState } from "react";

const MAX_RECENT = 6;

let store: UseStore | undefined;
function getStore(): UseStore {
  if (!store) {
    store = createStore("drystack-text-color", "recent");
  }
  return store;
}

const RECENT_KEY = "recent";

async function readRecentTextColors(): Promise<string[]> {
  const stored = await get(RECENT_KEY, getStore());
  return Array.isArray(stored) ? stored : [];
}

function withRecentColor(prev: string[], value: string): string[] {
  return [value, ...prev.filter((c) => c !== value)].slice(0, MAX_RECENT);
}

// A single global list of recently-applied text colors, shared across every
// field/entry/site in this browser - like a "recent emoji" picker, not
// scoped to a repo the way brand-store.ts is.
export function useRecentTextColors(): [string[], (value: string) => void] {
  const [colors, setColors] = useState<string[]>([]);
  useEffect(() => {
    readRecentTextColors().then(setColors);
  }, []);
  return [
    colors,
    (value: string) => {
      setColors((prev) => {
        const next = withRecentColor(prev, value);
        set(RECENT_KEY, next, getStore());
        return next;
      });
    },
  ];
}
