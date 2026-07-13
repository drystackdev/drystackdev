import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CollectionViewState,
  getCollectionViewState,
  setCollectionViewState,
} from '../persistence';

// column visibility/widths for a collection's entries table, persisted to
// IndexedDB (see persistence.tsx) so it survives reloads. new schema fields
// show up by default since we track *hidden* columns, not visible ones —
// except `defaultHiddenColumns` (image/content fields, see CollectionPage),
// which stay hidden until the user has ever saved an explicit choice for
// this collection.
export function useCollectionViewState(
  collection: string,
  defaultHiddenColumns: readonly string[] = []
) {
  const [saved, setSaved] = useState<CollectionViewState | undefined>(
    undefined
  );

  useEffect(() => {
    let cancelled = false;
    setSaved(undefined);
    getCollectionViewState(collection).then(loaded => {
      if (!cancelled) setSaved(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [collection]);

  const hiddenColumns = useMemo(
    () => new Set(saved?.hiddenColumns ?? defaultHiddenColumns),
    [saved, defaultHiddenColumns]
  );

  // shared by the setters below so each only has to describe the field it's
  // changing, leaving the other field's current value untouched
  const setViewState = useCallback(
    (patch: Partial<CollectionViewState>) => {
      const next: CollectionViewState = {
        hiddenColumns:
          patch.hiddenColumns ?? saved?.hiddenColumns ?? [...defaultHiddenColumns],
        columnWidths: 'columnWidths' in patch ? patch.columnWidths : saved?.columnWidths,
      };
      setSaved(next);
      setCollectionViewState(collection, next);
    },
    [collection, saved, defaultHiddenColumns]
  );

  const setHiddenColumns = useCallback(
    (keys: ReadonlySet<string> | string[]) => {
      setViewState({ hiddenColumns: [...keys] });
    },
    [setViewState]
  );

  const setColumnWidths = useCallback(
    (widths: Record<string, string>) => {
      setViewState({ columnWidths: widths });
    },
    [setViewState]
  );

  return {
    hiddenColumns,
    setHiddenColumns,
    columnWidths: saved?.columnWidths,
    setColumnWidths,
  };
}
