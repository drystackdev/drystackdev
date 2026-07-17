import {
  ReactNode,
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";

import { useConfig } from "../shell/context";
import { useRouter } from "../router";

export type AiModel = { id: string; label?: string };

export type AiModelsState = {
  /** every model this key can call. Empty until loaded, or if the provider wouldn't say. */
  models: AiModel[];
  /** what the server would call if a request named nothing */
  serverDefault?: string;
  /** the user's override, or `undefined` to follow `serverDefault` */
  selected?: string;
  setSelected: (id: string | undefined) => void;
  isLoading: boolean;
  /** fetches the list, once per session. Safe to call on every dialog open. */
  load: () => void;
  /** drops a model proven unusable, so the picker stops offering it */
  dropModel: (id: string) => void;
};

const STORAGE_KEY = "drystack-ai-model";

const AiModelsContext = createContext<AiModelsState | undefined>(undefined);

export function useAiModels(): AiModelsState | undefined {
  return useContext(AiModelsContext);
}

function readStored(): string | undefined {
  try {
    return localStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    // Private mode, or storage disabled - the picker still works, the choice
    // just won't outlive the tab.
    return undefined;
  }
}

/**
 * Holds the model list and which model the user picked.
 *
 * Above both AI dialogs rather than inside either, for two reasons: a choice
 * made in one is the choice the other should show, and the list costs a
 * round-trip to the provider - once a session is enough. The fetch is lazy, so
 * a session that never opens an AI dialog never pays for it.
 */
export function AiModelProvider(props: { children: ReactNode }) {
  const config = useConfig();
  const { basePath } = useRouter();
  const hasAiConfig = !!config.ai;

  const [models, setModels] = useState<AiModel[]>([]);
  const [serverDefault, setServerDefault] = useState<string | undefined>();
  const [isLoading, setLoading] = useState(false);
  const [selected, setSelectedState] = useState<string | undefined>(readStored);
  const loadedRef = useRef(false);

  const load = useCallback(() => {
    // No `ai` block means the route 404s; the ref makes this idempotent, so
    // callers can fire it from an effect without tracking whether they're first.
    if (!hasAiConfig || loadedRef.current) return;
    loadedRef.current = true;
    setLoading(true);
    fetch(`/api${basePath}/ai/models`)
      .then((res) => (res.ok ? res.json() : undefined))
      .then((data) => {
        setLoading(false);
        if (!data) return;
        setModels(Array.isArray(data.models) ? data.models : []);
        setServerDefault(
          typeof data.selected === "string" ? data.selected : undefined,
        );
      })
      .catch(() => {
        // Not fatal: with no list the picker hides and generation falls back to
        // the configured model, which is exactly the old behaviour.
        setLoading(false);
      });
  }, [basePath, hasAiConfig]);

  const setSelected = useCallback((id: string | undefined) => {
    setSelectedState(id);
    try {
      if (id) localStorage.setItem(STORAGE_KEY, id);
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      // See readStored.
    }
  }, []);

  // The server has already struck this model off for everyone on this key; this
  // just spares the picker a refetch to find that out.
  const dropModel = useCallback(
    (id: string) => {
      setModels((prev) => prev.filter((m) => m.id !== id));
      setSelectedState((prev) => {
        if (prev !== id) return prev;
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {
          // See readStored.
        }
        return undefined;
      });
    },
    [],
  );

  // A stored choice can outlive the model it names (key rotated, provider
  // switched, model retired). Treating it as "no choice" falls back to the
  // server's default, which is what the picker will show. It isn't cleared from
  // storage here: an empty `models` only means the list hasn't landed yet.
  const isStale =
    !!selected && models.length > 0 && !models.some((m) => m.id === selected);

  return (
    <AiModelsContext.Provider
      value={{
        models,
        serverDefault,
        selected: isStale ? undefined : selected,
        setSelected,
        isLoading,
        load,
        dropModel,
      }}
    >
      {props.children}
    </AiModelsContext.Provider>
  );
}
