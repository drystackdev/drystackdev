import { useEffect, useMemo, useState } from "react";
import { useTree } from "../shell/data";
import { TreeEntry } from "../trees";

export function useDebouncedValue<T>(value: T, delayMs = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

// every file under `root` (any depth) whose name matches `query` - `null`
// when there's no active query, so callers can fall back to the normal
// directory listing
export function useSearchResults(
  root: string,
  query: string,
): TreeEntry[] | null {
  const tree = useTree().current;
  const debounced = useDebouncedValue(query);
  return useMemo(() => {
    const needle = debounced.trim().toLowerCase();
    if (!needle || tree.kind !== "loaded") return null;
    const prefix = root ? `${root}/` : "";
    return [...tree.data.entries.values()].filter(
      (entry) =>
        entry.type === "blob" &&
        entry.path.startsWith(prefix) &&
        entry.path.split("/").pop()!.toLowerCase().includes(needle),
    );
  }, [tree, root, debounced]);
}
