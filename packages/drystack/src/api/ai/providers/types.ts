export type AiStreamArgs = {
  apiKey: string;
  model: string;
  baseUrl?: string;
  system: string;
  user: string;
  maxTokens: number;
  signal: AbortSignal;
};

export type AiProvider = {
  name: string;
  /**
   * Returns the model's raw text output, already unwrapped from whatever SSE
   * envelope the vendor uses - callers see the same plain token stream
   * regardless of provider.
   *
   * Implementations must use `fetch` + web streams only (no vendor SDKs):
   * this runs on Cloudflare Workers, where the official SDKs' node builtins
   * aren't available.
   */
  stream(args: AiStreamArgs): Promise<ReadableStream<string>>;
};

export class AiProviderError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "AiProviderError";
    this.status = status;
  }
}

/**
 * Parses an SSE byte stream into the `data:` payloads of each event, dropping
 * comments/other fields. Shared by every adapter - the vendors differ in what
 * the JSON *inside* `data:` looks like, not in the framing.
 */
export function sseDataStream(
  body: ReadableStream<Uint8Array>,
): ReadableStream<string> {
  const decoder = new TextDecoder();
  let buffer = "";
  return new ReadableStream<string>({
    async start(controller) {
      const reader = body.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          // Events are separated by a blank line; a chunk can split one in
          // half, so only complete events are taken and the rest stays
          // buffered. \r\n\r\n is tolerated for proxies that rewrite EOLs.
          let sepIndex: number;
          while ((sepIndex = findEventEnd(buffer)) !== -1) {
            const rawEvent = buffer.slice(0, sepIndex);
            buffer = buffer.slice(sepIndex).replace(/^(\r?\n){2}/, "");
            for (const line of rawEvent.split(/\r?\n/)) {
              if (line.startsWith("data:")) {
                controller.enqueue(line.slice(5).trim());
              }
            }
          }
        }
        controller.close();
      } catch (err) {
        controller.error(err);
      } finally {
        reader.releaseLock();
      }
    },
    cancel(reason) {
      return body.cancel(reason);
    },
  });
}

function findEventEnd(buffer: string): number {
  const lf = buffer.indexOf("\n\n");
  const crlf = buffer.indexOf("\r\n\r\n");
  if (lf === -1) return crlf;
  if (crlf === -1) return lf;
  return Math.min(lf, crlf);
}

/**
 * Maps `data:` payloads to text tokens via `extract`, skipping events that
 * carry no text (pings, role deltas, usage, `[DONE]`).
 */
export function textStreamFromSse(
  body: ReadableStream<Uint8Array>,
  extract: (data: string) => string | undefined,
): ReadableStream<string> {
  const dataStream = sseDataStream(body);
  return dataStream.pipeThrough(
    new TransformStream<string, string>({
      transform(data, controller) {
        const text = extract(data);
        if (text) controller.enqueue(text);
      },
    }),
  );
}
