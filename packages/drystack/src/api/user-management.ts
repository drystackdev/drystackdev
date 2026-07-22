import * as s from 'superstruct';
import { DrystackRequest, DrystackResponse } from './internal-utils';
import { hashPassword, normalizeEmail, verifyPassword } from './native-auth';
import { webcrypto } from '#webcrypto';
import { bytesToHex } from '../hex';
import {
  D1DatabaseLike,
  RoleRow,
  UserRow,
  assignRole,
  countRoleUsers,
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  getRoleById,
  getRoleByName,
  getRolesForUser,
  getUserByEmail,
  getUserByInviteToken,
  getUserById,
  listRoles,
  listUsersWithRoleNames,
  renameRole,
  setInviteToken,
  setPasswordAndConsumeToken,
  setUserActive,
  unassignRole,
  updateRolePermissions,
  updateUserProfile,
} from './d1';
import { ADMIN_ROLE, SUPER_ADMIN_ROLE, isAdmin, isSuperAdmin } from './permissions';

// User/Role management routes for `storage: { kind: 'r2' }`
// (plan/user-managent.md mục 5/6) - everything under `users/*`, `roles/*`,
// `profile/*`, plus the two unauthenticated token-based routes
// `password-setting` and `forgot-password`. Dispatched from
// r2ModeApiHandler in api-r2.ts (which also owns the outer session gate for
// `profile/*`/`users/*`/`roles/*` - only `password-setting`/
// `forgot-password` are reachable with no session at all, by design).

function json(body: unknown, status = 200): DrystackResponse {
  return {
    status,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

const forbidden = (message: string) => json({ error: message }, 403);
const notFound = () => json({ error: 'not-found' }, 404);
const badRequest = (message = 'bad-request') => json({ error: message }, 400);

function newToken(): string {
  return bytesToHex(webcrypto.getRandomValues(new Uint8Array(24)));
}

// Email links need an absolute URL - there's no browser location to resolve
// a relative one against once the link is read outside the app. `req.url`
// is the real deployed origin (not a config value that could drift from
// it), same as the request the admin is currently making.
function passwordSettingLink(req: DrystackRequest, token: string): string {
  return `${new URL(req.url).origin}/password-setting?token=${token}`;
}

const INVITE_TOKEN_TTL_HOURS = 24;
const RESET_TOKEN_TTL_HOURS = 1;

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

// Never sent over the wire as-is: strips password + invite_token off a
// UserRow before it reaches a list/detail response. invite_token is only
// ever returned inline from the specific add/resend-invite response, to the
// actor who just performed that action (see addUser/resendInvite below).
function publicUser(user: UserRow, roleNames: string[] = []) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    avatar: user.avatar,
    phoneNumber: user.phone_number,
    address: user.address,
    emailVerifyAt: user.email_verify_at,
    active: !!user.active,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
    pendingInvite: !user.password,
    roles: roleNames,
  };
}

function publicRole(role: RoleRow, userCount: number) {
  return {
    id: role.id,
    name: role.name,
    permissions: JSON.parse(role.permissions) as string[],
    isBuiltin: !!role.is_builtin,
    isLocked: role.name === SUPER_ADMIN_ROLE || role.name === ADMIN_ROLE,
    userCount,
  };
}

type Session = { email: string; roles: Pick<RoleRow, 'name' | 'permissions'>[] };

function requireFullAccess(session: Session): DrystackResponse | undefined {
  if (isSuperAdmin(session.roles) || isAdmin(session.roles)) return undefined;
  return forbidden('Không đủ quyền quản trị.');
}

export type SendEmailParams = { to: string; subject: string; html: string };
// Injected by the caller (generic.ts, once wired to Cloudflare's Send Email
// binding - see plan/user-managent.md mục 7). Undefined means "not
// configured yet": user creation/forgot-password still succeed, the caller
// just doesn't get an email - every route that would send one also returns
// the raw token so the admin UI can show a copyable link instead (mục 6's
// documented fallback for dev/preview environments without the binding).
export type SendEmail = (params: SendEmailParams) => Promise<boolean>;

function inviteEmailHtml(name: string, link: string): string {
  return `<p>Xin chào ${escapeHtml(name)},</p><p>Bạn được mời tham gia quản trị site. Bấm vào link dưới đây để đặt mật khẩu (hết hạn sau ${INVITE_TOKEN_TTL_HOURS} giờ):</p><p><a href="${link}">${link}</a></p>`;
}

