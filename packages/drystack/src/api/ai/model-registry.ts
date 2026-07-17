// Settles which model a request actually calls.
//
// `DRY_AI_MODEL` can't answer that on its own: it may name a model this key was
// never granted, or a model the vendor has since retired, and it may not be set
// at all. So the name on the wire is chosen per request against the list the
// key itself reports, with the env var as the preference at the front of the
// queue rather than the last word.

import type { AiConfigError, AiRuntimeConfig } from "./env";
import type { AiModel, AiProvider } from "./providers/types";

// Long enough that a burst of generates costs one listing, short enough that a
// newly released model shows up the same session. Vendors change this list on
// the order of weeks.
const CACHE_TTL_MS = 5 * 60_000;

type CacheEntry = { at: number; models: Promise<AiModel[]> };

const cache = new Map<string, CacheEntry>();

function cacheKey(runtime: AiRuntimeConfig): string {
  // The key is part of the identity, not just the endpoint: two keys on the
  // same provider can see different models, and rotating one must not serve
  // the old key's list.
  return `${runtime.provider}|${runtime.baseUrl ?? ""}|${runtime.apiKey}`;
}

/**
 * The models this key can call, or `[]` if the provider wouldn't say. Concurrent
 * callers share one in-flight request; a failed lookup isn't cached, so the next
 * request retries rather than inheriting a blank list for the next five minutes.
 */
export async function listModelsCached(
  provider: AiProvider,
  runtime: AiRuntimeConfig,
): Promise<AiModel[]> {
  const key = cacheKey(runtime);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.models;

  const models = provider
    .listModels({ apiKey: runtime.apiKey, baseUrl: runtime.baseUrl })
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: Date.now(), models });
  return models;
}

/** Only for tests - a module-level cache would otherwise leak between them. */
export function clearModelCache() {
  cache.clear();
}

export type ResolvedModel = {
  model: string;
  /** every model the key can call, for a picker to offer. `[]` if unknown. */
  models: AiModel[];
  /** why the list is missing, when it is. Not fatal on its own. */
  listError?: string;
};

/**
 * Picks the model to call, in order of preference:
 *
 * 1. `requested` - what the user chose in the picker, but only if the key can
 *    actually call it. A request naming anything else is treated as not having
 *    named one, so a hand-crafted call can't spend the key on a model the admin
 *    never exposed.
 * 2. `DRY_AI_MODEL`, on the same terms.
 * 3. The provider's house model, on the same terms.
 * 4. Whatever the key lists first - the default this key has, when none of the
 *    names above are among the models it can see.
 *
 * If the list can't be fetched there's nothing to validate against, so the
 * configured names are tried anyway - a provider whose `/models` is down or
 * unimplemented shouldn't take generation down with it - but `requested` is
 * dropped: an unverifiable name from the client is exactly what step 1 exists
 * to keep off the wire.
 */
export async function resolveAiModel(
  provider: AiProvider,
  runtime: AiRuntimeConfig,
  requested?: unknown,
): Promise<ResolvedModel | AiConfigError> {
  let models: AiModel[] = [];
  let listError: string | undefined;
  try {
    models = await listModelsCached(provider, runtime);
  } catch (err) {
    listError = err instanceof Error ? err.message : String(err);
  }

  const configured = [runtime.preferredModel, runtime.defaultModel].filter(
    (id): id is string => !!id,
  );

  if (models.length) {
    const available = new Set(models.map((m) => m.id));
    const requestedId = typeof requested === "string" ? requested.trim() : "";
    const match = [requestedId, ...configured].find(
      (id) => id && available.has(id),
    );
    return { model: match ?? models[0].id, models };
  }

  const fallback = configured[0];
  if (fallback) return { model: fallback, models, listError };

  return {
    reason: "missing-model",
    message: `Không xác định được model: ${
      listError ?? "provider không trả về model nào"
    }. Đặt DRY_AI_MODEL để chỉ định cụ thể.`,
    params: { detail: listError ?? "" },
  };
}
