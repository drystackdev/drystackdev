#!/usr/bin/env bun
// Provision native-auth users for `storage: { kind: 'r2' }` (see
// plan/auth.md). Writes `auth/native/<email>.json` objects - password hashed
// with PBKDF2, profile encrypted with DRYSTACK_SECRET - through `wrangler r2
// object`, so the same command targets miniflare's local dev bucket
// (default) or the real one (--remote).
//
//   bun scripts/drystack-auth.ts add    <email> [--profile '{"name":"..."}'] [--password <pw>] [--remote]
//   bun scripts/drystack-auth.ts passwd <email> [--password <pw>] [--remote]
//   bun scripts/drystack-auth.ts remove <email> [--remote]
//
// Without --password the script prompts with hidden input. `passwd` keeps
// the stored profile; `add` on an existing email overwrites the whole file.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createUserFile,
  normalizeEmail,
  userFileKey,
  decryptProfile,
  type NativeAuthUserFile,
} from '../packages/drystack/src/api/native-auth';

const BUCKET = 'drystack-content';

function usage(): never {
  console.error(
    'usage: bun scripts/drystack-auth.ts <add|passwd|remove> <email> [--password <pw>] [--profile <json>] [--remote]'
  );
  process.exit(1);
}

function getSecret(): string {
  const secret = process.env.DRYSTACK_SECRET;
  if (!secret || secret.length < 32) {
    console.error(
      'DRYSTACK_SECRET (>= 32 chars) must be set in .env - it encrypts profiles and signs sessions.'
    );
    process.exit(1);
  }
  return secret;
}

async function promptHidden(label: string): Promise<string> {
  process.stderr.write(`${label}: `);
  const stdin = process.stdin;
  stdin.setRawMode?.(true);
  stdin.resume();
  let value = '';
  return new Promise(resolve => {
    const onData = (chunk: Buffer) => {
      for (const char of chunk.toString('utf8')) {
        if (char === '\n' || char === '\r' || char === '\u0004') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === '\u0003') process.exit(130);
        if (char === '\u007f') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

function wrangler(args: string[], opts: { allowFail?: boolean } = {}) {
  const result = spawnSync('bunx', ['wrangler', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0 && !opts.allowFail) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result;
}

function putObject(key: string, contents: string, remote: boolean) {
  const dir = mkdtempSync(join(tmpdir(), 'drystack-auth-'));
  const file = join(dir, 'user.json');
  try {
    writeFileSync(file, contents);
    wrangler([
      'r2',
      'object',
      'put',
      `${BUCKET}/${key}`,
      `--file=${file}`,
      '--content-type=application/json',
      remote ? '--remote' : '--local',
    ]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function getObject(key: string, remote: boolean): string | null {
  const dir = mkdtempSync(join(tmpdir(), 'drystack-auth-'));
  const file = join(dir, 'user.json');
  try {
    const result = wrangler(
      [
        'r2',
        'object',
        'get',
        `${BUCKET}/${key}`,
        `--file=${file}`,
        remote ? '--remote' : '--local',
      ],
      { allowFail: true }
    );
    if (result.status !== 0 || !existsSync(file)) return null;
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const args = process.argv.slice(2);
const command = args[0];
const emailArg = args[1];
if (!command || !emailArg || !['add', 'passwd', 'remove'].includes(command)) {
  usage();
}
const remote = args.includes('--remote');
const flagValue = (name: string) => {
  const index = args.indexOf(name);
  return index !== -1 ? args[index + 1] : undefined;
};

const email = normalizeEmail(emailArg);
if (!email) {
  console.error(`Invalid email: ${emailArg}`);
  process.exit(1);
}
const key = userFileKey(email);
const where = remote ? 'remote bucket' : 'local dev bucket (.wrangler/state)';

if (command === 'remove') {
  wrangler([
    'r2',
    'object',
    'delete',
    `${BUCKET}/${key}`,
    remote ? '--remote' : '--local',
  ]);
  console.log(`Removed ${email} from ${where}.`);
  process.exit(0);
}

const secret = getSecret();
const password =
  flagValue('--password') ?? (await promptHidden(`Password for ${email}`));
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}

if (command === 'add') {
  let profile: unknown = {};
  const rawProfile = flagValue('--profile');
  if (rawProfile) {
    try {
      profile = JSON.parse(rawProfile);
    } catch {
      console.error('--profile must be valid JSON');
      process.exit(1);
    }
  }
  const file = await createUserFile(password, profile, secret);
  putObject(key, JSON.stringify(file, null, 2), remote);
  console.log(`Created/updated ${email} in ${where}.`);
} else {
  // passwd: keep the existing (encrypted) profile, replace only the hash.
  const existing = getObject(key, remote);
  if (!existing) {
    console.error(`No user file for ${email} in ${where} - use \`add\` first.`);
    process.exit(1);
  }
  let parsed: NativeAuthUserFile;
  try {
    parsed = JSON.parse(existing);
  } catch {
    console.error(`Existing file for ${email} is not valid JSON.`);
    process.exit(1);
  }
  // Round-trip the profile so a rotated DRYSTACK_SECRET gets re-encrypted
  // under the current one (decryptProfile falls back to {} if undecryptable).
  const profile = await decryptProfile(parsed, secret);
  const file = await createUserFile(password, profile, secret);
  putObject(key, JSON.stringify(file, null, 2), remote);
  console.log(`Password updated for ${email} in ${where}.`);
}
