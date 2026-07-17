/** @jest-environment node */
import { beforeEach, expect, test } from "@jest/globals";

import { fields } from "../../form/api";
import type { DrystackRequest } from "../internal-utils";
import { makeAiRouteHandler } from "./index";
import { clearModelCache } from "./model-registry";

// The picker offers what the provider's catalogue lists, and the catalogue lies
// (see model-registry.ts). When a user picks a model the provider then refuses,
// the request must still produce content: they chose from a list we handed them.

const schema = { title: fields.slug({ name: { label: "Tiêu đề" } }) };

const config = {
  storage: { kind: "local" },
  ai: { lang: "vi-VN", for: { blog: "một bài blog" } },
  collections: { blog: { label: "Blog", schema } },
} as any;

const env = {
  DRY_AI_PROVIDER: "google",
  DRY_AI_KEY: "k",
  DRY_AI_MODEL: "listed-but-dead",
};

/**
 * Stands in for Google: `dead` models 404 the way the real API does, everything
 * else streams. Records what actually got called.
 */
function fakeGoogle(dead: string[], listed: string[]) {
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const href = String(url);
    if (href.includes("/models?")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: listed.map((id) => ({
            name: `models/${id}`,
            supportedGenerationMethods: ["generateContent"],
          })),
        }),
      } as any;
    }
    const model = href.split("/models/")[1].split(":")[0];
    calls.push(model);
    if (dead.includes(model)) {
      return {
        ok: false,
        status: 404,
        text: async () =>
          JSON.stringify({
            error: {
              message: `This model models/${model} is no longer available to new users.`,
            },
          }),
      } as any;
    }
    return {
      ok: true,
      status: 200,
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(
            new TextEncoder().encode(
              'data: {"candidates":[{"content":{"parts":[{"text":"title: Xin chào"}]}}]}\n\n',
            ),
          );
          controller.close();
        },
      }),
    } as any;
  }) as any;
  return calls;
}

function request(body: unknown): DrystackRequest {
  return {
    method: "POST",
    url: "http://localhost/api/drystack/ai/generate",
    headers: { get: () => null },
    json: async () => body,
  };
}

const generateBody = {
  entry: { kind: "collection", key: "blog" },
  targets: ["title"],
  context: {},
  description: "x",
  size: "short",
};

const realFetch = globalThis.fetch;
beforeEach(() => {
  clearModelCache();
  globalThis.fetch = realFetch;
});

async function generate(body: unknown = generateBody) {
  const handler = makeAiRouteHandler({ config, env })!;
  return handler(request(body), ["ai", "generate"]);
}

test("a dead model is retried with the next candidate instead of erroring", async () => {
  const calls = fakeGoogle(["listed-but-dead"], ["listed-but-dead", "alive"]);
  const res = await generate();
  expect(res.status).toBe(200);
  expect(calls).toEqual(["listed-but-dead", "alive"]);
});

test("the dead model is remembered, so the next request goes straight to a live one", async () => {
  const calls = fakeGoogle(["listed-but-dead"], ["listed-but-dead", "alive"]);
  await generate();
  calls.length = 0;
  const res = await generate();
  expect(res.status).toBe(200);
  expect(calls).toEqual(["alive"]);
});

test("a dead model the user picked is retried too", async () => {
  const calls = fakeGoogle(["picked-dead"], ["picked-dead", "alive"]);
  const res = await generate({ ...generateBody, model: "picked-dead" });
  expect(res.status).toBe(200);
  expect(calls).toEqual(["picked-dead", "alive"]);
});

test("the dead model drops out of what ai/models offers", async () => {
  fakeGoogle(["listed-but-dead"], ["listed-but-dead", "alive"]);
  await generate();

  const handler = makeAiRouteHandler({ config, env })!;
  const res = await handler(
    { method: "GET", url: "u", headers: { get: () => null }, json: async () => ({}) },
    ["ai", "models"],
  );
  const body = JSON.parse(res.body as string);
  expect(body.models.map((m: any) => m.id)).toEqual(["alive"]);
  expect(body.selected).toBe("alive");
});

test("retrying gives up rather than walking the whole catalogue", async () => {
  // Once the listed models are exhausted DRY_AI_MODEL is the last candidate
  // standing, so even a total outage terminates: three attempts, one error, no
  // unbounded march through 24 models spending a request on each.
  const calls = fakeGoogle(["a", "b", "listed-but-dead"], ["a", "b"]);
  const res = await generate({ ...generateBody, model: "a" });
  expect(res.status).toBe(404);
  expect(calls).toEqual(["a", "b", "listed-but-dead"]);
});

test("a 429 is not treated as a dead model", async () => {
  // Quota is a reason to stop, not a reason to retire the model and walk the
  // list spending the same quota on every other one.
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    const href = String(url);
    if (href.includes("/models?")) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          models: ["quota-limited", "other"].map((id) => ({
            name: `models/${id}`,
            supportedGenerationMethods: ["generateContent"],
          })),
        }),
      } as any;
    }
    calls.push(href.split("/models/")[1].split(":")[0]);
    return {
      ok: false,
      status: 429,
      text: async () => JSON.stringify({ error: { message: "quota exceeded" } }),
    } as any;
  }) as any;

  const res = await generate({ ...generateBody, model: "quota-limited" });
  expect(res.status).toBe(429);
  expect(calls).toEqual(["quota-limited"]);
});
