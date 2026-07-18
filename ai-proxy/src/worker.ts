// Standalone Cloudflare Worker backing `storage.ai.url` (see
// packages/drystack/src/config.tsx's LocalStorageConfig.ai doc comment and
// packages/drystack/src/app/ai/ai-fetch.ts). A demo build is fully static -
// no `/api/*` - so the admin's Magic write / rewrite-selection call out here
// instead, on a separate origin, with no session in front of it.
//
// Deliberately not a copy of packages/drystack/src/api/ai/index.ts: that
// route serves an authenticated admin (any collection, any provider, model
// listing, dead-model retry). This one serves the public internet, so it's
// pared down to exactly what config.tsx promises callers: `POST /generate`
// and `POST /rewrite`, streamed, rate-limited per IP. It reuses the prompt-
// building and schema-describing logic from @drystack/core (the parts that
// decide *what* to ask the model) and talks to Anthropic directly for the
// streaming call itself (the *how*) - the multi-provider adapter/model-
// registry machinery in @drystack/core's ai/ folder exists for the admin's
// "pick any configured provider" needs, which a single-provider public demo
// proxy doesn't have.
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
import type { ComponentSchema } from "@drystack/core";

import config from "../../drystack.config";

export interface Env {
  DRY_AI_KEY: string;
  DRY_AI_MODEL?: string;
  ALLOWED_ORIGINS?: string;
  AI_PROXY_RL: { limit(opts: { key: string }): Promise<{ success: boolean }> };
}

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

    if (!env.DRY_AI_KEY) {
      return json({ error: "DRY_AI_KEY chưa được cấu hình." }, 503, origin);
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
      typeof body.model === "string" && body.model.trim()
        ? body.model.trim()
        : env.DRY_AI_MODEL;
    if (!model) {
      return json({ error: "Thiếu `model` và không có DRY_AI_MODEL mặc định." }, 503, origin);
    }

    try {
      if (url.pathname === "/generate") {
        return await handleGenerate(body, pre, model, env.DRY_AI_KEY, origin);
      }
      return await handleRewrite(body, pre, model, env.DRY_AI_KEY, origin);
    } catch (err) {
      const status = err instanceof AnthropicError ? err.status : 502;
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
 * this route at all; the provider is always Anthropic).
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

  return stream(system, user, maxTokens, model, apiKey, origin);
}

async function handleRewrite(
  body: any,
  pre: Preflight,
  model: string,
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

  return stream(system, user, maxTokens, model, apiKey, origin);
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

// --- Anthropic streaming call --------------------------------------------

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_API_VERSION = "2023-06-01";

class AnthropicError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

async function stream(
  system: string,
  user: string,
  maxTokens: number,
  model: string,
  apiKey: string,
  origin: string | null,
): Promise<Response> {
  const res = await fetch(ANTHROPIC_API_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_API_VERSION,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      stream: true,
      system,
      messages: [{ role: "user", content: user }],
    }),
  });

  if (!res.ok || !res.body) {
    throw new AnthropicError(await describeError(res), res.status);
  }

  return new Response(res.body.pipeThrough(sseToTextDeltas()), {
    status: 200,
    headers: {
      ...corsHeaders(origin),
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** Anthropic's SSE envelope -> the plain text deltas the client parses. */
function sseToTextDeltas(): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const data = line.slice("data: ".length);
        let event: any;
        try {
          event = JSON.parse(data);
        } catch {
          continue;
        }
        if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
          controller.enqueue(encoder.encode(event.delta.text as string));
        }
        // A mid-stream failure arrives as an `error` event on a 200 envelope -
        // nothing more can be done for this request but stop, the client
        // already has whatever text streamed before it.
        if (event.type === "error") controller.terminate();
      }
    },
  });
}

async function describeError(res: Response): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const parsed = JSON.parse(text);
      detail = parsed.error?.message ?? parsed.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    // Body already consumed or unreadable - the status alone still tells the
    // caller enough to act on.
  }
  return `Anthropic trả lỗi ${res.status}${detail ? `: ${detail.slice(0, 500)}` : ""}`;
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
