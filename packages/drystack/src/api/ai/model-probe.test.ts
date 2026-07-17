/** @jest-environment node */
import { beforeEach, expect, test } from "@jest/globals";

import type { AiRuntimeConfig } from "./env";
import { clearModelCache, probeModel, resolveAiModel } from "./model-registry";
import { AiProviderError, type AiProvider } from "./providers/types";

// A model's presence in the catalogue doesn't mean the key may call it, and the
// only thing that knows is the provider. These cover the "ask it, for real"
// path the picker uses when a model is chosen.

type StreamOutcome = "ok" | AiProviderError;

function stubProvider(outcomes: Record<string, StreamOutcome>) {
  const streamed: string[] = [];
  const provider: AiProvider & { streamed: string[] } = {
    name: "stub",
    streamed,
    async stream({ model, maxTokens }) {
      streamed.push(`${model}:${maxTokens}`);
      const outcome = outcomes[model];
      if (outcome instanceof AiProviderError) throw outcome;
      return new ReadableStream<string>({
        start(controller) {
          controller.enqueue("OK");
          controller.close();
        },
      });
    },
    async listModels() {
      return Object.keys(outcomes).map((id) => ({ id }));
    },
  };
  return provider;
}

function runtime(over: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    provider: "google",
    apiKey: "sk-test",
    preferredModel: "live-model",
    defaultModel: "house-model",
    ...over,
  };
}

const gone = new AiProviderError(
  "Google trả lỗi 404: This model models/dead-model is no longer available to new users.",
  404,
);
const quota = new AiProviderError(
  "Google trả lỗi 429 (đã chạm giới hạn tốc độ): You exceeded your current quota.",
  429,
);

beforeEach(clearModelCache);

test("a model that answers is reported usable", async () => {
  const provider = stubProvider({ "live-model": "ok" });
  expect(await probeModel(provider, runtime(), "live-model")).toEqual({
    ok: true,
  });
});

test("the probe costs one token and goes down the real generation path", async () => {
  // Not a cheaper endpoint: Google's countTokens answers 200 for models that
  // generateContent then refuses, so a probe that took a shortcut would bless
  // a model that can't write.
  const provider = stubProvider({ "live-model": "ok" });
  await probeModel(provider, runtime(), "live-model");
  expect(provider.streamed).toEqual(["live-model:1"]);
});

test("a 404 marks the model gone", async () => {
  const provider = stubProvider({ "dead-model": gone });
  expect(await probeModel(provider, runtime(), "dead-model")).toMatchObject({
    ok: false,
    reason: "gone",
  });
});

test("a model proven gone stops being resolvable, so it leaves the picker", async () => {
  const provider = stubProvider({ "dead-model": gone, "live-model": "ok" });
  await probeModel(provider, runtime(), "dead-model");

  const picked = await resolveAiModel(provider, runtime(), "dead-model");
  expect(picked).toMatchObject({ model: "live-model" });
  expect(picked).not.toMatchObject({ models: [{ id: "dead-model" }] });
});

test("a rate limit does NOT condemn the model", async () => {
  // 429 says the moment is wrong, not the model. Striking it off here would
  // permanently delete a working model over a temporary quota blip.
  const provider = stubProvider({ "live-model": quota });
  expect(await probeModel(provider, runtime(), "live-model")).toMatchObject({
    ok: false,
    reason: "unavailable",
  });

  const picked = await resolveAiModel(provider, runtime());
  expect(picked).toMatchObject({ model: "live-model" });
});

test("a proven model isn't probed twice", async () => {
  const provider = stubProvider({ "live-model": "ok" });
  await probeModel(provider, runtime(), "live-model");
  await probeModel(provider, runtime(), "live-model");
  expect(provider.streamed).toEqual(["live-model:1"]);
});

test("a model already known dead is answered without asking again", async () => {
  const provider = stubProvider({ "dead-model": gone });
  await probeModel(provider, runtime(), "dead-model");
  expect(provider.streamed).toHaveLength(1);

  expect(await probeModel(provider, runtime(), "dead-model")).toMatchObject({
    ok: false,
    reason: "gone",
  });
  expect(provider.streamed).toHaveLength(1);
});

test("a 404 that doesn't implicate the model is not the model's fault", async () => {
  // A wrong DRY_AI_BASE_URL 404s too. Condemning the model for that would walk
  // the whole list marking every working model dead.
  const provider = stubProvider({
    "live-model": new AiProviderError("Not Found", 404),
  });
  expect(await probeModel(provider, runtime(), "live-model")).toMatchObject({
    ok: false,
    reason: "unavailable",
  });
  // Still resolvable: nothing was struck off.
  expect(await resolveAiModel(provider, runtime())).toMatchObject({
    model: "live-model",
  });
});
