import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";

import { useConfig } from "../shell/context";
import { useRouter } from "../router";
import { isDemoConfig } from "../storage-mode";

export type AiStatus = {
  configured: boolean;
  provider?: string;
  model?: string;
  reason?: string;
  message?: string;
  params?: Record<string, string>;
};

// `undefined` while the check is in flight, so callers can tell "not yet
// known" from "known to be broken" and avoid flashing a warning on load.
const AiStatusContext = createContext<AiStatus | undefined>(undefined);

export function useAiStatus(): AiStatus | undefined {
  return useContext(AiStatusContext);
}

/**
 * Asks the server once whether an AI key is present. The answer never
 * includes the key itself - only whether one is configured, and what it
 * points at.
 */
export function AiStatusProvider(props: { children: ReactNode }) {
  const config = useConfig();
  const { basePath } = useRouter();
  const [status, setStatus] = useState<AiStatus | undefined>(undefined);
  const hasAiConfig = !!config.ai;

  useEffect(() => {
    // No `ai` block means the routes 404 - asking would only produce a
    // misleading "not configured" for a feature nobody turned on.
    if (!hasAiConfig) return;
    // A demo build has no `/api/<base>/ai/status` to ask (fully static - see
    // app/demo-source.ts) - synthesize the same shape locally instead, from
    // whether the site owner set storage.ai.url at all. No round-trip needed:
    // there's nothing server-side to check (the demo proxy's own state,
    // rate limit included, isn't this site's to report on).
    if (isDemoConfig(config)) {
      setStatus({
        configured: !!config.storage.ai?.url,
        provider: "demo",
        model: config.storage.ai?.model,
      });
      return;
    }
    let cancelled = false;
    fetch(`/api${basePath}/ai/status`)
      .then((res) => (res.ok ? res.json() : undefined))
      .then((data) => {
        if (!cancelled && data) setStatus(data);
      })
      .catch(() => {
        // A failed check shouldn't block the admin UI; the generate route
        // reports its own errors when actually used.
      });
    return () => {
      cancelled = true;
    };
  }, [basePath, config, hasAiConfig]);

  return (
    <AiStatusContext.Provider value={status}>
      {props.children}
    </AiStatusContext.Provider>
  );
}
