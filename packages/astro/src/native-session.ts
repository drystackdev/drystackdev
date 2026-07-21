import { getSessionFromCookieHeader } from "@drystack/core/api/native-auth";
import { getCloudflareEnv } from "./api";

// Server-side session check for r2-mode page gating (the injected
// /drystack/** page and /login redirect logic). Reads DRYSTACK_SECRET the
// same two ways api.tsx does - the `cloudflare:workers` env on Workers,
// `import.meta.env` everywhere else - and verifies the HttpOnly JWT cookie.
// Returns null when the secret is missing entirely: with no secret nothing
// could ever have been signed, so there is no session to accept.
export async function getNativeSession(
  request: Request,
): Promise<{ email: string } | null> {
  const envVarsForCf = await getCloudflareEnv();
  let secret: string | undefined = envVarsForCf?.DRYSTACK_SECRET;
  if (!secret) {
    try {
      secret = import.meta.env.DRYSTACK_SECRET;
    } catch {
      secret = undefined;
    }
  }
  if (!secret) return null;
  return getSessionFromCookieHeader(request.headers.get("cookie"), secret);
}
