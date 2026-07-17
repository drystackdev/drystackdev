/** @jest-environment node */
import { beforeEach, expect, test } from "@jest/globals";

import type { AiRuntimeConfig } from "./env";
import { clearModelCache, resolveAiModel } from "./model-registry";
import type { AiProvider } from "./providers/types";

// The point of all this: DRY_AI_MODEL can name a model the key was never given,
// and the client can ask for one it was never offered. Neither gets to decide
// what goes on the wire on its own.

type Stub = AiProvider & { calls: number };

function stubProvider(result: string[] | Error): Stub {
  const provider: any = {
    name: "stub",
    calls: 0,
    async stream() {
      throw new Error("stream is not exercised here");
    },
    async listModels() {
      provider.calls++;
      if (result instanceof Error) throw result;
      return result.map((id) => ({ id }));
    },
  };
  return provider;
}

function runtime(over: Partial<AiRuntimeConfig> = {}): AiRuntimeConfig {
  return {
    provider: "anthropic",
    apiKey: "sk-test",
    preferredModel: "from-env",
    defaultModel: "house-model",
    ...over,
  };
}

// The module-level cache is keyed by provider+baseUrl+apiKey, which these share.
beforeEach(clearModelCache);

test("DRY_AI_MODEL wins when the key can call it", async () => {
  const provider = stubProvider(["house-model", "from-env", "other"]);
  const picked = await resolveAiModel(provider, runtime());
  expect(picked).toMatchObject({ model: "from-env" });
});

test("DRY_AI_MODEL naming a model the key lacks falls back to the house model", async () => {
  const provider = stubProvider(["house-model", "other"]);
  const picked = await resolveAiModel(provider, runtime());
  expect(picked).toMatchObject({ model: "house-model" });
});

test("an unset DRY_AI_MODEL falls back to the house model", async () => {
  const provider = stubProvider(["house-model", "other"]);
  const picked = await resolveAiModel(
    provider,
    runtime({ preferredModel: undefined }),
  );
  expect(picked).toMatchObject({ model: "house-model" });
});

test("with neither configured name available, the key's first model is the default", async () => {
  // What openai-compatible always hits: no house model exists for an arbitrary
  // endpoint, so the list is the only source of a name.
  const provider = stubProvider(["llama-3.3-70b", "llama-3.1-8b"]);
  const picked = await resolveAiModel(
    provider,
    runtime({
      provider: "openai-compatible",
      preferredModel: undefined,
      defaultModel: undefined,
      baseUrl: "https://api.groq.com/openai/v1",
    }),
  );
  expect(picked).toMatchObject({ model: "llama-3.3-70b" });
});

test("the client's pick beats DRY_AI_MODEL when the key can call it", async () => {
  const provider = stubProvider(["house-model", "from-env", "chosen"]);
  const picked = await resolveAiModel(provider, runtime(), "chosen");
  expect(picked).toMatchObject({ model: "chosen" });
});

test("a client asking for a model the key lacks is ignored, not obeyed", async () => {
  const provider = stubProvider(["house-model", "from-env"]);
  const picked = await resolveAiModel(
    provider,
    runtime(),
    "expensive-model-nobody-exposed",
  );
  expect(picked).toMatchObject({ model: "from-env" });
});

test("a non-string model in the body is ignored", async () => {
  const provider = stubProvider(["house-model", "from-env"]);
  const picked = await resolveAiModel(provider, runtime(), { evil: true });
  expect(picked).toMatchObject({ model: "from-env" });
});

test("resolving returns the list, so the picker has something to offer", async () => {
  const provider = stubProvider(["a", "b"]);
  const picked = await resolveAiModel(provider, runtime());
  expect(picked).toMatchObject({ models: [{ id: "a" }, { id: "b" }] });
});

test("an unreachable list still generates, off the configured model", async () => {
  // A provider whose /models is down, or a compatible endpoint that never
  // implemented it, must not take generation down with it.
  const provider = stubProvider(new Error("503 from provider"));
  const picked = await resolveAiModel(provider, runtime());
  expect(picked).toMatchObject({ model: "from-env" });
});

test("an unreachable list drops the client's pick rather than trusting it", async () => {
  // Nothing to validate against here, and an unverifiable name from the client
  // is exactly what validation exists to keep off the wire.
  const provider = stubProvider(new Error("503 from provider"));
  const picked = await resolveAiModel(provider, runtime(), "chosen");
  expect(picked).toMatchObject({ model: "from-env" });
});

test("an unreachable list with nothing configured is a config error", async () => {
  const provider = stubProvider(new Error("503 from provider"));
  const picked = await resolveAiModel(
    provider,
    runtime({ preferredModel: undefined, defaultModel: undefined }),
  );
  expect(picked).toMatchObject({ reason: "missing-model" });
});

test("the list is fetched once for a burst of requests", async () => {
  const provider = stubProvider(["from-env"]);
  await Promise.all([
    resolveAiModel(provider, runtime()),
    resolveAiModel(provider, runtime()),
  ]);
  await resolveAiModel(provider, runtime());
  expect(provider.calls).toBe(1);
});

test("a failed lookup isn't cached, so the next request retries", async () => {
  const provider = stubProvider(new Error("transient"));
  await resolveAiModel(provider, runtime());
  await resolveAiModel(provider, runtime());
  expect(provider.calls).toBe(2);
});

test("two keys on one provider don't share a list", async () => {
  const provider = stubProvider(["from-env"]);
  await resolveAiModel(provider, runtime({ apiKey: "sk-one" }));
  await resolveAiModel(provider, runtime({ apiKey: "sk-two" }));
  expect(provider.calls).toBe(2);
});
