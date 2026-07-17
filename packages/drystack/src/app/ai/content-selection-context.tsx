import {
  ReactNode,
  createContext,
  useContext,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";

/**
 * Which content field, if any, currently has a passage selected in it.
 *
 * The per-field button lives outside the editor (app/entry-form.tsx,
 * form/fields/object/ui.tsx) but has to step aside for the button that appears
 * at the selection, so the two need a shared signal.
 *
 * An external store rather than `useState`: dragging across text fires a
 * transaction per mouse move, and a state update here would re-render the
 * whole form on each one. The context value is a stable object, so only the
 * components that actually subscribe re-render.
 */
type ContentSelectionStore = {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => string | null;
  set: (key: string | null) => void;
  /**
   * Only the field that claimed the selection may release it. Without this,
   * an editor unmounting after another one has already claimed it would clear
   * a selection that isn't its own.
   */
  clear: (key: string) => void;
};

function createStore(): ContentSelectionStore {
  let activeKey: string | null = null;
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((l) => l());
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSnapshot: () => activeKey,
    set(key) {
      if (activeKey === key) return;
      activeKey = key;
      emit();
    },
    clear(key) {
      if (activeKey !== key) return;
      activeKey = null;
      emit();
    },
  };
}

const ContentSelectionContext = createContext<ContentSelectionStore | null>(null);

export function ContentSelectionProvider(props: { children: ReactNode }) {
  const ref = useRef<ContentSelectionStore | null>(null);
  if (!ref.current) ref.current = createStore();
  return (
    <ContentSelectionContext.Provider value={ref.current}>
      {props.children}
    </ContentSelectionContext.Provider>
  );
}

export function useContentSelectionStore() {
  return useContext(ContentSelectionContext);
}

/** Whether the field at `key` has a live passage selection right now. */
export function useHasContentSelection(key: string): boolean {
  const store = useContentSelectionStore();
  const subscribe = useMemo(
    () => store?.subscribe ?? (() => () => {}),
    [store],
  );
  const activeKey = useSyncExternalStore(
    subscribe,
    () => store?.getSnapshot() ?? null,
    () => null,
  );
  return activeKey === key;
}
