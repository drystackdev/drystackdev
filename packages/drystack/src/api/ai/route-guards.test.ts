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

function makeConfig(storageKind: "local" | "github") {
  return {
    storage:
      storageKind === "github"
        ? { kind: "github", repo: { owner: "o", name: "n" } }
        : { kind: "local" },
    ai: { lang: "vi-VN", for: { blog: "một bài blog" } },
    collections: { blog: { label: "Blog", schema } },
  } as any;
}

function request(body: unknown, cookie?: string): DrystackRequest {
  return {
    method: "POST",
    url: "http://localhost/api/drystack/ai/rewrite",
    headers: { get: (name) => (name === "cookie" ? (cookie ?? null) : null) },
    json: async () => body,
  };
}

async function call(
  storageKind: "local" | "github",
  path: string,
  body: unknown,
  cookie?: string,
): Promise<DrystackResponse> {
  const handler = makeAiRouteHandler({ config: makeConfig(storageKind), env })!;
  return handler(request(body, cookie), path.split("/"));
}

const rewriteBody = {
  entry: { kind: "collection", key: "blog" },
  field: "body",
  selection: "<p>Đoạn gốc.</p>",
  description: "ngắn hơn",
};

test("github mode rejects a rewrite with no session, before touching config", async () => {
  // Without this the route is an open, unauthenticated proxy to a paid AI
  // account: in github mode the admin UI is deployed publicly.
  const res = await call("github", "ai/rewrite", rewriteBody);
  expect(res.status).toBe(401);
});

test("github mode rejects a generate with no session too", async () => {
  const res = await call("github", "ai/generate", {
    entry: { kind: "collection", key: "blog" },
    targets: ["body"],
    sizes: { body: "medium" },
  });
  expect(res.status).toBe(401);
});

// A cookie is caller-supplied, so its presence proves nothing: these pin down
// that the token behind it is actually put to GitHub. Without the check, any
// visitor to a public github-mode deploy could set the cookie by hand and
// spend the site owner's AI key.
async function withStubbedFetch<T>(
  ok: boolean,
  body: () => Promise<T>,
): Promise<{ result: T; calls: string[] }> {
  const real = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (url: any) => {
    calls.push(String(url));
    return { ok } as Response;
  }) as typeof fetch;
  try {
    return { result: await body(), calls };
  } finally {
    globalThis.fetch = real;
  }
}

test("github mode rejects a forged session cookie", async () => {
  const { result, calls } = await withStubbedFetch(false, () =>
    call("github", "ai/generate", {
      entry: { kind: "collection", key: "blog" },
      targets: ["body"],
      sizes: { body: "medium" },
    }, "drystack-gh-access-token=forged"),
  );
  expect(result.status).toBe(401);
  // Verified against the repo, not just /user: a real token for someone
  // else's account must not open this route either.
  expect(calls).toEqual(["https://api.github.com/repos/o/n"]);
});

test("github mode lets a verified session past the guard", async () => {
  // Uses an entry that never opted into ai.for, so the request stops at the
  // *next* guard (403). Proves the session check passed without letting the
  // test reach a real provider.
  const { result } = await withStubbedFetch(true, () =>
    call("github", "ai/generate", {
      entry: { kind: "collection", key: "notListed" },
      targets: ["body"],
    }, "drystack-gh-access-token=real"),
  );
  expect(result.status).toBe(403);
});

test("rewrite refuses an entry that never opted into ai.for", async () => {
  const res = await call("local", "ai/rewrite", {
    ...rewriteBody,
    entry: { kind: "collection", key: "notListed" },
  });
  expect(res.status).toBe(403);
});

test("rewrite refuses a field that isn't a content field", async () => {
  const res = await call("local", "ai/rewrite", { ...rewriteBody, field: "title" });
  expect(res.status).toBe(400);
});

test("rewrite refuses a field that isn't in the schema at all", async () => {
  const res = await call("local", "ai/rewrite", { ...rewriteBody, field: "nope" });
  expect(res.status).toBe(400);
});

test("rewrite refuses an empty selection", async () => {
  const res = await call("local", "ai/rewrite", { ...rewriteBody, selection: "   " });
  expect(res.status).toBe(400);
});

test("rewrite refuses a missing entry", async () => {
  const res = await call("local", "ai/rewrite", { ...rewriteBody, entry: undefined });
  expect(res.status).toBe(400);
});

test("unknown ai subpaths still 404", async () => {
  const res = await call("local", "ai/nonsense", {});
  expect(res.status).toBe(404);
});

test("no ai block in config means the routes don't exist", () => {
  const config = makeConfig("local");
  delete config.ai;
  expect(makeAiRouteHandler({ config, env })).toBeUndefined();
});
