import * as cookie from 'cookie';
import { dump, load } from 'js-yaml';
import { base64UrlDecode, base64UrlEncode } from '#base64';
import { webcrypto } from '#webcrypto';
import { bytesToHex } from '../hex';

// Native email/password auth for `storage: { kind: 'r2' }` deployments (see
// R2StorageConfig in config.tsx). Everything here runs on WebCrypto only so
// the same code executes in the deployed Worker, `astro dev`'s Node process,
// and the bun-run CLI script (scripts/drystack-auth.ts) that provisions
// users.
//
// One YAML object per user at `auth/native/<email>.yaml` in the R2 bucket:
//   password: "<one-way pbkdf2 hash>"
//   profile: { ...display fields }
//   createdAt: "<ISO>"
// YAML (not JSON) so the stored profile reads like the rest of the CMS's
// content and stays hand-editable. `load` still parses any pre-migration
// `.json` object (JSON is a YAML subset), so legacy users keep working - see
// legacyUserFileKey and readUserFile's fallback in api-r2.ts. The password can
// only ever be verified, never recovered. The profile is display data (name,
// etc.), not a credential. The `auth/` prefix is hard-excluded from the public
// tree/blob routes and refused by the update route (see api-r2.ts) - these
// files must never be readable or writable through the content API.

const encoder = new TextEncoder();

export const AUTH_DIRECTORY = 'auth';
export const AUTH_NATIVE_PREFIX = 'auth/native/';
// Revoked session ids (jti) live here, one empty-ish object per revoked
// token, keyed by jti. A logout writes the current token's jti; every session
// verification that has bucket access consults it, so a stolen-but-not-yet-
// expired token stops working the moment its owner logs out. The object body
// is the token's `exp` (unix seconds) so a future sweep/cron can drop entries
// once the underlying token would have expired anyway.
export const AUTH_REVOKED_PREFIX = 'auth/revoked/';

export function revokedKey(jti: string) {
  return `${AUTH_REVOKED_PREFIX}${jti}`;
}

export type NativeSession = { email: string; jti: string; exp: number };

// The session JWT. HttpOnly so page scripts can never read it - the server
// side (API routes and the /drystack page gate) is the only consumer.
export const NATIVE_SESSION_COOKIE = 'drystack-session';
// Presence-only marker for client code (VEI's eligibility probe, the /login
// page's "already signed in" shortcut). Deliberately NOT HttpOnly and carries
// no secret - holding it proves nothing, every real check verifies the
// HttpOnly JWT server-side.
export const NATIVE_SESSION_HINT_COOKIE = 'drystack-session-hint';

export const NATIVE_SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

// Cloudflare Workers hard-caps PBKDF2 at 100k iterations (higher values
// throw), so this is the strongest setting that runs everywhere the verify
// path does. The count is stored per-hash, so it can be raised later without
// invalidating existing users.
const PBKDF2_ITERATIONS = 100_000;
const SALT_LENGTH = 16;
const HASH_LENGTH = 32;

async function pbkdf2(password: string, salt: Uint8Array, iterations: number) {
  const key = await webcrypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await webcrypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as Uint8Array<ArrayBuffer>,
      iterations,
      hash: 'SHA-256',
    },
    key,
    HASH_LENGTH * 8
  );
  return new Uint8Array(bits);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array) {
  if (a.byteLength !== b.byteLength) return false;
  let diff = 0;
  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = webcrypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${base64UrlEncode(
    salt
  )}$${base64UrlEncode(hash)}`;
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') {
    return false;
  }
  const iterations = Number(parts[2]);
  if (!Number.isInteger(iterations) || iterations < 1) return false;
  let salt, expected;
  try {
    salt = base64UrlDecode(parts[3]);
    expected = base64UrlDecode(parts[4]);
  } catch {
    return false;
  }
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

// Emails become R2 object keys (`auth/native/<email>.json`), so the charset
// is restricted to things that can never traverse or collide: no slashes, no
// uppercase (keys are case-sensitive but emails aren't), nothing outside the
// usual address characters.
export function normalizeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9._%+-]*@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/.test(normalized)) {
    return null;
  }
  return normalized;
}

export function userFileKey(email: string) {
  return `${AUTH_NATIVE_PREFIX}${email}.yaml`;
}

// Where users were stored before the YAML switch. Reads fall back to it and
// writes delete it, so a live deployment's existing accounts migrate on first
// touch instead of vanishing (which would make the site look "unset up").
export function legacyUserFileKey(email: string) {
  return `${AUTH_NATIVE_PREFIX}${email}.json`;
}

export type NativeAuthUserFile = {
  password: string;
  profile?: unknown;
  createdAt?: string;
};

export function serializeUserFile(file: NativeAuthUserFile): string {
  return dump(file);
}

// Parses a stored user file. `load` reads both YAML and legacy JSON (JSON is a
// YAML subset), so this is safe against either on-disk format. Returns null for
// anything that isn't a valid user record (no string password), matching the
// old JSON.parse guard.
export function parseUserFile(text: string): NativeAuthUserFile | null {
  let parsed: unknown;
  try {
    parsed = load(text);
  } catch {
    return null;
  }
  if (typeof (parsed as { password?: unknown } | undefined)?.password !== 'string') {
    return null;
  }
  return parsed as NativeAuthUserFile;
}

export async function createUserFile(
  password: string,
  profile: unknown,
  createdAt: string = new Date().toISOString()
): Promise<NativeAuthUserFile> {
  return {
    password: await hashPassword(password),
    profile: profile ?? {},
    createdAt,
  };
}

// Minimal HS256 JWT - header/payload/signature, base64url, HMAC-SHA-256 with
// DRYSTACK_SECRET. No library: the token only ever carries {sub, jti, iat,
// exp} and is both minted and verified by this module, so the general-JWT
// surface (alg negotiation etc.) is deliberately not implemented - `alg` is
// checked to be exactly HS256 and anything else is rejected. `jti` is a
// per-token random id so a specific token can be revoked (see
// AUTH_REVOKED_PREFIX) rather than only expiring.
async function hmacKey(secret: string) {
  return webcrypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function signSession(
  session: { email: string },
  secret: string,
  maxAgeSeconds: number = NATIVE_SESSION_MAX_AGE_SECONDS
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const jti = bytesToHex(webcrypto.getRandomValues(new Uint8Array(16)));
  const header = base64UrlEncode(
    encoder.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  );
  const payload = base64UrlEncode(
    encoder.encode(
      JSON.stringify({
        sub: session.email,
        jti,
        iat: now,
        exp: now + maxAgeSeconds,
      })
    )
  );
  const signature = await webcrypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${header}.${payload}`)
  );
  return `${header}.${payload}.${base64UrlEncode(new Uint8Array(signature))}`;
}

