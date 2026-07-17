// Reads and validates the DRY_AI_* environment variables into a runtime
// config the route can use, or an error the `ai/status` route can explain to
// the user. Deliberately has no `fetch`/provider code in it, so the status
// route can answer "is this configured?" without loading an adapter.

export const AI_PROVIDERS = [
  'anthropic',
  'openai',
  'google',
  'openai-compatible',
] as const;

export type AiProviderName = (typeof AI_PROVIDERS)[number];

export type AiRuntimeConfig = {
  provider: AiProviderName;
  apiKey: string;
  model: string;
  baseUrl?: string;
};

export type AiConfigErrorReason =
  | 'missing-provider'
  | 'unknown-provider'
  | 'missing-key'
  | 'missing-model'
  | 'missing-base-url';

export type AiConfigError = { reason: AiConfigErrorReason; message: string };

export type AiEnv = {
  DRY_AI_PROVIDER?: string;
  DRY_AI_KEY?: string;
  DRY_AI_MODEL?: string;
  DRY_AI_BASE_URL?: string;
};

// Every provider but `openai-compatible` has a sensible default — that one
// points at an arbitrary third-party endpoint (Groq, DeepSeek, OpenRouter,
// Ollama, …), so there's no model name we could guess. It's the only provider
// where DRY_AI_MODEL is mandatory.
const DEFAULT_MODELS: Record<AiProviderName, string | undefined> = {
  anthropic: 'claude-sonnet-5',
  openai: 'gpt-5',
  google: 'gemini-2.5-pro',
  'openai-compatible': undefined,
};

function isProviderName(value: string): value is AiProviderName {
  return (AI_PROVIDERS as readonly string[]).includes(value);
}

export function resolveAiEnv(env: AiEnv): AiRuntimeConfig | AiConfigError {
  const rawProvider = env.DRY_AI_PROVIDER?.trim();
  if (!rawProvider) {
    return {
      reason: 'missing-provider',
      message: 'DRY_AI_PROVIDER chưa được cấu hình.',
    };
  }
  const provider = rawProvider.toLowerCase();
  if (!isProviderName(provider)) {
    return {
      reason: 'unknown-provider',
      message: `DRY_AI_PROVIDER="${rawProvider}" không hợp lệ. Chọn một trong: ${AI_PROVIDERS.join(', ')}.`,
    };
  }

  const apiKey = env.DRY_AI_KEY?.trim();
  if (!apiKey) {
    return {
      reason: 'missing-key',
      message: 'DRY_AI_KEY chưa được cấu hình.',
    };
  }

  const model = env.DRY_AI_MODEL?.trim() || DEFAULT_MODELS[provider];
  if (!model) {
    return {
      reason: 'missing-model',
      message:
        'DRY_AI_MODEL là bắt buộc khi DRY_AI_PROVIDER="openai-compatible" (không có model mặc định cho endpoint tuỳ chỉnh).',
    };
  }

  const baseUrl = env.DRY_AI_BASE_URL?.trim();
  if (provider === 'openai-compatible' && !baseUrl) {
    return {
      reason: 'missing-base-url',
      message:
        'DRY_AI_BASE_URL là bắt buộc khi DRY_AI_PROVIDER="openai-compatible".',
    };
  }

  return {
    provider,
    apiKey,
    model,
    // Trailing slash here would produce `//chat/completions` once joined.
    baseUrl: baseUrl?.replace(/\/+$/, ''),
  };
}

export function isAiConfigError(
  value: AiRuntimeConfig | AiConfigError
): value is AiConfigError {
  return 'reason' in value;
}
