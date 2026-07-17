/** @jest-environment node */
import { afterEach, expect, test } from "@jest/globals";

import { anthropicProvider } from "./anthropic";
import { googleProvider } from "./google";
import { openaiProvider } from "./openai";

// Each vendor's listing has its own shape, its own idea of which models can
// hold a conversation, and its own way of not telling you. These pin the
// reading of each - a filter that's one field off silently offers nothing,
// which looks exactly like a provider being down.

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});

function respondWith(body: unknown) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return {
      ok: true,
      status: 200,
      json: async () => body,
    } as any;
  }) as any;
  return calls;
}

test("google reads generateContent, not streamGenerateContent", async () => {
  // The listing never mentions `streamGenerateContent` even though every text
  // model streams: streaming is an alt mode of `generateContent` rather than a
  // method of its own. Filtering on the name `stream` uses matches nothing at
  // all, and the picker silently comes back empty.
  respondWith({
    models: [
      {
        name: "models/gemini-2.5-pro",
        displayName: "Gemini 2.5 Pro",
        supportedGenerationMethods: ["generateContent", "countTokens"],
      },
    ],
  });
  const models = await googleProvider.listModels({ apiKey: "k" });
  expect(models).toEqual([{ id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" }]);
});

test("google drops models that answer generateContent with something other than prose", async () => {
  respondWith({
    models: [
      { name: "models/gemini-2.5-pro", supportedGenerationMethods: ["generateContent"] },
      // Real entries from the live catalogue, all of which take generateContent
      // and none of which write.
      { name: "models/gemini-2.5-flash-preview-tts", supportedGenerationMethods: ["generateContent"] },
      { name: "models/gemini-3-pro-image", supportedGenerationMethods: ["generateContent"] },
      { name: "models/lyria-3-pro-preview", supportedGenerationMethods: ["generateContent"] },
      { name: "models/nano-banana-pro-preview", supportedGenerationMethods: ["generateContent"] },
      // These don't take generateContent at all.
      { name: "models/gemini-embedding-001", supportedGenerationMethods: ["embedContent"] },
      { name: "models/imagen-4.0-generate-001", supportedGenerationMethods: ["predict"] },
      { name: "models/veo-3.1-generate-preview", supportedGenerationMethods: ["predictLongRunning"] },
    ],
  });
  const models = await googleProvider.listModels({ apiKey: "k" });
  expect(models.map((m) => m.id)).toEqual(["gemini-2.5-pro"]);
});

test("anthropic keeps the vendor's order and display names", async () => {
  // Newest first is the order the endpoint returns, and it's the order worth
  // showing: `resolveAiModel` falls back to the first entry.
  respondWith({
    data: [
      { id: "claude-opus-4-5", display_name: "Claude Opus 4.5" },
      { id: "claude-sonnet-4-5", display_name: "Claude Sonnet 4.5" },
    ],
  });
  const models = await anthropicProvider.listModels({ apiKey: "k" });
  expect(models).toEqual([
    { id: "claude-opus-4-5", label: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
  ]);
});

test("openai hides the account catalogue's non-text families", async () => {
  respondWith({
    data: [
      { id: "gpt-5" },
      { id: "text-embedding-3-small" },
      { id: "dall-e-3" },
      { id: "whisper-1" },
      { id: "gpt-4o-realtime-preview" },
      { id: "omni-moderation-latest" },
    ],
  });
  const models = await openaiProvider.listModels({ apiKey: "k" });
  expect(models.map((m) => m.id)).toEqual(["gpt-5"]);
});

test("an openai-compatible endpoint keeps every id, since its naming means nothing to us", async () => {
  // Nothing here follows OpenAI's taxonomy, so guessing which of these is a
  // text model by name would only throw away working ones.
  const calls = respondWith({
    data: [{ id: "llama-3.3-70b-versatile" }, { id: "whisper-large-v3" }],
  });
  const models = await openaiProvider.listModels({
    apiKey: "k",
    baseUrl: "https://api.groq.com/openai/v1",
  });
  expect(models.map((m) => m.id)).toEqual([
    "llama-3.3-70b-versatile",
    "whisper-large-v3",
  ]);
  expect(calls).toEqual(["https://api.groq.com/openai/v1/models"]);
});

test("a listing that isn't the shape we expect is empty, not a crash", async () => {
  respondWith({ unexpected: true });
  expect(await googleProvider.listModels({ apiKey: "k" })).toEqual([]);
  expect(await openaiProvider.listModels({ apiKey: "k" })).toEqual([]);
  expect(await anthropicProvider.listModels({ apiKey: "k" })).toEqual([]);
});
