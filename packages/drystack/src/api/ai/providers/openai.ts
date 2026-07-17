import { describeError } from './anthropic';
import { AiProvider, AiProviderError, textStreamFromSse } from './types';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';

/**
 * Serves both `openai` and `openai-compatible`: Groq, DeepSeek, OpenRouter,
 * Ollama and Google's own OpenAI-compat endpoint all speak this same
 * `/chat/completions` shape, differing only in `baseUrl` and model name.
 */
export const openaiProvider: AiProvider = {
  name: 'openai',
  async stream({ apiKey, model, baseUrl, system, user, maxTokens, signal }) {
    const url = `${baseUrl ?? DEFAULT_BASE_URL}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        stream: true,
        max_completion_tokens: maxTokens,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new AiProviderError(await describeError(res, 'OpenAI'), res.status);
    }

    return textStreamFromSse(res.body, data => {
      // The stream terminates with a literal `[DONE]` sentinel rather than
      // just closing, and it isn't JSON — parsing it would throw.
      if (!data || data === '[DONE]') return undefined;
      try {
        const event = JSON.parse(data);
        return event.choices?.[0]?.delta?.content ?? undefined;
      } catch {
        return undefined;
      }
    });
  },
};
