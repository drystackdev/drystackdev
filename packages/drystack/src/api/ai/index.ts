import * as cookie from "cookie";

import type { Config } from "../..";
import type { ComponentSchema } from "../../form/api";
import type { DrystackRequest, DrystackResponse } from "../internal-utils";
import {
  AiConfigError,
  AiEnv,
  AiRuntimeConfig,
  isAiConfigError,
  resolveAiEnv,
} from "./env";
import {
  buildSystemPrompt,
  buildUserPrompt,
  isAiSize,
  SIZE_SPECS,
} from "./prompt";
import { anthropicProvider } from "./providers/anthropic";
import { googleProvider } from "./providers/google";
import { openaiProvider } from "./providers/openai";
import { AiProvider, AiProviderError } from "./providers/types";
import { describeFields } from "./schema-to-yaml";

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
    if (joined === "ai/generate" && req.method === "POST") {
      return handleGenerate(req, config, resolved);
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
    });
  }
  // Never echoes the key - only that one is present, and what it points at.
  return json({
    configured: true,
    provider: resolved.provider,
    model: resolved.model,
  });
}

async function handleGenerate(
  req: DrystackRequest,
  config: Config<any, any>,
  resolved: AiRuntimeConfig | AiConfigError,
): Promise<DrystackResponse> {
  // Authentication is checked before anything else, config included: in
  // GitHub mode the admin UI is deployed publicly, so without this the route
  // would be an open, unauthenticated proxy to a paid AI account. Answering
  // config questions first would also tell an anonymous caller whether a key
  // is present, which is nobody's business but the signed-in user's.
  // Local mode only ever runs on the developer's own machine.
  if (config.storage.kind === "github") {
    const cookies = cookie.parse(req.headers.get("cookie") ?? "");
    if (!cookies["drystack-gh-access-token"]) {
      return json({ error: "Chưa đăng nhập." }, 401);
    }
  }

  if (isAiConfigError(resolved)) {
    return json({ error: resolved.message, reason: resolved.reason }, 503);
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body không phải JSON hợp lệ." }, 400);
  }

  const { entry, context, description, size } = body ?? {};
  if (!entry?.kind || !entry?.key) {
    return json({ error: "Thiếu `entry`." }, 400);
  }
  if (!isAiSize(size)) {
    return json({ error: "`size` không hợp lệ." }, 400);
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

  const provider = PROVIDERS[resolved.provider];
  if (!provider) {
    return json({ error: `Provider "${resolved.provider}" chưa hỗ trợ.` }, 500);
  }

  const system = buildSystemPrompt({
    lang: config.ai?.lang ?? config.locale ?? "vi-VN",
    entryDescription,
    targets,
    hasContentField: targets.some((t) => t.kind === "content"),
    size,
  });
  const user = buildUserPrompt({
    context: sanitiseContext(context),
    description: typeof description === "string" ? description : "",
  });

  const controller = new AbortController();
  try {
    const textStream = await provider.stream({
      apiKey: resolved.apiKey,
      model: resolved.model,
      baseUrl: resolved.baseUrl,
      system,
      user,
      maxTokens: SIZE_SPECS[size].maxTokens,
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
    const status = err instanceof AiProviderError ? err.status : 502;
    return json(
      { error: err instanceof Error ? err.message : "Lỗi không xác định." },
      // A provider 401 means *our* key is bad, not that the caller is
      // unauthorised - remapping avoids the admin UI treating it as a
      // session problem and bouncing the user to log in again.
      status === 401 || status === 403 ? 502 : status,
    );
  }
}

function sanitiseContext(context: unknown): Record<string, string> {
  if (!context || typeof context !== "object") return {};
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(
    context as Record<string, unknown>,
  )) {
    if (typeof value === "string" && value.trim()) {
      // Long context is fine, but a runaway field shouldn't blow the request
      // budget on its own.
      out[key] = value.slice(0, 20_000);
    }
  }
  return out;
}
