import type { Config } from "../..";
import type { ComponentSchema } from "../../form/api";
import type { DrystackRequest, DrystackResponse } from "../internal-utils";
import type { D1DatabaseLike } from "../d1";
import type { R2BucketLike } from "../api-r2";
import { verifiedSession } from "../api-r2";
import {
  collectionPermission,
  hasPermission,
  singletonPermission,
} from "../permissions";
import {
  AiConfigError,
  AiEnv,
  AiRuntimeConfig,
  isAiConfigError,
  resolveAiEnv,
} from "./env";
import {
  isModelGone,
  markModelUnusable,
  probeModel,
  resolveAiModel,
} from "./model-registry";
import {
  AiSizeMap,
  buildRewriteSystemPrompt,
  buildRewriteUserPrompt,
  buildSystemPrompt,
  buildUserPrompt,
  generateMaxTokens,
  isAiSize,
  rewriteMaxTokens,
} from "./prompt";
import { anthropicProvider } from "./providers/anthropic";
import { googleProvider } from "./providers/google";
import { openaiProvider } from "./providers/openai";
import { AiProvider, AiProviderError, AiStreamArgs } from "./providers/types";
import { AiFieldSpec, describeField, describeFields } from "./schema-to-yaml";

// A runaway field shouldn't blow the request budget on its own. Long context
// is fine; this is a ceiling, not a target.
const MAX_TEXT_CHARS = 20_000;

const PROVIDERS: Record<string, AiProvider> = {
  anthropic: anthropicProvider,
  openai: openaiProvider,
  // Same wire format as OpenAI; only the base URL and model differ.
  "openai-compatible": openaiProvider,
  google: googleProvider,
};

export type AiRouteConfig = {
  config: Config<any, any>;
  env: AiEnv;
  // Only consulted when config.storage.kind === 'r2' (see
  // requireMagicWriterPermission below) - undefined for demo, which has no
  // per-collection permission model (and no API routes at all).
  r2Bucket?: R2BucketLike;
  d1Database?: D1DatabaseLike;
  secret?: string;
};

function json(body: unknown, status = 200): DrystackResponse {
  return {
    status,
    body: JSON.stringify(body),
    headers: [["content-type", "application/json"]],
  };
}

function entrySchema(
  config: Config<any, any>,
  kind: string,
  key: string,
): Record<string, ComponentSchema> | undefined {
  if (kind === "collection") return config.collections?.[key]?.schema;
  if (kind === "singleton") return config.singletons?.[key]?.schema;
  return undefined;
}

/**
 * Whether this entry is opted into AI generation. The client decides whether
 * to *show* the button from the same config, but that's a UI affordance -
 * this is the check that matters, since a request can be hand-crafted.
 */
function aiDescriptionFor(
  config: Config<any, any>,
  key: string,
): string | undefined {
  const forMap = config.ai?.for as Record<string, string> | undefined;
  return forMap?.[key];
}

export function makeAiRouteHandler(routeConfig: AiRouteConfig) {
  const { config } = routeConfig;
  // No `ai` block means the feature was never turned on: every route 404s, as
  // though it didn't exist.
  if (!config.ai) return undefined;

  const resolved = resolveAiEnv(routeConfig.env);

  return async function aiRoute(
    req: DrystackRequest,
    params: string[],
  ): Promise<DrystackResponse> {
    const joined = params.join("/");

    if (joined === "ai/status" && req.method === "GET") {
      return handleStatus(resolved);
    }
    if (joined === "ai/models" && req.method === "GET") {
      return handleModels(req, config, resolved);
    }
    if (joined === "ai/models/verify" && req.method === "POST") {
      return handleVerifyModel(req, config, resolved);
    }
    if (joined === "ai/generate" && req.method === "POST") {
      return handleGenerate(req, config, resolved, routeConfig);
    }
    if (joined === "ai/rewrite" && req.method === "POST") {
      return handleRewrite(req, config, resolved, routeConfig);
    }
    return { status: 404, body: "Not Found" };
  };
}

