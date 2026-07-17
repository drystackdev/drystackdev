export type DrystackRequest = {
  headers: { get(name: string): string | null };
  method: string;
  url: string;
  json: () => Promise<any>;
};

export type DrystackResponse = ResponseInit & {
  // A ReadableStream body is passed straight to `new Response(...)` by the
  // adapters, so it streams to the client rather than being buffered. Note
  // the Astro dev middleware has to pipe it explicitly (see
  // handleLocalApiRequest in @drystack/astro) — `res.end(stream)` would not.
  body: Uint8Array | string | ReadableStream<Uint8Array> | null;
};

export function redirect(
  to: string,
  initialHeaders?: [string, string][]
): DrystackResponse {
  return {
    body: null,
    status: 307,
    headers: [...(initialHeaders ?? []), ['Location', to]],
  };
}
