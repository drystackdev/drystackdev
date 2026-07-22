import { verifiedSession } from "@drystack/core/api/api-r2";
import { getCloudflareEnv } from "./cloudflare-env";

// Server-side session check for r2-mode page gating (the injected
// /drystack/** page and /login redirect logic). Reads DRYSTACK_SECRET/the R2
// bucket/the D1 database the same way api.tsx does - the `cloudflare:workers`
// env on Workers, `import.meta.env` everywhere else - and verifies the
// HttpOnly JWT cookie against `verifiedSession`, the SAME check the API layer
// uses (signature + expiry + the auth/revoked/ blacklist + D1 active-user
// check - see api-r2.ts) so a logged-out or deactivated session can't still
// render the admin shell just because the page gate checked less than the
// API did. Returns null when the secret, bucket, or database is missing
// entirely: with no secret nothing could ever have been signed, and with no
// bucket/database there's nowhere to check revocation/the user record, so
// there is no session to accept either way.
export async function getNativeSession(
  request: Request,
): Promise<{ email: string; roles: { name: string; permissions: string }[] } | null> {
  const envVarsForCf = await getCloudflareEnv();
  let secret: string | undefined = envVarsForCf?.DRYSTACK_SECRET;
  if (!secret) {
    try {
      secret = import.meta.env.DRYSTACK_SECRET;
    } catch {
      secret = undefined;
    }
  }
  const bucket = envVarsForCf?.DRYSTACK_R2;
  const db = envVarsForCf?.DRYSTACK_DB;
  if (!secret || !bucket || !db) return null;
  const session = await verifiedSession(request as any, bucket, db, secret);
  return session ? { email: session.email, roles: session.roles } : null;
}
