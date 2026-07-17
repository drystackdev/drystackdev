import { asArray, describeError } from "./anthropic";
import { AiModel, AiProvider, AiProviderError, textStreamFromSse } from "./types";

const DEFAULT_BASE_URL = "https://api.openai.com/v1";

// `/models` on api.openai.com lists the whole account catalogue - embeddings,
// speech, images, moderation - and nothing in the payload says which of them
// can hold a conversation. Naming is the only signal available, so this is a
// denylist of families we know aren't text, applied only to OpenAI's own
// endpoint: a compatible provider's ids follow no taxonomy we can read.
const NOT_A_TEXT_MODEL =
  /embedding|moderation|whisper|transcribe|tts|audio|dall-e|image|^sora|realtime|^davinci|^babbage/;

/**
 * Serves both `openai` and `openai-compatible`: Groq, DeepSeek, OpenRouter,
 * Ollama and Google's own OpenAI-compat endpoint all speak this same
 * `/chat/completions` shape, differing only in `baseUrl` and model name.
 */
export const openaiProvider: AiProvider = {
  name: "openai",
  async stream({ apiKey, model, baseUrl, system, user, maxTokens, signal }) {
    const url = `${baseUrl ?? DEFAULT_BASE_URL}/chat/completions`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_completion_tokens: maxTokens,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new AiProviderError(await describeError(res, "OpenAI"), res.status);
    }

    return textStreamFromSse(res.body, (data) => {
      // The stream terminates with a literal `[DONE]` sentinel rather than
      // just closing, and it isn't JSON - parsing it would throw.
      if (!data || data === "[DONE]") return undefined;
      try {
        const event = JSON.parse(data);
        return event.choices?.[0]?.delta?.content ?? undefined;
      } catch {
        return undefined;
      }
    });
  },

  async listModels({ apiKey, baseUrl, signal }): Promise<AiModel[]> {
    const base = baseUrl ?? DEFAULT_BASE_URL;
    const res = await fetch(`${base}/models`, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal,
    });
    if (!res.ok) {
      throw new AiProviderError(await describeError(res, "OpenAI"), res.status);
    }
    const body = (await res.json()) as any;
    const ids = asArray(body?.data)
      .map((m: any) => m?.id)
      .filter((id: unknown): id is string => typeof id === "string");
    const filtered =
      base === DEFAULT_BASE_URL
        ? ids.filter((id) => !NOT_A_TEXT_MODEL.test(id))
        : ids;
    // Unlike Anthropic's, this list has no useful order - `created` is absent
    // from some compatible endpoints, so sorting by name at least makes the
    // picker predictable.
    return filtered.sort().map((id) => ({ id }));
  },
};
