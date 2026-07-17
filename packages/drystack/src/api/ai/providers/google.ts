import { describeError } from './anthropic';
import { AiProvider, AiProviderError, textStreamFromSse } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

export const googleProvider: AiProvider = {
  name: 'google',
  async stream({ apiKey, model, system, user, maxTokens, signal }) {
    // `alt=sse` is required: without it the endpoint streams a JSON array in
    // chunks rather than SSE events, which the shared parser can't read.
    const url = `${BASE_URL}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { maxOutputTokens: maxTokens },
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new AiProviderError(await describeError(res, 'Google'), res.status);
    }

    return textStreamFromSse(res.body, data => {
      if (!data) return undefined;
      try {
        const event = JSON.parse(data);
        // A chunk can carry several parts; concatenating keeps their order.
        const parts = event.candidates?.[0]?.content?.parts;
        if (!Array.isArray(parts)) return undefined;
        return parts.map((p: any) => p.text ?? '').join('') || undefined;
      } catch {
        return undefined;
      }
    });
  },
};
