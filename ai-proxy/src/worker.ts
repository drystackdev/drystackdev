// Standalone Cloudflare Worker backing `DRYSTACK_AI_URL` (see
// packages/drystack/src/app/ai/demo-ai-env.ts and
// packages/drystack/src/app/ai/ai-fetch.ts). A demo build is fully static -
// no `/api/*` - so the admin's Magic write / rewrite-selection call out here
// instead, on a separate origin, with no session in front of it.
//
// Deliberately not a copy of packages/drystack/src/api/ai/index.ts: that
// route serves an authenticated admin (model listing, dead-model retry,
// per-request provider override). This one serves the public internet, so
// it's pared down to exactly what config.tsx promises callers: `POST
// /generate` and `POST /rewrite`, streamed, rate-limited per IP, one
// provider fixed by env for the whole deployment (DRY_AI_PROVIDER). It
// reuses @drystack/core's env resolution (`api/ai/env`) and provider
// adapters (`api/ai/providers/*`) - both are already fetch/streams-only with
// no Node builtins, so they run on Workers unchanged - rather than the
// model-registry machinery, which exists for the admin's "pick any
// configured provider at request time" need that a single fixed-provider
// public proxy doesn't have.
import {
  describeField,
  describeFields,
  type AiFieldSpec,
} from "@drystack/core/api/ai/schema";
import {
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  generateMaxTokens,
  isAiSize,
  rewriteMaxTokens,
  type AiSizeMap,
} from "@drystack/core/api/ai/prompt";
import { isAiConfigError, resolveAiEnv, type AiEnv } from "@drystack/core/api/ai/env";
import { anthropicProvider } from "@drystack/core/api/ai/providers/anthropic";
import { googleProvider } from "@drystack/core/api/ai/providers/google";
import { AiProviderError, type AiProvider } from "@drystack/core/api/ai/providers/types";
import type { ComponentSchema } from "@drystack/core";

import config from "../../drystack.config";

export interface Env extends AiEnv {
  ALLOWED_ORIGINS?: string;
  AI_PROXY_RL: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

// Only the two providers @drystack.dev actually runs behind this proxy today
// - openai/openai-compatible are valid `DRY_AI_PROVIDER` values elsewhere in
// the codebase but have no adapter wired here yet.
const PROVIDERS: Partial<Record<string, AiProvider>> = {
  anthropic: anthropicProvider,
  google: googleProvider,
};

// Same ceiling as the admin route (see index.ts) - a runaway field shouldn't
// blow the request budget on its own.
const MAX_TEXT_CHARS = 20_000;

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const origin = corsOrigin(req, env);

    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (url.pathname !== "/generate" && url.pathname !== "/rewrite") {
      return json({ error: "Not Found" }, 404, origin);
    }
    if (req.method !== "POST") {
      return json({ error: "Method Not Allowed" }, 405, origin);
    }

    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const { success } = await env.AI_PROXY_RL.limit({ key: ip });
    if (!success) {
      return json({ error: "Quá nhiều yêu cầu, thử lại sau." }, 429, origin);
    }

    const runtime = resolveAiEnv(env);
    if (isAiConfigError(runtime)) {
      return json({ error: runtime.message }, 503, origin);
    }
    const provider = PROVIDERS[runtime.provider];
    if (!provider) {
      return json(
        { error: `Provider "${runtime.provider}" chưa được hỗ trợ trên proxy này.` },
        503,
        origin,
      );
    }

    let body: any;
    try {
      body = await req.json();
    } catch {
      return json({ error: "Body không phải JSON hợp lệ." }, 400, origin);
    }

    const pre = preflight(body);
    if ("error" in pre) return json({ error: pre.error }, pre.status, origin);

    const model =
      (typeof body.model === "string" && body.model.trim()) ||
      runtime.preferredModel ||
      runtime.defaultModel;
    if (!model) {
      return json({ error: "Không xác định được model để gọi." }, 503, origin);
    }

    try {
      if (url.pathname === "/generate") {
        return await handleGenerate(body, pre, model, provider, runtime.apiKey, origin);
      }
      return await handleRewrite(body, pre, model, provider, runtime.apiKey, origin);
    } catch (err) {
      const status = err instanceof AiProviderError ? err.status : 502;
      return json(
        { error: err instanceof Error ? err.message : "Lỗi không xác định." },
        status === 401 || status === 403 ? 502 : status,
        origin,
      );
    }
  },
};

type Preflight = {
  entryDescription: string;
  schema: Record<string, ComponentSchema>;
  lang: string;
};

/**
 * Everything both routes need before they can differ: that the entry exists
 * and is opted into `config.ai.for`. Mirrors index.ts's `preflight`, minus
 * the session/provider checks that don't apply here (no session in front of
 * this route at all; the provider is fixed for the whole deployment by
 * `DRY_AI_PROVIDER`, not chosen per request).
 */
function preflight(body: any): Preflight | { error: string; status: number } {
  const { entry } = body ?? {};
  if (!entry?.kind || !entry?.key) {
    return { error: "Thiếu `entry`.", status: 400 };
  }

  const forMap = config.ai?.for as Record<string, string> | undefined;
  const entryDescription = forMap?.[entry.key];
  if (!entryDescription) {
    return {
      error: `"${entry.key}" chưa được bật AI trong config.ai.for.`,
      status: 403,
    };
  }

  const schema =
    entry.kind === "collection"
      ? config.collections?.[entry.key]?.schema
      : entry.kind === "singleton"
        ? config.singletons?.[entry.key]?.schema
        : undefined;
  if (!schema) {
    return { error: `Không tìm thấy "${entry.key}".`, status: 404 };
  }

  return {
    entryDescription,
    schema: schema as Record<string, ComponentSchema>,
    lang: config.ai?.lang ?? "vi-VN",
  };
}

