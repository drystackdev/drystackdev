#!/usr/bin/env bun
// Provision D1 users for `storage: { kind: 'r2' }` (see plan/user-managent.md
// mục 3/8). Replaces the old R2-object-based scripts/drystack-auth.ts: user
// accounts now live in D1 (see native-auth.ts / d1.ts), not `auth/native/*.yaml`.
// This is the emergency backdoor for admin lockouts - it bypasses every
// UI/permission check (including the app-level "exactly one SuperAdmin"
// rule on `add --role`) since its whole purpose is to recover when the UI
// itself is unusable. Shells out to `wrangler d1 execute drystack-db`
// (miniflare's local state by default, --remote for production), same
// pattern the old script used for `wrangler r2 object`.
//
//   bun scripts/drystack-auth.ts add    <email> [--name <name>] [--password <pw>] [--role <RoleName>] [--remote]
//   bun scripts/drystack-auth.ts passwd <email> [--password <pw>] [--remote]
//   bun scripts/drystack-auth.ts remove <email> [--remote]
//
// Without --password the script prompts with hidden input. `add` on an
// existing email upserts (updates name/password, reactivates); `--role`
// additionally assigns that role (creating it if it doesn't exist yet) -
// omit for a plain no-role account. `remove` also clears the user's role
// assignments so `user_role` never dangles.

import { spawnSync } from 'node:child_process';
import { hashPassword, normalizeEmail } from '../packages/drystack/src/api/native-auth';

const DATABASE = 'drystack-db';

function usage(): never {
  console.error(
    'usage: bun scripts/drystack-auth.ts <add|passwd|remove> <email> [--password <pw>] [--name <name>] [--role <RoleName>] [--remote]'
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
        if (char === '\n' || char === '\r' || char === '') {
          stdin.setRawMode?.(false);
          stdin.pause();
          stdin.off('data', onData);
          process.stderr.write('\n');
          resolve(value);
          return;
        }
        if (char === '') process.exit(130);
        if (char === '') value = value.slice(0, -1);
        else value += char;
      }
    };
    stdin.on('data', onData);
  });
}

// wrangler d1 execute has no parameter binding over the CLI - only a literal
// SQL string - so every value that reaches a query goes through this escape.
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

type D1ExecuteResult<T = Record<string, unknown>> = {
  results: T[];
  success: boolean;
  meta: { last_row_id?: number; changes?: number };
};

function d1Execute<T = Record<string, unknown>>(
  sql: string,
  remote: boolean
): D1ExecuteResult<T> {
  const result = spawnSync(
    'bunx',
    [
      'wrangler',
      'd1',
      'execute',
      DATABASE,
      `--command=${sql}`,
      '--json',
      remote ? '--remote' : '--local',
    ],
    { encoding: 'utf8' }
  );
  if (result.status !== 0) {
    console.error(result.stderr || result.stdout);
    process.exit(result.status ?? 1);
  }
  const parsed = JSON.parse(result.stdout);
  return parsed[0] as D1ExecuteResult<T>;
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
const where = remote ? 'remote D1 (drystack-db)' : 'local dev D1 (.wrangler/state)';

if (command === 'remove') {
  const existing = d1Execute<{ id: number }>(
    `SELECT id FROM user WHERE email = ${sqlString(email)}`,
    remote
  ).results;
  if (!existing.length) {
    console.error(`No user for ${email} in ${where}.`);
    process.exit(1);
  }
  const userId = existing[0].id;
  d1Execute(`DELETE FROM user_role WHERE user_id = ${userId}`, remote);
  d1Execute(`DELETE FROM user WHERE id = ${userId}`, remote);
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

if (command === 'passwd') {
  const existing = d1Execute<{ id: number }>(
    `SELECT id FROM user WHERE email = ${sqlString(email)}`,
    remote
  ).results;
  if (!existing.length) {
    console.error(`No user for ${email} in ${where} - use \`add\` first.`);
    process.exit(1);
  }
  d1Execute(
    `UPDATE user SET password = ${sqlString(passwordHash)}, updated_at = ${sqlString(now)} WHERE id = ${existing[0].id}`,
    remote
  );
  console.log(`Password updated for ${email} in ${where}.`);
  process.exit(0);
}

// add - `wrangler d1 execute --json`'s meta only reliably carries `duration`
// (no `changes`/`last_row_id` in local mode), so every id comes from a
// follow-up SELECT rather than the write's own result.
const name = flagValue('--name') ?? email;
const existing = d1Execute<{ id: number }>(
  `SELECT id FROM user WHERE email = ${sqlString(email)}`,
  remote
).results;

if (existing.length) {
  d1Execute(
    `UPDATE user SET name = ${sqlString(name)}, password = ${sqlString(passwordHash)}, active = 1, updated_at = ${sqlString(now)} WHERE id = ${existing[0].id}`,
    remote
  );
} else {
  d1Execute(
    `INSERT INTO user (email, name, password, active, created_at, updated_at)
     VALUES (${sqlString(email)}, ${sqlString(name)}, ${sqlString(passwordHash)}, 1, ${sqlString(now)}, ${sqlString(now)})`,
    remote
  );
}
const userId = d1Execute<{ id: number }>(
  `SELECT id FROM user WHERE email = ${sqlString(email)}`,
  remote
).results[0].id;
console.log(`Created/updated ${email} in ${where}.`);

const roleName = flagValue('--role');
if (roleName) {
  let role = d1Execute<{ id: number }>(
    `SELECT id FROM role WHERE name = ${sqlString(roleName)}`,
    remote
  ).results[0];
  if (roleName === 'SuperAdmin') {
    const holders = d1Execute<{ user_id: number }>(
      `SELECT user_role.user_id as user_id FROM user_role
       JOIN role ON role.id = user_role.role_id
       WHERE role.name = 'SuperAdmin'`,
      remote
    ).results;
    if (holders.some(h => h.user_id !== userId)) {
      console.error(
        'Refusing: SuperAdmin is already assigned to a different user - ' +
          'remove that role assignment first (plan/user-managent.md mục 4).'
      );
      process.exit(1);
    }
  }
  if (!role) {
    d1Execute(
      `INSERT INTO role (name, permissions, is_builtin) VALUES (${sqlString(roleName)}, '[]', 0)`,
      remote
    );
    role = d1Execute<{ id: number }>(
      `SELECT id FROM role WHERE name = ${sqlString(roleName)}`,
      remote
    ).results[0];
  }
  d1Execute(
    `INSERT OR IGNORE INTO user_role (user_id, role_id) VALUES (${userId}, ${role.id})`,
    remote
  );
  console.log(`Assigned role "${roleName}" to ${email} in ${where}.`);
}
