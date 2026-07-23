/** @jest-environment node */
import { expect, test } from "@jest/globals";

import { fields } from "../../form/api";
import type { DrystackRequest, DrystackResponse } from "../internal-utils";
import { makeAiRouteHandler } from "./index";

// The guards both routes share live in one `preflight` now. These pin down
// that sharing it didn't quietly widen what either route lets through - a
// rewrite request must clear exactly the same bar a generate request does.

const schema = {
  title: fields.slug({ name: { label: "Tiêu đề" } }),
  body: fields.content({ label: "Nội dung" }),
};

const env = {
  DRY_AI_PROVIDER: "anthropic",
  DRY_AI_KEY: "sk-test",
  DRY_AI_MODEL: "claude-sonnet-5",
};

function makeConfig() {
  return {
    storage: { kind: "demo" },
    ai: { lang: "vi-VN", for: { blog: "một bài blog" } },
    collections: { blog: { label: "Blog", schema } },
  } as any;
}

function request(body: unknown): DrystackRequest {
  return {
    method: "POST",
    url: "http://localhost/api/drystack/ai/rewrite",
    headers: { get: () => null },
    json: async () => body,
  };
}

async function call(path: string, body: unknown): Promise<DrystackResponse> {
  const handler = makeAiRouteHandler({ config: makeConfig(), env })!;
  return handler(request(body), path.split("/"));
}

const rewriteBody = {
  entry: { kind: "collection", key: "blog" },
  field: "body",
  selection: "<p>Đoạn gốc.</p>",
  description: "ngắn hơn",
};

test("rewrite refuses an entry that never opted into ai.for", async () => {
  const res = await call("ai/rewrite", {
    ...rewriteBody,
    entry: { kind: "collection", key: "notListed" },
  });
  expect(res.status).toBe(403);
});

test("rewrite refuses a field that isn't a content field", async () => {
  const res = await call("ai/rewrite", { ...rewriteBody, field: "title" });
  expect(res.status).toBe(400);
});

test("rewrite refuses a field that isn't in the schema at all", async () => {
  const res = await call("ai/rewrite", { ...rewriteBody, field: "nope" });
  expect(res.status).toBe(400);
});

test("rewrite refuses an empty selection", async () => {
  const res = await call("ai/rewrite", { ...rewriteBody, selection: "   " });
  expect(res.status).toBe(400);
});

test("rewrite refuses a missing entry", async () => {
  const res = await call("ai/rewrite", { ...rewriteBody, entry: undefined });
  expect(res.status).toBe(400);
});

test("unknown ai subpaths still 404", async () => {
  const res = await call("ai/nonsense", {});
  expect(res.status).toBe(404);
});

test("no ai block in config means the routes don't exist", () => {
  const config = makeConfig();
  delete config.ai;
  expect(makeAiRouteHandler({ config, env })).toBeUndefined();
});