function handleStatus(
  resolved: AiRuntimeConfig | AiConfigError,
): DrystackResponse {
  if (isAiConfigError(resolved)) {
    return json({
      configured: false,
      reason: resolved.reason,
      message: resolved.message,
      params: resolved.params,
    });
  }
  // Never echoes the key - only that one is present, and what it points at.
  return json({
    configured: true,
    provider: resolved.provider,
    // The configured preference, not a promise: which model a request calls is
    // settled against the key's own list when the request is made. Answering
    // that here would mean a provider round-trip on every admin page load.
    model: resolved.preferredModel ?? resolved.defaultModel,
  });
}

/**
 * r2 mode's per-collection `magicWriter` permission (plan/user-managent.md
 * mục 5) - r2 mode's "is there any session at all" gate already ran in
 * generic.ts, before this handler was even reached; this is the
 * finer-grained "does *this* collection/singleton allow AI generation for
 * *this* session's roles" check on top of that). No-op for demo, which has
 * no permission model to consult.
 */
async function requireMagicWriterPermission(
  req: DrystackRequest,
  config: Config<any, any>,
  routeConfig: AiRouteConfig,
  entryKind: "collection" | "singleton",
  entryKey: string,
): Promise<DrystackResponse | undefined> {
  if (config.storage.kind !== "r2") return undefined;
  const { r2Bucket, d1Database, secret } = routeConfig;
  if (!r2Bucket || !d1Database || !secret) {
    return json({ error: "Thiếu cấu hình R2/D1 cho storage kind r2." }, 500);
  }
  const session = await verifiedSession(req, r2Bucket, d1Database, secret);
  if (!session) return json({ error: "Chưa đăng nhập." }, 401);
  const permission =
    entryKind === "collection"
      ? collectionPermission(entryKey, "magicWriter")
      : singletonPermission(entryKey, "magicWriter");
  if (!hasPermission(session.roles, permission)) {
    return json({ error: "Không đủ quyền Magic Write cho mục này." }, 403);
  }
  return undefined;
}

/**
 * The models this key can call, and which of them a request would use if it
 * asked for nothing. Behind the session guard like the routes that spend the
 * key: it costs a provider round-trip, and what an account has access to isn't
 * an anonymous caller's business.
 */
async function handleModels(
  req: DrystackRequest,
  config: Config<any, any>,
  resolved: AiRuntimeConfig | AiConfigError,
): Promise<DrystackResponse> {
  if (isAiConfigError(resolved)) {
    return json(
      { error: resolved.message, reason: resolved.reason, params: resolved.params },
      503,
    );
  }
  const provider = PROVIDERS[resolved.provider];
  if (!provider) {
    return json({ error: `Provider "${resolved.provider}" chưa hỗ trợ.` }, 500);
  }

  const picked = await resolveAiModel(provider, resolved);
  if (isAiConfigError(picked)) {
    return json(
      { error: picked.message, reason: picked.reason, params: picked.params },
      503,
    );
  }
  // `models: []` with an `error` is a real answer, not a failure: generation
  // still works off the configured name, there's just nothing to choose from.
  return json({
    provider: resolved.provider,
    selected: picked.model,
    models: picked.models,
    error: picked.listError,
  });
}

/**
 * Answers whether one model actually works, by trying it.
 *
 * Exists because a model's presence on the list is not a promise it can be
 * called (see `model-registry.ts`), and finding that out at generate time means
 * the user loses a write to it. One token spent here at pick time is cheaper
 * than that, and the failure teaches the registry - a model proven gone is
 * dropped from the list for everyone on this key.
 */
