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

// Models the listing offered but the provider then refused, keyed like `cache`.
//
// This exists because a listing is the vendor's catalogue, not a statement of
// what the key may call. Google will happily list `gemini-2.5-flash` and then
// answer a real request with 404 "no longer available to new users", and
// nothing in the listed metadata separates that model from a working one - the
// two are byte-for-byte identical in shape. `countTokens` accepts both, and the
// v1 listing is no better than v1beta. So the only way to know is to be told,
// and the only thing that tells us is a failed request.
//
// Deliberately not on the same TTL as `cache`: a model being gone isn't a fact
// that goes stale in five minutes, and re-learning it costs a wasted request.
// It's per-isolate, so it's rebuilt from scratch after a deploy or a recycle,
// which is a fine upper bound on how long a wrong entry could last.
const unusable = new Map<string, Set<string>>();

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
  unusable.clear();
}

/**
 * Records that the provider refused to run this model, so it stops being
 * offered and stops being chosen. Called when a request comes back 404: the
 * endpoint is ours and known-good, so the thing that wasn't found is the model.
 */
export function markModelUnusable(runtime: AiRuntimeConfig, model: string) {
  const key = cacheKey(runtime);
  const dead = unusable.get(key);
  if (dead) dead.add(model);
  else unusable.set(key, new Set([model]));
}

/**
 * Whether a 404 is the model's fault. A misconfigured `DRY_AI_BASE_URL` also
 * 404s, and blaming the model for that would burn through every model on the
 * list marking each one dead, so the provider has to actually implicate the
 * model before we believe it.
 */
export function isModelGone(
  status: number,
  message: string,
  model: string,
): boolean {
  if (status !== 404) return false;
  const text = message.toLowerCase();
  return text.includes(model.toLowerCase()) || text.includes("model");
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

  // Anything already proven unusable is not a candidate, and not something to
  // offer in a picker either.
  const dead = unusable.get(cacheKey(runtime));
  if (dead?.size) models = models.filter((m) => !dead.has(m.id));

  const configured = [runtime.preferredModel, runtime.defaultModel].filter(
    (id): id is string => !!id && !dead?.has(id),
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
