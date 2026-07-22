/** @jest-environment node */
import { expect, test } from '@jest/globals';
import {
  hashPassword,
  normalizeEmail,
  signSession,
  verifyPassword,
  verifySession,
  getSessionFromCookieHeader,
  NATIVE_SESSION_COOKIE,
} from './native-auth';

const SECRET = 'a'.repeat(32);

test('hashPassword/verifyPassword round-trip', async () => {
  const hash = await hashPassword('correct horse battery staple');
  expect(hash.startsWith('pbkdf2$sha256$100000$')).toBe(true);
  expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  expect(await verifyPassword('wrong password', hash)).toBe(false);
});

test('same password hashes differently per user (random salt)', async () => {
  const a = await hashPassword('secret-password');
  const b = await hashPassword('secret-password');
  expect(a).not.toEqual(b);
  expect(await verifyPassword('secret-password', a)).toBe(true);
  expect(await verifyPassword('secret-password', b)).toBe(true);
});

test('verifyPassword rejects malformed stored hashes', async () => {
  expect(await verifyPassword('x', 'not-a-hash')).toBe(false);
  expect(await verifyPassword('x', 'pbkdf2$sha1$1$a$b')).toBe(false);
  expect(await verifyPassword('x', 'pbkdf2$sha256$NaN$a$b')).toBe(false);
});

test('session JWT round-trip', async () => {
  const token = await signSession({ email: 'user@example.com' }, SECRET);
  const session = await verifySession(token, SECRET);
  expect(session?.email).toEqual('user@example.com');
  expect(typeof session?.jti).toEqual('string');
  expect(session?.jti.length).toBeGreaterThan(0);
  expect(typeof session?.exp).toEqual('number');
});

test('each signed session gets a distinct jti', async () => {
  const a = await signSession({ email: 'user@example.com' }, SECRET);
  const b = await signSession({ email: 'user@example.com' }, SECRET);
  const sessionA = await verifySession(a, SECRET);
  const sessionB = await verifySession(b, SECRET);
  expect(sessionA?.jti).not.toEqual(sessionB?.jti);
});

test('session JWT rejects tampering, wrong secret, and expiry', async () => {
  const token = await signSession({ email: 'user@example.com' }, SECRET);
  const [h, p, s] = token.split('.');
  // tampered payload
  expect(await verifySession(`${h}.${p}x.${s}`, SECRET)).toBeNull();
  // wrong secret
  expect(await verifySession(token, 'b'.repeat(32))).toBeNull();
  // expired
  const expired = await signSession({ email: 'user@example.com' }, SECRET, -10);
  expect(await verifySession(expired, SECRET)).toBeNull();
  // garbage
  expect(await verifySession('nope', SECRET)).toBeNull();
});

test('getSessionFromCookieHeader reads the session cookie', async () => {
  const token = await signSession({ email: 'user@example.com' }, SECRET);
  const session = await getSessionFromCookieHeader(
    `other=1; ${NATIVE_SESSION_COOKIE}=${token}`,
    SECRET
  );
  expect(session?.email).toEqual('user@example.com');
  expect(await getSessionFromCookieHeader(null, SECRET)).toBeNull();
  expect(await getSessionFromCookieHeader('other=1', SECRET)).toBeNull();
});

test('normalizeEmail lowercases and rejects key-unsafe addresses', () => {
  expect(normalizeEmail(' User@Example.COM ')).toEqual('user@example.com');
  expect(normalizeEmail('a/b@example.com')).toBeNull();
  expect(normalizeEmail('..@example.com')).toBeNull();
  expect(normalizeEmail('not-an-email')).toBeNull();
  expect(normalizeEmail('user@example')).toBeNull();
});