async function handleVerifyModel(
  req: DrystackRequest,
  config: Config<any, any>,
  resolved: AiRuntimeConfig | AiConfigError,
): Promise<DrystackResponse> {
  if (isAiConfigError(resolved)) {
    return json(
      { error: resolved.message, reason: resolved.reason, params: resolved.params },
      503,
    );
  }
  const provider = PROVIDERS[resolved.provider];
  if (!provider) {
    return json({ error: `Provider "${resolved.provider}" chưa hỗ trợ.` }, 500);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body không phải JSON hợp lệ." }, 400);
  }
  const model = typeof body?.model === "string" ? body.model.trim() : "";
  if (!model) return json({ error: "Thiếu `model`." }, 400);

  // Only a model the key actually lists may be probed. Without this the route
  // would spray arbitrary caller-supplied names at the provider on request.
  const picked = await resolveAiModel(provider, resolved, model);
  if (isAiConfigError(picked)) {
    return json(
      { error: picked.message, reason: picked.reason, params: picked.params },
      503,
    );
  }
  if (picked.model !== model) {
    return json({
      ok: false,
      reason: "gone",
      message: `${model} không nằm trong danh sách model của key này.`,
    });
  }

  return json(await probeModel(provider, resolved, model));
}

type Preflight = {
  body: any;
  entryDescription: string;
  schema: Record<string, ComponentSchema>;
  provider: AiProvider;
  runtime: AiRuntimeConfig;
  lang: string;
};

/**
 * Everything both generation routes must establish before they can differ:
 * that the caller may ask, that the feature is configured, that the entry
 * exists and is opted in, and that the configured provider is one we have an
 * adapter for. Returns a response to send as-is, or the facts to carry on with.
 */
async function preflight(
  req: DrystackRequest,
  config: Config<any, any>,
  resolved: AiRuntimeConfig | AiConfigError,
  routeConfig: AiRouteConfig,
): Promise<DrystackResponse | Preflight> {
  // Authentication is checked before anything else, config included:
  // answering config questions first would tell an anonymous caller whether a
  // key is present, which is nobody's business but the signed-in user's.
  if (isAiConfigError(resolved)) {
    return json(
      {
        error: resolved.message,
        reason: resolved.reason,
        params: resolved.params,
      },
      503,
    );
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body không phải JSON hợp lệ." }, 400);
  }

  const { entry } = body ?? {};
  if (!entry?.kind || !entry?.key) {
    return json({ error: "Thiếu `entry`." }, 400);
  }

  const entryDescription = aiDescriptionFor(config, entry.key);
  if (!entryDescription) {
    return json(
      { error: `"${entry.key}" chưa được bật AI trong config.ai.for.` },
      403,
    );
  }

  const schema = entrySchema(config, entry.kind, entry.key);
  if (!schema) {
    return json({ error: `Không tìm thấy "${entry.key}".` }, 404);
  }

  const permissionDenied = await requireMagicWriterPermission(
    req,
    config,
    routeConfig,
    entry.kind,
    entry.key,
  );
  if (permissionDenied) return permissionDenied;

  const provider = PROVIDERS[resolved.provider];
  if (!provider) {
    return json({ error: `Provider "${resolved.provider}" chưa hỗ trợ.` }, 500);
  }

  return {
    body,
    entryDescription,
    schema,
    provider,
    runtime: resolved,
    lang: config.ai?.lang ?? config.locale ?? "vi-VN",
  };
}

function isPreflightResponse(
  value: DrystackResponse | Preflight,
): value is DrystackResponse {
  return "status" in value;
}

// Two dead models in a row on one request is already a stretch; past that,
// something other than model availability is wrong and retrying only spends
// time. Marks persist, so the next request resumes converging where this left
// off rather than starting over.
const MAX_MODEL_ATTEMPTS = 3;

/**
 * Runs the request and hands the model's tokens straight to the client. Both
 * routes stream the same way; only what's in the prompt differs.
 *
 * Settling on a model is the last thing to happen before the wire, deliberately:
 * it can cost a round-trip to the provider, which a request that was going to be
 * rejected anyway shouldn't pay for.
 *
 * A model that the listing offered but the provider then refuses is retried
 * rather than reported: the user picked from a list we gave them, so an error
 * saying that choice was invalid blames them for our bad information. The dead
 * model is recorded on the way past, which is what eventually takes it out of
 * the list (see `markModelUnusable`).
 */
