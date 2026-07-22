// D1-backed user/role/permission store for `storage: { kind: 'r2' }` (see
// plan/user-managent.md). Structural subset of Cloudflare's D1Database - same
// reasoning as R2BucketLike in api-r2.ts: @drystack/core stays free of a
// workers-types dependency, and tests run an in-memory fake of the same
// shape. Schema/migration lives at migrations/0001_init.sql.

export type D1RunResultLike = {
  success: boolean;
  meta: { last_row_id?: number; changes?: number };
};

export type D1ResultLike<T = unknown> = { results: T[]; success: boolean };

export type D1PreparedStatementLike = {
  bind(...values: unknown[]): D1PreparedStatementLike;
  run(): Promise<D1RunResultLike>;
  all<T = unknown>(): Promise<D1ResultLike<T>>;
  first<T = unknown>(): Promise<T | null>;
};

export type D1DatabaseLike = {
  prepare(query: string): D1PreparedStatementLike;
};

export type UserRow = {
  id: number;
  email: string;
  name: string;
  password: string | null;
  avatar: string | null;
  phone_number: string | null;
  address: string | null;
  email_verify_at: string | null;
  invite_token: string | null;
  invite_token_exp: string | null;
  active: number;
  created_at: string;
  updated_at: string;
};

export type RoleRow = {
  id: number;
  name: string;
  permissions: string;
  is_builtin: number;
};

// --- user -------------------------------------------------------------

export async function countUsers(db: D1DatabaseLike): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM user')
    .first<{ count: number }>();
  return row?.count ?? 0;
}

export async function getUserByEmail(
  db: D1DatabaseLike,
  email: string
): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM user WHERE email = ?').bind(email).first<UserRow>();
}

export async function getUserById(
  db: D1DatabaseLike,
  id: number
): Promise<UserRow | null> {
  return db.prepare('SELECT * FROM user WHERE id = ?').bind(id).first<UserRow>();
}

export async function getUserByInviteToken(
  db: D1DatabaseLike,
  token: string
): Promise<UserRow | null> {
  return db
    .prepare('SELECT * FROM user WHERE invite_token = ?')
    .bind(token)
    .first<UserRow>();
}

export async function listUsers(db: D1DatabaseLike): Promise<UserRow[]> {
  const result = await db
    .prepare('SELECT * FROM user ORDER BY updated_at DESC')
    .all<UserRow>();
  return result.results;
}

export async function createUser(
  db: D1DatabaseLike,
  data: {
    email: string;
    name: string;
    password?: string | null;
    inviteToken?: string | null;
    inviteTokenExp?: string | null;
  }
): Promise<UserRow> {
  const now = new Date().toISOString();
  const result = await db
    .prepare(
      `INSERT INTO user
         (email, name, password, active, invite_token, invite_token_exp, created_at, updated_at)
       VALUES (?, ?, ?, 1, ?, ?, ?, ?)`
    )
    .bind(
      data.email,
      data.name,
      data.password ?? null,
      data.inviteToken ?? null,
      data.inviteTokenExp ?? null,
      now,
      now
    )
    .run();
  const row = await getUserById(db, result.meta.last_row_id!);
  if (!row) throw new Error('createUser: row vanished after insert');
  return row;
}

export async function updateUserProfile(
  db: D1DatabaseLike,
  id: number,
  data: Partial<Pick<UserRow, 'name' | 'phone_number' | 'address' | 'avatar'>>
): Promise<void> {
  const fields = Object.keys(data) as (keyof typeof data)[];
  if (!fields.length) return;
  const set = fields.map(f => `${f} = ?`).join(', ');
  await db
    .prepare(`UPDATE user SET ${set}, updated_at = ? WHERE id = ?`)
    .bind(...fields.map(f => data[f]), new Date().toISOString(), id)
    .run();
}

// Sets the password, clears the (now-consumed) invite/reset token, and marks
// the account verified on first use - covers both "verify a new invite" and
// "forgot password" (see plan mục 6/10, same token pair for both flows).
export async function setPasswordAndConsumeToken(
  db: D1DatabaseLike,
  id: number,
  passwordHash: string
): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare(
      `UPDATE user SET
         password = ?,
         invite_token = NULL,
         invite_token_exp = NULL,
         email_verify_at = COALESCE(email_verify_at, ?),
         updated_at = ?
       WHERE id = ?`
    )
    .bind(passwordHash, now, now, id)
    .run();
}

export async function setInviteToken(
  db: D1DatabaseLike,
  id: number,
  token: string,
  expiresAt: string
): Promise<void> {
  await db
    .prepare(
      'UPDATE user SET invite_token = ?, invite_token_exp = ?, updated_at = ? WHERE id = ?'
    )
    .bind(token, expiresAt, new Date().toISOString(), id)
    .run();
}

