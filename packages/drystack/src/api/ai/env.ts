// Reads and validates the DRY_AI_* environment variables into a runtime
// config the route can use, or an error the `ai/status` route can explain to
// the user. Deliberately has no `fetch`/provider code in it, so the status
// route can answer "is this configured?" without loading an adapter.

export const AI_PROVIDERS = [
  "anthropic",
  "openai",
  "google",
  "openai-compatible",
] as const;

export type AiProviderName = (typeof AI_PROVIDERS)[number];

export type AiRuntimeConfig = {
  provider: AiProviderName;
  apiKey: string;
  /**
   * DRY_AI_MODEL, when set. A preference rather than a decision: which model
   * actually gets called is settled per request against the list the key can
   * see (see `model-registry.ts`), because an env var can name a model this
   * key was never given access to.
   */
  preferredModel?: string;
  /** The provider's house model, for when nothing better is established. */
  defaultModel?: string;
  baseUrl?: string;
};

export type AiConfigErrorReason =
  | "missing-provider"
  | "unknown-provider"
  | "missing-key"
  | "missing-model"
  | "missing-base-url";

export type AiConfigError = {
  reason: AiConfigErrorReason;
  message: string;
  /** Interpolation values the admin UI needs to localize `reason` (e.g. the invalid provider name). */
  params?: Record<string, string>;
};

export type AiEnv = {
  DRY_AI_PROVIDER?: string;
  DRY_AI_KEY?: string;
  DRY_AI_MODEL?: string;
  DRY_AI_BASE_URL?: string;
};

// Every provider but `openai-compatible` has a house model worth defaulting to
// - that one points at an arbitrary third-party endpoint (Groq, DeepSeek,
// OpenRouter, Ollama, …), so there's no model name we could guess. For it the
// fallback is whatever the endpoint lists first.
const DEFAULT_MODELS: Record<AiProviderName, string | undefined> = {
  anthropic: "claude-sonnet-5",
  openai: "gpt-5",
  google: "gemini-2.5-pro",
  "openai-compatible": undefined,
};

function isProviderName(value: string): value is AiProviderName {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function resolveAiEnv(env: AiEnv): AiRuntimeConfig | AiConfigError {
  const rawProvider = env.DRY_AI_PROVIDER?.trim();
  if (!rawProvider) {
    return {
      reason: "missing-provider",
      message: "DRY_AI_PROVIDER chưa được cấu hình.",
    };
  }
  const provider = rawProvider.toLowerCase();
  if (!isProviderName(provider)) {
    return {
      reason: "unknown-provider",
      message: `DRY_AI_PROVIDER="${rawProvider}" không hợp lệ. Chọn một trong: ${AI_PROVIDERS.join(", ")}.`,
      params: { provider: rawProvider, providers: AI_PROVIDERS.join(", ") },
    };
  }

  const apiKey = env.DRY_AI_KEY?.trim();
  if (!apiKey) {
    return {
      reason: "missing-key",
      message: "DRY_AI_KEY chưa được cấu hình.",
    };
  }

  // No check that a model is named: an unset DRY_AI_MODEL is a valid config
  // now, and even a set one may not survive validation against the key's own
  // list. Being unable to settle on a model is a per-request failure, not a
  // configuration one.
  const baseUrl = env.DRY_AI_BASE_URL?.trim();
  if (provider === "openai-compatible" && !baseUrl) {
    return {
      reason: "missing-base-url",
      message:
        'DRY_AI_BASE_URL là bắt buộc khi DRY_AI_PROVIDER="openai-compatible".',
    };
  }

  return {
    provider,
    apiKey,
    preferredModel: env.DRY_AI_MODEL?.trim() || undefined,
    defaultModel: DEFAULT_MODELS[provider],
    // Trailing slash here would produce `//chat/completions` once joined.
    baseUrl: baseUrl?.replace(/\/+$/, ""),
  };
}

// Generic over what it's discriminating against: the same narrowing serves the
// env resolution and the per-request model resolution, which both answer "the
// thing you asked for, or a config error explaining why not".
export function isAiConfigError<T extends object>(
  value: T | AiConfigError,
): value is AiConfigError {
  return "reason" in value;
}