async function handleGenerate(
  body: any,
  pre: Preflight,
  model: string,
  provider: AiProvider,
  apiKey: string,
  origin: string | null,
): Promise<Response> {
  const { entryDescription, schema, lang } = pre;

  const requestedKeys: string[] = Array.isArray(body.targets)
    ? body.targets.filter((k: unknown) => typeof k === "string")
    : [];
  const allSpecs = describeFields(schema);
  const targets = allSpecs.filter((spec) => requestedKeys.includes(spec.key));
  if (!targets.length) {
    return json({ error: "Không có field nào hợp lệ để điền." }, 400, origin);
  }

  const sizes = resolveSizes(body.sizes, targets);
  if (!sizes) return json({ error: "`sizes` không hợp lệ." }, 400, origin);

  const seeds = sanitiseSeeds(body.seeds, targets);
  const seedChars = Object.values(seeds).reduce((n, s) => n + s.length, 0);

  const system = buildSystemPrompt({
    lang,
    entryDescription,
    targets,
    sizes,
    seedKeys: Object.keys(seeds),
  });
  const user = buildUserPrompt({
    context: sanitiseContext(body.context),
    description: typeof body.description === "string" ? body.description : "",
    seeds,
  });
  const maxTokens = generateMaxTokens({ sizes, seedChars });

  return stream(provider, apiKey, system, user, maxTokens, model, origin);
}

async function handleRewrite(
  body: any,
  pre: Preflight,
  model: string,
  provider: AiProvider,
  apiKey: string,
  origin: string | null,
): Promise<Response> {
  const { entryDescription, schema, lang } = pre;

  const { field, selection } = body;
  if (typeof field !== "string" || !schema[field]) {
    return json({ error: "Thiếu `field` hợp lệ." }, 400, origin);
  }
  if (typeof selection !== "string" || !selection.trim()) {
    return json({ error: "Thiếu `selection`." }, 400, origin);
  }

  const spec: AiFieldSpec | undefined = describeField(field, schema[field]);
  if (!spec || spec.kind !== "content") {
    return json({ error: `"${field}" không phải field nội dung.` }, 400, origin);
  }

  const passage = selection.slice(0, MAX_TEXT_CHARS);

  const system = buildRewriteSystemPrompt({
    lang,
    entryDescription,
    htmlTags: spec.htmlTags ?? [],
  });
  const user = buildRewriteUserPrompt({
    context: sanitiseContext(body.context),
    selection: passage,
    description: typeof body.description === "string" ? body.description : "",
  });
  const maxTokens = rewriteMaxTokens(passage.length);

  return stream(provider, apiKey, system, user, maxTokens, model, origin);
}

function resolveSizes(raw: unknown, targets: AiFieldSpec[]): AiSizeMap | undefined {
  const given: Record<string, unknown> =
    raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  for (const value of Object.values(given)) {
    if (!isAiSize(value)) return undefined;
  }
  const out: AiSizeMap = {};
  for (const target of targets) {
    if (target.kind !== "content") continue;
    const size = given[target.key];
    out[target.key] = isAiSize(size) ? size : "medium";
  }
  return out;
}

function sanitiseSeeds(raw: unknown, targets: AiFieldSpec[]): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const continuable = new Set(
    targets.filter((t) => t.kind === "array" || t.kind === "object").map((t) => t.key),
  );
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!continuable.has(key)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    out[key] = value.slice(0, MAX_TEXT_CHARS);
  }
  return out;
}

function sanitiseContext(context: unknown): Record<string, string> {
  if (!context || typeof context !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(context as Record<string, unknown>)) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.slice(0, MAX_TEXT_CHARS);
    }
  }
  return out;
}

// --- provider streaming call ----------------------------------------------

/**
 * Runs the configured provider's own `stream()` (already unwrapped from its
 * SSE envelope into plain text deltas by @drystack/core's adapter - see
 * providers/types.ts's `textStreamFromSse`) and re-encodes it as the
 * `text/plain` byte stream the client reads chunk by chunk.
 */
async function stream(
  provider: AiProvider,
  apiKey: string,
  system: string,
  user: string,
  maxTokens: number,
  model: string,
  origin: string | null,
): Promise<Response> {
  const textStream = await provider.stream({
    apiKey,
    model,
    system,
    user,
    maxTokens,
    signal: new AbortController().signal,
  });

  const encoder = new TextEncoder();
  const body = textStream.pipeThrough(
    new TransformStream<string, Uint8Array>({
      transform(chunk, controller) {
        controller.enqueue(encoder.encode(chunk));
      },
    }),
  );

  return new Response(body, {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

// --- CORS -------------------------------------------------------------

function corsOrigin(req: Request, env: Env): string | null {
  const requestOrigin = req.headers.get("origin");
  const allowed = env.ALLOWED_ORIGINS?.split(",").map((s) => s.trim()).filter(Boolean);
  if (!allowed || !allowed.length) return requestOrigin ?? "*";
  return requestOrigin && allowed.includes(requestOrigin) ? requestOrigin : null;
}

function corsHeaders(origin: string | null): HeadersInit {
  if (!origin) return {};
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-methods": "POST, OPTIONS",
    "access-control-allow-headers": "content-type",
    vary: "origin",
  };
}

function json(body: unknown, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), "content-type": "application/json" },
  });
}
