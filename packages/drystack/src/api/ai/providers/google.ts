import { asArray, describeError } from './anthropic';
import { AiModel, AiProvider, AiProviderError, textStreamFromSse } from './types';

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

// Plenty of models answer `generateContent` with something that isn't prose:
// speech, images, video, music. The listing has no field that says so, so - as
// with OpenAI's catalogue - naming is the only signal, and this is a denylist
// of families we know don't write.
const DOES_NOT_WRITE_PROSE =
  /-tts|image|^lyria|^nano-banana|^veo|^imagen|embedding|robotics|computer-use|native-audio|-live-/;

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

  async listModels({ apiKey, signal }): Promise<AiModel[]> {
    const res = await fetch(`${BASE_URL}/models?pageSize=1000`, {
      headers: { 'x-goog-api-key': apiKey },
      signal,
    });
    if (!res.ok) {
      throw new AiProviderError(await describeError(res, 'Google'), res.status);
    }
    const body = (await res.json()) as any;
    return asArray(body?.models)
      .filter(
        (m: any) =>
          typeof m?.name === 'string' &&
          // The list also carries embedding, image and video models, which
          // would fail the moment they were picked. Note this is
          // `generateContent`, not the `streamGenerateContent` that `stream`
          // actually calls: Google lists only the former, and streaming is an
          // alt mode of it rather than a method in its own right. Filtering on
          // the latter matches nothing at all.
          asArray(m?.supportedGenerationMethods).includes('generateContent')
      )
      .map((m: any) => ({
        // Names come back fully qualified (`models/gemini-2.5-pro`) but the
        // request path adds that prefix back itself.
        id: String(m.name).replace(/^models\//, ''),
        label: m.displayName || undefined,
      }))
      .filter(m => !DOES_NOT_WRITE_PROSE.test(m.id));
  },
};