export async function setUserActive(
  db: D1DatabaseLike,
  id: number,
  active: boolean
): Promise<void> {
  await db
    .prepare('UPDATE user SET active = ?, updated_at = ? WHERE id = ?')
    .bind(active ? 1 : 0, new Date().toISOString(), id)
    .run();
}

export async function deleteUser(db: D1DatabaseLike, id: number): Promise<void> {
  await db.prepare('DELETE FROM user WHERE id = ?').bind(id).run();
}

// --- role ---------------------------------------------------------------

export async function listRoles(db: D1DatabaseLike): Promise<RoleRow[]> {
  const result = await db.prepare('SELECT * FROM role ORDER BY id ASC').all<RoleRow>();
  return result.results;
}

export async function getRoleById(
  db: D1DatabaseLike,
  id: number
): Promise<RoleRow | null> {
  return db.prepare('SELECT * FROM role WHERE id = ?').bind(id).first<RoleRow>();
}

export async function getRoleByName(
  db: D1DatabaseLike,
  name: string
): Promise<RoleRow | null> {
  return db.prepare('SELECT * FROM role WHERE name = ?').bind(name).first<RoleRow>();
}

export async function createRole(db: D1DatabaseLike, name: string): Promise<RoleRow> {
  const result = await db
    .prepare("INSERT INTO role (name, permissions, is_builtin) VALUES (?, '[]', 0)")
    .bind(name)
    .run();
  const row = await getRoleById(db, result.meta.last_row_id!);
  if (!row) throw new Error('createRole: row vanished after insert');
  return row;
}

export async function renameRole(
  db: D1DatabaseLike,
  id: number,
  name: string
): Promise<void> {
  await db.prepare('UPDATE role SET name = ? WHERE id = ?').bind(name, id).run();
}

export async function updateRolePermissions(
  db: D1DatabaseLike,
  id: number,
  permissions: string[]
): Promise<void> {
  await db
    .prepare('UPDATE role SET permissions = ? WHERE id = ?')
    .bind(JSON.stringify(permissions), id)
    .run();
}

export async function deleteRole(db: D1DatabaseLike, id: number): Promise<void> {
  await db.prepare('DELETE FROM role WHERE id = ?').bind(id).run();
}

export async function countRoleUsers(
  db: D1DatabaseLike,
  roleId: number
): Promise<number> {
  const row = await db
    .prepare('SELECT COUNT(*) as count FROM user_role WHERE role_id = ?')
    .bind(roleId)
    .first<{ count: number }>();
  return row?.count ?? 0;
}

// --- user_role ------------------------------------------------------------

export async function getRolesForUser(
  db: D1DatabaseLike,
  userId: number
): Promise<RoleRow[]> {
  const result = await db
    .prepare(
      `SELECT role.* FROM role
       JOIN user_role ON user_role.role_id = role.id
       WHERE user_role.user_id = ?`
    )
    .bind(userId)
    .all<RoleRow>();
  return result.results;
}

export async function assignRole(
  db: D1DatabaseLike,
  userId: number,
  roleId: number
): Promise<void> {
  await db
    .prepare('INSERT OR IGNORE INTO user_role (user_id, role_id) VALUES (?, ?)')
    .bind(userId, roleId)
    .run();
}

export async function unassignRole(
  db: D1DatabaseLike,
  userId: number,
  roleId: number
): Promise<void> {
  await db
    .prepare('DELETE FROM user_role WHERE user_id = ? AND role_id = ?')
    .bind(userId, roleId)
    .run();
}

export async function listUsersWithRoleNames(
  db: D1DatabaseLike
): Promise<(UserRow & { roleNames: string[] })[]> {
  const users = await listUsers(db);
  const result = await db
    .prepare(
      `SELECT user_role.user_id as user_id, role.name as name FROM user_role
       JOIN role ON role.id = user_role.role_id`
    )
    .all<{ user_id: number; name: string }>();
  const byUser = new Map<number, string[]>();
  for (const row of result.results) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, []);
    byUser.get(row.user_id)!.push(row.name);
  }
  return users.map(u => ({ ...u, roleNames: byUser.get(u.id) ?? [] }));
}

// Single lookup that both the session-active-check (verifiedSession in
// api-r2.ts) and every permission check need: the user row plus every role
// they hold. Returns null for a missing or deactivated user - callers treat
// that as "no session" (see plan mục 3).
export async function getActiveSessionUser(
  db: D1DatabaseLike,
  email: string
): Promise<{ user: UserRow; roles: RoleRow[] } | null> {
  const user = await getUserByEmail(db, email);
  if (!user || !user.active) return null;
  const roles = await getRolesForUser(db, user.id);
  return { user, roles };
}