async function streamResponse(
  provider: AiProvider,
  runtime: AiRuntimeConfig,
  /**
   * The model the client asked for. A request rather than an instruction:
   * honoured only if the key can actually call it, so a hand-crafted call can't
   * spend the key on a model the admin never exposed.
   */
  requestedModel: unknown,
  args: Pick<AiStreamArgs, "system" | "user" | "maxTokens">,
): Promise<DrystackResponse> {
  const tried: string[] = [];
  let lastError: unknown;

  for (let attempt = 0; attempt < MAX_MODEL_ATTEMPTS; attempt++) {
    const picked = await resolveAiModel(provider, runtime, requestedModel);
    if (isAiConfigError(picked)) {
      return json(
        { error: picked.message, reason: picked.reason, params: picked.params },
        503,
      );
    }
    // Resolution is deterministic, so the same answer twice means marking the
    // last one dead moved nothing: there's no fallback left to try.
    if (tried.includes(picked.model)) break;
    tried.push(picked.model);

    const controller = new AbortController();
    try {
      const textStream = await provider.stream({
        ...args,
        apiKey: runtime.apiKey,
        model: picked.model,
        baseUrl: runtime.baseUrl,
        signal: controller.signal,
      });

      return {
        status: 200,
        headers: [
          ["content-type", "text/plain; charset=utf-8"],
          ["cache-control", "no-cache, no-transform"],
          // Tells nginx-style proxies not to buffer the response - without it
          // the whole point of streaming is lost behind the proxy.
          ["x-accel-buffering", "no"],
        ],
        body: textStream.pipeThrough(new TextEncoderStream()),
      };
    } catch (err) {
      lastError = err;
      // Safe to retry: `stream` throws on the response status, before it hands
      // back a stream, so nothing has reached the client yet.
      if (
        err instanceof AiProviderError &&
        isModelGone(err.status, err.message, picked.model)
      ) {
        markModelUnusable(runtime, picked.model);
        continue;
      }
      break;
    }
  }

  const status = lastError instanceof AiProviderError ? lastError.status : 502;
  return json(
    {
      error:
        lastError instanceof Error ? lastError.message : "Lỗi không xác định.",
    },
    // A provider 401 means *our* key is bad, not that the caller is
    // unauthorised - remapping avoids the admin UI treating it as a
    // session problem and bouncing the user to log in again.
    status === 401 || status === 403 ? 502 : status,
  );
}

async function handleGenerate(
  req: DrystackRequest,
  config: Config<any, any>,
  resolved: AiRuntimeConfig | AiConfigError,
  routeConfig: AiRouteConfig,
): Promise<DrystackResponse> {
  const pre = await preflight(req, config, resolved, routeConfig);
  if (isPreflightResponse(pre)) return pre;
  const { body, entryDescription, schema, provider, runtime, lang } = pre;

  const { context, description } = body;

  // The client sends which keys to fill; the specs themselves are rebuilt from
  // the server's own schema, so a tampered request can't describe a field that
  // doesn't exist or smuggle extra instructions into the prompt.
  const requestedKeys: string[] = Array.isArray(body.targets)
    ? body.targets.filter((k: unknown) => typeof k === "string")
    : [];
  const allSpecs = describeFields(schema);
  const targets = allSpecs.filter((spec) => requestedKeys.includes(spec.key));
  if (!targets.length) {
    return json({ error: "Không có field nào hợp lệ để điền." }, 400);
  }

  const sizes = resolveSizes(body.sizes, targets);
  if (!sizes) return json({ error: "`sizes` không hợp lệ." }, 400);

  const seeds = sanitiseSeeds(body.seeds, targets);
  const seedChars = Object.values(seeds).reduce((n, s) => n + s.length, 0);

  return streamResponse(provider, runtime, body.model, {
    system: buildSystemPrompt({
      lang,
      entryDescription,
      targets,
      sizes,
      seedKeys: Object.keys(seeds),
    }),
    user: buildUserPrompt({
      context: sanitiseContext(context),
      description: sanitiseText(description),
      seeds,
    }),
    maxTokens: generateMaxTokens({ sizes, seedChars }),
  });
}