function resetEmailHtml(link: string): string {
  return `<p>Có yêu cầu đặt lại mật khẩu cho tài khoản này. Bấm vào link dưới đây (hết hạn sau ${RESET_TOKEN_TTL_HOURS} giờ):</p><p><a href="${link}">${link}</a></p><p>Nếu bạn không yêu cầu điều này, hãy bỏ qua email.</p>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[ch]!);
}

// ---------------------------------------------------------------------------
// users/*
// ---------------------------------------------------------------------------

const addUserSchema = s.object({
  email: s.string(),
  name: s.string(),
  phoneNumber: s.optional(s.string()),
  address: s.optional(s.string()),
});

async function listUsers(db: D1DatabaseLike): Promise<DrystackResponse> {
  const rows = await listUsersWithRoleNames(db);
  return json(rows.map(row => publicUser(row, row.roleNames)));
}

async function addUser(
  req: DrystackRequest,
  db: D1DatabaseLike,
  sendEmail: SendEmail | undefined
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), addUserSchema);
  } catch {
    return badRequest();
  }
  const email = normalizeEmail(body.email);
  if (!email) return badRequest('invalid-email');
  if (!body.name.trim()) return badRequest('name-required');
  if (await getUserByEmail(db, email)) {
    return json({ error: 'email-already-exists' }, 409);
  }

  const token = newToken();
  const user = await createUser(db, {
    email,
    name: body.name.trim(),
    inviteToken: token,
    inviteTokenExp: hoursFromNow(INVITE_TOKEN_TTL_HOURS),
  });
  if (body.phoneNumber || body.address) {
    await updateUserProfile(db, user.id, {
      phone_number: body.phoneNumber,
      address: body.address,
    });
  }

  let emailSent = false;
  if (sendEmail) {
    emailSent = await sendEmail({
      to: email,
      subject: 'Mời tham gia quản trị site',
      html: inviteEmailHtml(body.name, passwordSettingLink(req, token)),
    }).catch(() => false);
  }

  return json({
    user: publicUser({ ...user, phone_number: body.phoneNumber ?? null, address: body.address ?? null }),
    inviteToken: token,
    emailSent,
  });
}

async function resendInvite(
  req: DrystackRequest,
  db: D1DatabaseLike,
  userId: number,
  sendEmail: SendEmail | undefined
): Promise<DrystackResponse> {
  const user = await getUserById(db, userId);
  if (!user) return notFound();
  if (user.password) {
    return badRequest('already-verified');
  }
  const token = newToken();
  await setInviteToken(db, user.id, token, hoursFromNow(INVITE_TOKEN_TTL_HOURS));

  let emailSent = false;
  if (sendEmail) {
    emailSent = await sendEmail({
      to: user.email,
      subject: 'Mời tham gia quản trị site',
      html: inviteEmailHtml(user.name, passwordSettingLink(req, token)),
    }).catch(() => false);
  }
  return json({ inviteToken: token, emailSent });
}

const setActiveSchema = s.object({ active: s.boolean() });

async function setActive(
  req: DrystackRequest,
  db: D1DatabaseLike,
  session: Session,
  userId: number
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), setActiveSchema);
  } catch {
    return badRequest();
  }
  const user = await getUserById(db, userId);
  if (!user) return notFound();
  if (user.email === session.email && !body.active) {
    return forbidden('Không thể tự khoá tài khoản của chính mình.');
  }
  await setUserActive(db, userId, body.active);
  return json({ ok: true });
}

async function removeUser(
  db: D1DatabaseLike,
  session: Session,
  userId: number
): Promise<DrystackResponse> {
  // Only SuperAdmin deletes users at all - Admin is blocked outright (plan
  // mục 4), not just for protected accounts.
  if (!isSuperAdmin(session.roles)) {
    return forbidden('Chỉ SuperAdmin được xoá user.');
  }
  const user = await getUserById(db, userId);
  if (!user) return notFound();
  if (user.email === session.email) {
    return forbidden('Không thể tự xoá chính mình.');
  }
  const roles = await getRolesForUser(db, userId);
  if (roles.some(r => r.name === SUPER_ADMIN_ROLE)) {
    return forbidden('Không thể xoá SuperAdmin.');
  }
  await deleteUser(db, userId);
  return json({ ok: true });
}

const assignRoleSchema = s.object({ roleId: s.number() });

async function assignUserRole(
  req: DrystackRequest,
  db: D1DatabaseLike,
  session: Session,
  userId: number
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), assignRoleSchema);
  } catch {
    return badRequest();
  }
  const user = await getUserById(db, userId);
  if (!user) return notFound();
  const role = await getRoleById(db, body.roleId);
  if (!role) return notFound();
  if (role.name === SUPER_ADMIN_ROLE) {
    return forbidden('SuperAdmin chỉ được gán một lần duy nhất lúc /register-first.');
  }
  if (role.name === ADMIN_ROLE && !isSuperAdmin(session.roles)) {
    return forbidden('Chỉ SuperAdmin được cấp phát quyền Admin.');
  }
  await assignRole(db, userId, role.id);
  return json({ ok: true });
}

async function unassignUserRole(
  db: D1DatabaseLike,
  session: Session,
  userId: number,
  roleId: number
): Promise<DrystackResponse> {
  const role = await getRoleById(db, roleId);
  if (!role) return notFound();
  if (role.name === SUPER_ADMIN_ROLE) {
    return forbidden('Không thể gỡ role SuperAdmin.');
  }
  if (role.name === ADMIN_ROLE && !isSuperAdmin(session.roles)) {
    return forbidden('Chỉ SuperAdmin được gỡ quyền Admin.');
  }
  await unassignRole(db, userId, roleId);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// roles/*
// ---------------------------------------------------------------------------

async function listRolesWithCounts(db: D1DatabaseLike): Promise<DrystackResponse> {
  const roles = await listRoles(db);
  const withCounts = await Promise.all(
    roles.map(async role => publicRole(role, await countRoleUsers(db, role.id)))
  );
  return json(withCounts);
}

const createRoleSchema = s.object({ name: s.string() });

async function addRole(req: DrystackRequest, db: D1DatabaseLike): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), createRoleSchema);
  } catch {
    return badRequest();
  }
  const name = body.name.trim();
  if (!name) return badRequest('name-required');
  if (await getRoleByName(db, name)) {
    return json({ error: 'name-already-exists' }, 409);
  }
  const role = await createRole(db, name);
  return json(publicRole(role, 0));
}

function lockedRoleResponse() {
  return forbidden('SuperAdmin/Admin có toàn quyền mặc định, không cấu hình qua đây.');
}

const renameRoleSchema = s.object({ name: s.string() });

async function renameRoleRoute(
  req: DrystackRequest,
  db: D1DatabaseLike,
  roleId: number
): Promise<DrystackResponse> {
  const role = await getRoleById(db, roleId);
  if (!role) return notFound();
  if (role.name === SUPER_ADMIN_ROLE || role.name === ADMIN_ROLE) {
    return lockedRoleResponse();
  }
  let body;
  try {
    body = s.create(await req.json(), renameRoleSchema);
  } catch {
    return badRequest();
  }
  const name = body.name.trim();
  if (!name) return badRequest('name-required');
  const existing = await getRoleByName(db, name);
  if (existing && existing.id !== roleId) {
    return json({ error: 'name-already-exists' }, 409);
  }
  await renameRole(db, roleId, name);
  return json({ ok: true });
}

const updatePermissionsSchema = s.object({ permissions: s.array(s.string()) });

async function updateRolePermissionsRoute(
  req: DrystackRequest,
  db: D1DatabaseLike,
  roleId: number
): Promise<DrystackResponse> {
  const role = await getRoleById(db, roleId);
  if (!role) return notFound();
  if (role.name === SUPER_ADMIN_ROLE || role.name === ADMIN_ROLE) {
    return lockedRoleResponse();
  }
  let body;
  try {
    body = s.create(await req.json(), updatePermissionsSchema);
  } catch {
    return badRequest();
  }
  await updateRolePermissions(db, roleId, body.permissions);
  return json({ ok: true });
}

async function removeRole(db: D1DatabaseLike, roleId: number): Promise<DrystackResponse> {
  const role = await getRoleById(db, roleId);
  if (!role) return notFound();
  if (role.name === SUPER_ADMIN_ROLE || role.name === ADMIN_ROLE) {
    return lockedRoleResponse();
  }
  if ((await countRoleUsers(db, roleId)) > 0) {
    return forbidden('Vẫn còn user thuộc role này.');
  }
  await deleteRole(db, roleId);
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// profile/*
// ---------------------------------------------------------------------------

async function getProfile(db: D1DatabaseLike, session: Session): Promise<DrystackResponse> {
  const user = await getUserByEmail(db, session.email);
  if (!user) return notFound();
  const roles = await getRolesForUser(db, user.id);
  return json(publicUser(user, roles.map(r => r.name)));
}

const updateProfileSchema = s.object({
  name: s.optional(s.string()),
  phoneNumber: s.optional(s.string()),
  address: s.optional(s.string()),
});

async function updateProfile(
  req: DrystackRequest,
  db: D1DatabaseLike,
  session: Session
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), updateProfileSchema);
  } catch {
    return badRequest();
  }
  const user = await getUserByEmail(db, session.email);
  if (!user) return notFound();
  const update: Parameters<typeof updateUserProfile>[2] = {};
  if (body.name !== undefined) {
    if (!body.name.trim()) return badRequest('name-required');
    update.name = body.name.trim();
  }
  if (body.phoneNumber !== undefined) update.phone_number = body.phoneNumber;
  if (body.address !== undefined) update.address = body.address;
  await updateUserProfile(db, user.id, update);
  return json({ ok: true });
}

// image/* only, capped well under Workers' request body limits - matches the
// old (removed) implementation's `avatarInvalidTypeError`/
// `avatarTooLargeError` l10n keys, which this restores the server-side half
// of (client validates too, but a hand-crafted request must not bypass it).
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const uploadAvatarSchema = s.object({
  contents: s.string(),
  contentType: s.string(),
});

export const AVATAR_DIRECTORY = '_system/avatars';

function avatarExtension(contentType: string): string | null {
  switch (contentType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return null;
  }
}

async function uploadAvatar(
  req: DrystackRequest,
  db: D1DatabaseLike,
  session: Session,
  putAvatarObject: (path: string, contents: Uint8Array) => Promise<void>
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), uploadAvatarSchema);
  } catch {
    return badRequest();
  }
  if (!ALLOWED_AVATAR_TYPES.has(body.contentType)) {
    return json({ error: 'avatar-invalid-type' }, 400);
  }
  const ext = avatarExtension(body.contentType)!;
  let contents: Uint8Array;
  try {
    contents = Uint8Array.from(atob(body.contents), c => c.charCodeAt(0));
  } catch {
    return badRequest();
  }
  if (contents.byteLength > MAX_AVATAR_BYTES) {
    return json({ error: 'avatar-too-large' }, 400);
  }
  const user = await getUserByEmail(db, session.email);
  if (!user) return notFound();
  const path = `${AVATAR_DIRECTORY}/${user.id}.${ext}`;
  await putAvatarObject(path, contents);
  await updateUserProfile(db, user.id, { avatar: path });
  return json({ avatar: path });
}

const changePasswordSchema = s.object({
  oldPassword: s.string(),
  newPassword: s.string(),
});

async function changePassword(
  req: DrystackRequest,
  db: D1DatabaseLike,
  session: Session
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), changePasswordSchema);
  } catch {
    return badRequest();
  }
  if (body.newPassword.length < 8) {
    return json({ error: 'password-too-short' }, 400);
  }
  const user = await getUserByEmail(db, session.email);
  if (!user || !user.password) return notFound();
  if (!(await verifyPassword(body.oldPassword, user.password))) {
    return json({ error: 'invalid-current-password' }, 400);
  }
  await setPasswordAndConsumeToken(db, user.id, await hashPassword(body.newPassword));
  return json({ ok: true });
}

// ---------------------------------------------------------------------------
// password-setting / forgot-password (no session required - token-based)
// ---------------------------------------------------------------------------

const passwordSettingSchema = s.object({ token: s.string(), password: s.string() });

async function passwordSetting(
  req: DrystackRequest,
  db: D1DatabaseLike
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), passwordSettingSchema);
  } catch {
    return badRequest();
  }
  if (body.password.length < 8) {
    return json({ error: 'password-too-short' }, 400);
  }
  const user = await getUserByInviteToken(db, body.token);
  if (!user || !user.invite_token_exp || new Date(user.invite_token_exp) < new Date()) {
    return json({ error: 'invalid-or-expired-token' }, 400);
  }
  await setPasswordAndConsumeToken(db, user.id, await hashPassword(body.password));
  return json({ ok: true, email: user.email });
}

const forgotPasswordSchema = s.object({ email: s.string() });

async function forgotPassword(
  req: DrystackRequest,
  db: D1DatabaseLike,
  sendEmail: SendEmail | undefined
): Promise<DrystackResponse> {
  let body;
  try {
    body = s.create(await req.json(), forgotPasswordSchema);
  } catch {
    return badRequest();
  }
  // Always the same response whether the email exists or not - same
  // anti-enumeration principle as auth/login's badCredentials.
  const genericOk = json({ ok: true });
  const email = normalizeEmail(body.email);
  if (!email) return genericOk;
  const user = await getUserByEmail(db, email);
  if (!user || !user.active || !user.password) return genericOk;

  const token = newToken();
  await setInviteToken(db, user.id, token, hoursFromNow(RESET_TOKEN_TTL_HOURS));
  if (sendEmail) {
    await sendEmail({
      to: user.email,
      subject: 'Yêu cầu đặt lại mật khẩu',
      html: resetEmailHtml(passwordSettingLink(req, token)),
    }).catch(() => false);
  }
  return genericOk;
}

// ---------------------------------------------------------------------------
// dispatcher
// ---------------------------------------------------------------------------

export type UserManagementDeps = {
  db: D1DatabaseLike;
  session: () => Promise<Session | null>;
  sendEmail?: SendEmail;
  putAvatarObject: (path: string, contents: Uint8Array) => Promise<void>;
};

export async function userManagementRoutes(
  req: DrystackRequest,
  params: string[],
  deps: UserManagementDeps
): Promise<DrystackResponse> {
  const { db, session, sendEmail, putAvatarObject } = deps;
  const joined = params.join('/');

  // Reachable with no session at all, by design (mục 6/10).
  if (req.method === 'POST' && joined === 'password-setting') {
    return passwordSetting(req, db);
  }
  if (req.method === 'POST' && joined === 'forgot-password') {
    return forgotPassword(req, db, sendEmail);
  }

  if (params[0] === 'profile') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    if (req.method === 'GET' && params.length === 1) return getProfile(db, current);
    if (req.method === 'POST' && params.length === 1) return updateProfile(req, db, current);
    if (req.method === 'POST' && joined === 'profile/avatar') {
      return uploadAvatar(req, db, current, putAvatarObject);
    }
    if (req.method === 'POST' && joined === 'profile/password') {
      return changePassword(req, db, current);
    }
    return notFound();
  }

  if (params[0] === 'users') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    const denied = requireFullAccess(current);
    if (denied) return denied;

    if (req.method === 'GET' && params.length === 1) return listUsers(db);
    if (req.method === 'POST' && params.length === 1) return addUser(req, db, sendEmail);

    const userId = Number(params[1]);
    if (!Number.isInteger(userId)) return notFound();

    if (req.method === 'POST' && params[2] === 'resend-invite' && params.length === 3) {
      return resendInvite(req, db, userId, sendEmail);
    }
    if (req.method === 'POST' && params[2] === 'active' && params.length === 3) {
      return setActive(req, db, current, userId);
    }
    if (req.method === 'POST' && params[2] === 'delete' && params.length === 3) {
      return removeUser(db, current, userId);
    }
    if (req.method === 'POST' && params[2] === 'roles' && params.length === 3) {
      return assignUserRole(req, db, current, userId);
    }
    if (
      req.method === 'POST' &&
      params[2] === 'roles' &&
      params[4] === 'remove' &&
      params.length === 5
    ) {
      const roleId = Number(params[3]);
      if (!Number.isInteger(roleId)) return notFound();
      return unassignUserRole(db, current, userId, roleId);
    }
    return notFound();
  }

  if (params[0] === 'roles') {
    const current = await session();
    if (!current) return { status: 401, body: 'Not authorized' };
    const denied = requireFullAccess(current);
    if (denied) return denied;

    if (req.method === 'GET' && params.length === 1) return listRolesWithCounts(db);
    if (req.method === 'POST' && params.length === 1) return addRole(req, db);

    const roleId = Number(params[1]);
    if (!Number.isInteger(roleId)) return notFound();

    if (req.method === 'POST' && params[2] === 'rename' && params.length === 3) {
      return renameRoleRoute(req, db, roleId);
    }
    if (req.method === 'POST' && params[2] === 'permissions' && params.length === 3) {
      return updateRolePermissionsRoute(req, db, roleId);
    }
    if (req.method === 'POST' && params[2] === 'delete' && params.length === 3) {
      return removeRole(db, roleId);
    }
    return notFound();
  }

  return notFound();
}
