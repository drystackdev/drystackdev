import { AiProvider, AiProviderError, textStreamFromSse } from "./types";

const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export const anthropicProvider: AiProvider = {
  name: "anthropic",
  async stream({ apiKey, model, system, user, maxTokens, signal }) {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        stream: true,
        // Anthropic takes the system prompt as its own top-level param
        // rather than a message with role: 'system'.
        system,
        messages: [{ role: "user", content: user }],
      }),
      signal,
    });

    if (!res.ok || !res.body) {
      throw new AiProviderError(
        await describeError(res, "Anthropic"),
        res.status,
      );
    }

    return textStreamFromSse(res.body, (data) => {
      if (!data) return undefined;
      let event;
      try {
        event = JSON.parse(data);
      } catch {
        return undefined;
      }
      // Text arrives as content_block_delta/text_delta. Everything else
      // (message_start, ping, content_block_stop, message_delta with usage)
      // carries no output text.
      if (
        event.type === "content_block_delta" &&
        event.delta?.type === "text_delta"
      ) {
        return event.delta.text as string;
      }
      // The API reports mid-stream failures as an `error` event with a 200 on
      // the envelope, so this is the only place they surface.
      if (event.type === "error") {
        throw new AiProviderError(
          `Anthropic: ${event.error?.message ?? "lỗi không xác định"}`,
          502,
        );
      }
      return undefined;
    });
  },
};

export async function describeError(
  res: Response,
  label: string,
): Promise<string> {
  let detail = "";
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text);
      detail = json.error?.message ?? json.message ?? text;
    } catch {
      detail = text;
    }
  } catch {
    // Body already consumed or unreadable - the status alone still tells the
    // user enough to act on.
  }
  const hint =
    res.status === 401 || res.status === 403
      ? " (kiểm tra DRY_AI_KEY)"
      : res.status === 429
        ? " (đã chạm giới hạn tốc độ, thử lại sau)"
        : "";
  return `${label} trả lỗi ${res.status}${hint}${detail ? `: ${detail.slice(0, 500)}` : ""}`;
}