/**
 * The length to write each content target at.
 *
 * Only content targets get an entry - a size on anything else is meaningless,
 * and letting one through would put a stray "độ dài" on a select field in the
 * prompt. A content target the client said nothing about falls back to the
 * dialog's own default rather than failing the request; an outright invalid
 * size is a bug or a tampered body, so that does fail.
 */
function resolveSizes(
  raw: unknown,
  targets: AiFieldSpec[],
): AiSizeMap | undefined {
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

/**
 * The half-written values to continue from, as YAML the client rendered from
 * its own form state.
 *
 * Restricted to array/object targets: those are the only kinds the dialog
 * offers "tiếp tục" on, and they're the only ones where continuing means
 * anything - a half-written scalar is just a scalar the model would rewrite
 * anyway. A key that isn't a target is dropped rather than rejected: it can't
 * reach the skeleton, so echoing a seed for it would only spend tokens.
 */
function sanitiseSeeds(
  raw: unknown,
  targets: AiFieldSpec[],
): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const continuable = new Set(
    targets
      .filter((t) => t.kind === "array" || t.kind === "object")
      .map((t) => t.key),
  );
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!continuable.has(key)) continue;
    if (typeof value !== "string" || !value.trim()) continue;
    out[key] = value.slice(0, MAX_TEXT_CHARS);
  }
  return out;
}

/**
 * Rewrites one passage of a content field in place.
 *
 * The unit of work is a range of the document rather than a field, so almost
 * nothing of `handleGenerate` applies past the preflight: no `size` (the
 * length target comes from the passage), no `targets` (there's one field, and
 * only the selection inside it changes), and the answer is a bare HTML
 * fragment rather than keyed YAML.
 */
async function handleRewrite(
  req: DrystackRequest,
  config: Config<any, any>,
  resolved: AiRuntimeConfig | AiConfigError,
  routeConfig: AiRouteConfig,
): Promise<DrystackResponse> {
  const pre = await preflight(req, config, resolved, routeConfig);
  if (isPreflightResponse(pre)) return pre;
  const { body, entryDescription, schema, provider, runtime, lang } = pre;

  const { field, selection, context, description } = body;
  if (typeof field !== "string" || !schema[field]) {
    return json({ error: "Thiếu `field` hợp lệ." }, 400);
  }
  if (typeof selection !== "string" || !selection.trim()) {
    return json({ error: "Thiếu `selection`." }, 400);
  }

  // Same principle as `targets` above: the spec (and with it the tag
  // whitelist the prompt states) is rebuilt from the server's own schema, so
  // a hand-crafted request can't widen what the model is allowed to emit.
  const spec = describeField(field, schema[field]);
  if (!spec || spec.kind !== "content") {
    return json({ error: `"${field}" không phải field nội dung.` }, 400);
  }

  const passage = selection.slice(0, MAX_TEXT_CHARS);

  return streamResponse(provider, runtime, body.model, {
    system: buildRewriteSystemPrompt({
      lang,
      entryDescription,
      htmlTags: spec.htmlTags ?? [],
    }),
    user: buildRewriteUserPrompt({
      context: sanitiseContext(context),
      selection: passage,
      description: sanitiseText(description),
    }),
    maxTokens: rewriteMaxTokens(passage.length),
  });
}

/**
 * A caller-supplied free-text field, clamped to the same ceiling as every
 * other text on these routes. `description` reaches the model verbatim, so
 * without this it's the one input that could carry an unbounded prompt.
 */
function sanitiseText(value: unknown): string {
  return typeof value === "string" ? value.slice(0, MAX_TEXT_CHARS) : "";
}

function sanitiseContext(context: unknown): Record<string, string> {
  if (!context || typeof context !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    context as Record<string, unknown>,
  )) {
    if (typeof value === "string" && value.trim()) {
      out[key] = value.slice(0, MAX_TEXT_CHARS);
    }
  }
  return out;
}