// Pure crypto/expiry check - no revocation. Callers with bucket access layer
// the blacklist on top (see api-r2.ts's `session()` and native-session.ts);
// callers without it (unit tests) still get signature + expiry enforcement.
export async function verifySession(
  token: string,
  secret: string
): Promise<NativeSession | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  let headerObj, payloadObj, signatureBytes;
  const decoder = new TextDecoder();
  try {
    headerObj = JSON.parse(decoder.decode(base64UrlDecode(header)));
    payloadObj = JSON.parse(decoder.decode(base64UrlDecode(payload)));
    signatureBytes = base64UrlDecode(signature);
  } catch {
    return null;
  }
  if (headerObj?.alg !== 'HS256' || headerObj?.typ !== 'JWT') return null;
  const expected = await webcrypto.subtle.sign(
    'HMAC',
    await hmacKey(secret),
    encoder.encode(`${header}.${payload}`)
  );
  if (!timingSafeEqual(new Uint8Array(expected), signatureBytes)) return null;
  if (typeof payloadObj?.sub !== 'string') return null;
  if (typeof payloadObj?.jti !== 'string') return null;
  if (
    typeof payloadObj?.exp !== 'number' ||
    payloadObj.exp <= Math.floor(Date.now() / 1000)
  ) {
    return null;
  }
  return { email: payloadObj.sub, jti: payloadObj.jti, exp: payloadObj.exp };
}

export async function getSessionFromCookieHeader(
  cookieHeader: string | null,
  secret: string
): Promise<NativeSession | null> {
  if (!cookieHeader) return null;
  const token = cookie.parse(cookieHeader)[NATIVE_SESSION_COOKIE];
  if (!token) return null;
  return verifySession(token, secret);
}

const isProduction = () => {
  try {
    return process.env.NODE_ENV === 'production';
  } catch {
    return true;
  }
};

// Both Set-Cookie headers for a fresh login: the HttpOnly JWT plus the
// presence hint. Kept together so no call site can set one without the other.
export function sessionCookieHeaders(token: string): [string, string][] {
  const shared = {
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: NATIVE_SESSION_MAX_AGE_SECONDS,
    expires: new Date(Date.now() + NATIVE_SESSION_MAX_AGE_SECONDS * 1000),
  };
  return [
    [
      'Set-Cookie',
      cookie.serialize(NATIVE_SESSION_COOKIE, token, {
        ...shared,
        httpOnly: true,
      }),
    ],
    ['Set-Cookie', cookie.serialize(NATIVE_SESSION_HINT_COOKIE, '1', shared)],
  ];
}

export function clearSessionCookieHeaders(): [string, string][] {
  const shared = {
    sameSite: 'lax' as const,
    secure: isProduction(),
    path: '/',
    maxAge: 0,
    expires: new Date(0),
  };
  return [
    [
      'Set-Cookie',
      cookie.serialize(NATIVE_SESSION_COOKIE, '', { ...shared, httpOnly: true }),
    ],
    ['Set-Cookie', cookie.serialize(NATIVE_SESSION_HINT_COOKIE, '', shared)],
  ];
}
