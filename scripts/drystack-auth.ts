#!/usr/bin/env bun
// Provision native-auth users for `storage: { kind: 'r2' }` (see
// plan/user-managent.md). Users live in the D1 `user` table now (not R2
// YAML objects), reached through `wrangler d1 execute` so the same command
// targets miniflare's local dev database (default) or the real one
// (--remote) - same shape as the old R2-object-based version of this script.
//
//   bun scripts/drystack-auth.ts add    <email> [--name <name>] [--password <pw>] [--remote]
//   bun scripts/drystack-auth.ts passwd <email> [--password <pw>] [--remote]
//   bun scripts/drystack-auth.ts remove <email> [--remote]
//
// Without --password the script prompts with hidden input. `add` upserts
// (existing email keeps its role assignments, just gets a new name/password
// and is reactivated); it does NOT assign any role - use the Role
// management UI (or a direct `wrangler d1 execute`) to grant one. `remove`
// also deletes the user's role assignments (D1 doesn't reliably enforce the
// `ON DELETE CASCADE` foreign key outside a real transaction, so this script
// does it explicitly rather than assuming it happened).
//
// This is a break-glass tool - it doesn't re-implement the app's own rules
// (e.g. "can't delete the SuperAdmin"), the same way the old script could
// write any R2 object directly. Use the admin UI for anything routine.

import { spawnSync } from 'node:child_process';
import { normalizeEmail, hashPassword } from '../packages/drystack/src/api/native-auth';

const DATABASE = 'drystack-db';

function usage(): never {
  console.error(
    'usage: bun scripts/drystack-auth.ts <add|passwd|remove> <email> [--name <name>] [--password <pw>] [--remote]'
  );
  process.exit(1);
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

// Single-quoted SQL string literal - doubles embedded quotes, the standard
// SQL escape (and what SQLite/D1 expects).
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function d1Execute(sql: string, remote: boolean, json = false) {
  const args = [
    'd1',
    'execute',
    DATABASE,
    `--command=${sql}`,
    remote ? '--remote' : '--local',
  ];
  if (json) args.push('--json');
  const result = spawnSync('bunx', ['wrangler', ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  return result.stdout;
}

function d1QueryRows<T>(sql: string, remote: boolean): T[] {
  const stdout = d1Execute(sql, remote, true);
  try {
    const parsed = JSON.parse(stdout);
    return parsed?.[0]?.results ?? [];
  } catch {
    console.error(`Could not parse wrangler d1 execute --json output:\n${stdout}`);
    process.exit(1);
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
const where = remote ? 'remote database' : 'local dev database (.wrangler/state)';

if (command === 'remove') {
  d1Execute(
    `DELETE FROM user_role WHERE user_id = (SELECT id FROM user WHERE email = ${sqlString(email)}); ` +
      `DELETE FROM user WHERE email = ${sqlString(email)};`,
    remote
  );
  console.log(`Removed ${email} from ${where}.`);
  process.exit(0);
}

const password =
  flagValue('--password') ?? (await promptHidden(`Password for ${email}`));
if (password.length < 8) {
  console.error('Password must be at least 8 characters.');
  process.exit(1);
}
const passwordHash = await hashPassword(password);
const now = new Date().toISOString();

if (command === 'add') {
  const name = flagValue('--name') ?? email;
  d1Execute(
    `INSERT INTO user (email, name, password, active, created_at, updated_at)
     VALUES (${sqlString(email)}, ${sqlString(name)}, ${sqlString(passwordHash)}, 1, ${sqlString(now)}, ${sqlString(now)})
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       password = excluded.password,
       active = 1,
       updated_at = excluded.updated_at;`,
    remote
  );
  console.log(
    `Created/updated ${email} in ${where}. No role assigned - use the Role management UI to grant one.`
  );
} else {
  const existing = d1QueryRows<{ id: number }>(
    `SELECT id FROM user WHERE email = ${sqlString(email)};`,
    remote
  );
  if (!existing.length) {
    console.error(`No user for ${email} in ${where} - use \`add\` first.`);
    process.exit(1);
  }
  d1Execute(
    `UPDATE user SET password = ${sqlString(passwordHash)}, updated_at = ${sqlString(now)} WHERE email = ${sqlString(email)};`,
    remote
  );
  console.log(`Password updated for ${email} in ${where}.`);
}
