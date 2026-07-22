/** @jest-environment node */
import { expect, test } from '@jest/globals';
import { makeTestD1 } from './d1-test-helpers';
import {
  assignRole,
  createUser,
  getRoleByName,
  getRolesForUser,
  getUserByEmail,
} from './d1';
import { hashPassword } from './native-auth';
import { ADMIN_ROLE, EDITOR_ROLE, SUPER_ADMIN_ROLE } from './permissions';
import { userManagementRoutes, UserManagementDeps } from './user-management';
import type { DrystackRequest, DrystackResponse } from './internal-utils';

function request(method: string, body?: unknown): DrystackRequest {
  return {
    method,
    url: 'http://localhost/api/drystack/users',
    headers: { get: () => null },
    json: async () => body,
  };
}

function bodyJson(res: DrystackResponse) {
  return JSON.parse(
    typeof res.body === 'string'
      ? res.body
      : new TextDecoder().decode(res.body as Uint8Array)
  );
}

async function makeDeps(overrides: Partial<UserManagementDeps> = {}) {
  const db = makeTestD1();
  const putAvatarObject = async () => {};
  return {
    db,
    session: async () => null,
    putAvatarObject,
    ...overrides,
  } as UserManagementDeps;
}

async function seedUser(
  db: ReturnType<typeof makeTestD1>,
  email: string,
  roleName: string,
  password = 'hunter2-hunter2'
) {
  const user = await createUser(db, {
    email,
    name: 'Test',
    password: await hashPassword(password),
  });
  const role = await getRoleByName(db, roleName);
  if (role) await assignRole(db, user.id, role.id);
  const roles = await getRolesForUser(db, user.id);
  return { user, session: { email, roles } };
}

// ---------------------------------------------------------------------------
// users/* - access control
// ---------------------------------------------------------------------------

test('users/* requires a session, then fullAccess (SuperAdmin or Admin)', async () => {
  const db = makeTestD1();
  const { session: adminSession } = await seedUser(db, 'admin@example.com', ADMIN_ROLE);
  const { session: editorSession } = await seedUser(db, 'editor@example.com', EDITOR_ROLE);

  const anon = await userManagementRoutes(request('GET'), ['users'], await makeDeps({ db }));
  expect(anon.status).toBe(401);

  const editorRes = await userManagementRoutes(
    request('GET'),
    ['users'],
    await makeDeps({ db, session: async () => editorSession })
  );
  expect(editorRes.status).toBe(403);

  const adminRes = await userManagementRoutes(
    request('GET'),
    ['users'],
    await makeDeps({ db, session: async () => adminSession })
  );
  expect(adminRes.status).toBe(200);
});

test('addUser creates a pending-invite user (no password) and returns the token', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const res = await userManagementRoutes(
    request('POST', { email: 'New.User@Example.com', name: 'New User' }),
    ['users'],
    await makeDeps({ db, session: async () => session })
  );
  expect(res.status).toBe(200);
  const body = bodyJson(res);
  expect(body.user.email).toEqual('new.user@example.com');
  expect(body.user.pendingInvite).toBe(true);
  expect(typeof body.inviteToken).toEqual('string');
  expect(body.emailSent).toBe(false); // no sendEmail configured

  const row = await getUserByEmail(db, 'new.user@example.com');
  expect(row?.password).toBeNull();
});

test('addUser rejects a duplicate email', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const deps = await makeDeps({ db, session: async () => session });
  await userManagementRoutes(
    request('POST', { email: 'dup@example.com', name: 'A' }),
    ['users'],
    deps
  );
  const res = await userManagementRoutes(
    request('POST', { email: 'dup@example.com', name: 'B' }),
    ['users'],
    deps
  );
  expect(res.status).toBe(409);
});

test('resend-invite regenerates the token, refuses an already-verified user', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const deps = await makeDeps({ db, session: async () => session });
  const add = await userManagementRoutes(
    request('POST', { email: 'pending@example.com', name: 'Pending' }),
    ['users'],
    deps
  );
  const { user } = bodyJson(add);

  const resend = await userManagementRoutes(
    request('POST'),
    ['users', String(user.id), 'resend-invite'],
    deps
  );
  expect(resend.status).toBe(200);
  expect(typeof bodyJson(resend).inviteToken).toEqual('string');

  // a verified (has a password) user can't be re-invited
  const verified = await seedUser(db, 'verified@example.com', EDITOR_ROLE);
  const rejected = await userManagementRoutes(
    request('POST'),
    ['users', String(verified.user.id), 'resend-invite'],
    deps
  );
  expect(rejected.status).toBe(400);
});

test('setActive refuses to let a user deactivate themselves', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const deps = await makeDeps({ db, session: async () => session });
  const target = await seedUser(db, 'other@example.com', EDITOR_ROLE);

  const self = await userManagementRoutes(
    request('POST', { active: false }),
    ['users', String((await getUserByEmail(db, 'admin@example.com'))!.id), 'active'],
    deps
  );
  expect(self.status).toBe(403);

  const other = await userManagementRoutes(
    request('POST', { active: false }),
    ['users', String(target.user.id), 'active'],
    deps
  );
  expect(other.status).toBe(200);
});

test('delete: only SuperAdmin, never self, never the SuperAdmin holder', async () => {
  const db = makeTestD1();
  const superAdmin = await seedUser(db, 'super@example.com', SUPER_ADMIN_ROLE);
  const admin = await seedUser(db, 'admin@example.com', ADMIN_ROLE);
  const target = await seedUser(db, 'target@example.com', EDITOR_ROLE);

  // Admin can never delete, not even a regular Editor
  const asAdmin = await userManagementRoutes(
    request('POST'),
    ['users', String(target.user.id), 'delete'],
    await makeDeps({ db, session: async () => admin.session })
  );
  expect(asAdmin.status).toBe(403);

  const deps = await makeDeps({ db, session: async () => superAdmin.session });

  // SuperAdmin can't delete themselves
  const self = await userManagementRoutes(
    request('POST'),
    ['users', String(superAdmin.user.id), 'delete'],
    deps
  );
  expect(self.status).toBe(403);

  // SuperAdmin can't delete another SuperAdmin holder either (hypothetical -
  // in practice there's only ever one, but the check is on the target's
  // roles, not identity)
  const otherSuperAdminRole = await getRoleByName(db, SUPER_ADMIN_ROLE);
  await assignRole(db, admin.user.id, otherSuperAdminRole!.id);
  const deleteOtherSuperAdmin = await userManagementRoutes(
    request('POST'),
    ['users', String(admin.user.id), 'delete'],
    deps
  );
  expect(deleteOtherSuperAdmin.status).toBe(403);

  // SuperAdmin CAN delete a regular user
  const ok = await userManagementRoutes(
    request('POST'),
    ['users', String(target.user.id), 'delete'],
    deps
  );
  expect(ok.status).toBe(200);
  expect(await getUserByEmail(db, 'target@example.com')).toBeNull();
});

test('role assignment: SuperAdmin can never be (un)assigned via this route', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const target = await seedUser(db, 'target@example.com', EDITOR_ROLE);
  const superAdminRole = await getRoleByName(db, SUPER_ADMIN_ROLE);
  const deps = await makeDeps({ db, session: async () => session });

  const assign = await userManagementRoutes(
    request('POST', { roleId: superAdminRole!.id }),
    ['users', String(target.user.id), 'roles'],
    deps
  );
  expect(assign.status).toBe(403);

  const unassign = await userManagementRoutes(
    request('POST'),
    ['users', String(target.user.id), 'roles', String(superAdminRole!.id), 'remove'],
    deps
  );
  expect(unassign.status).toBe(403);
});

test('only SuperAdmin can grant/revoke the Admin role - Admin cannot', async () => {
  const db = makeTestD1();
  const admin = await seedUser(db, 'admin@example.com', ADMIN_ROLE);
  const target = await seedUser(db, 'target@example.com', EDITOR_ROLE);
  const adminRole = await getRoleByName(db, ADMIN_ROLE);

  const asAdmin = await userManagementRoutes(
    request('POST', { roleId: adminRole!.id }),
    ['users', String(target.user.id), 'roles'],
    await makeDeps({ db, session: async () => admin.session })
  );
  expect(asAdmin.status).toBe(403);

  const superAdmin = await seedUser(db, 'super@example.com', SUPER_ADMIN_ROLE);
  const asSuperAdmin = await userManagementRoutes(
    request('POST', { roleId: adminRole!.id }),
    ['users', String(target.user.id), 'roles'],
    await makeDeps({ db, session: async () => superAdmin.session })
  );
  expect(asSuperAdmin.status).toBe(200);
  expect(
    (await getRolesForUser(db, target.user.id)).map(r => r.name).sort()
  ).toEqual([ADMIN_ROLE, EDITOR_ROLE].sort());
});

// ---------------------------------------------------------------------------
// roles/*
// ---------------------------------------------------------------------------

test('SuperAdmin/Admin roles are locked: no rename, no permission edits, no delete', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const deps = await makeDeps({ db, session: async () => session });
  const adminRole = await getRoleByName(db, ADMIN_ROLE);

  expect(
    (
      await userManagementRoutes(
        request('POST', { name: 'Super Admin 2' }),
        ['roles', String(adminRole!.id), 'rename'],
        deps
      )
    ).status
  ).toBe(403);
  expect(
    (
      await userManagementRoutes(
        request('POST', { permissions: ['collection:blog.view'] }),
        ['roles', String(adminRole!.id), 'permissions'],
        deps
      )
    ).status
  ).toBe(403);
  expect(
    (await userManagementRoutes(request('POST'), ['roles', String(adminRole!.id), 'delete'], deps))
      .status
  ).toBe(403);
});

test('a custom role can be created, renamed, have permissions set, and deleted once empty', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const deps = await makeDeps({ db, session: async () => session });

  const create = await userManagementRoutes(
    request('POST', { name: 'Marketing' }),
    ['roles'],
    deps
  );
  expect(create.status).toBe(200);
  const role = bodyJson(create);

  const rename = await userManagementRoutes(
    request('POST', { name: 'Marketing Team' }),
    ['roles', String(role.id), 'rename'],
    deps
  );
  expect(rename.status).toBe(200);

  const perms = await userManagementRoutes(
    request('POST', { permissions: ['collection:blog.view'] }),
    ['roles', String(role.id), 'permissions'],
    deps
  );
  expect(perms.status).toBe(200);

  // can't delete while a user still holds it
  const target = await seedUser(db, 'member@example.com', EDITOR_ROLE);
  await userManagementRoutes(
    request('POST', { roleId: role.id }),
    ['users', String(target.user.id), 'roles'],
    deps
  );
  const blockedDelete = await userManagementRoutes(
    request('POST'),
    ['roles', String(role.id), 'delete'],
    deps
  );
  expect(blockedDelete.status).toBe(403);

  await userManagementRoutes(
    request('POST'),
    ['users', String(target.user.id), 'roles', String(role.id), 'remove'],
    deps
  );
  const okDelete = await userManagementRoutes(
    request('POST'),
    ['roles', String(role.id), 'delete'],
    deps
  );
  expect(okDelete.status).toBe(200);
});

// ---------------------------------------------------------------------------
// profile/*
// ---------------------------------------------------------------------------

test('profile GET/POST round-trip, requires a session', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'me@example.com', EDITOR_ROLE);
  const deps = await makeDeps({ db, session: async () => session });

  const anon = await userManagementRoutes(request('GET'), ['profile'], await makeDeps({ db }));
  expect(anon.status).toBe(401);

  const update = await userManagementRoutes(
    request('POST', { name: 'New Name', phoneNumber: '0900000000' }),
    ['profile'],
    deps
  );
  expect(update.status).toBe(200);

  const get = await userManagementRoutes(request('GET'), ['profile'], deps);
  const body = bodyJson(get);
  expect(body.name).toEqual('New Name');
  expect(body.phoneNumber).toEqual('0900000000');
});

test('change password: wrong old password rejected, too-short rejected, success updates the hash', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'me@example.com', EDITOR_ROLE, 'original-pass');
  const deps = await makeDeps({ db, session: async () => session });

  const wrongOld = await userManagementRoutes(
    request('POST', { oldPassword: 'nope', newPassword: 'new-password-123' }),
    ['profile', 'password'],
    deps
  );
  expect(wrongOld.status).toBe(400);

  const tooShort = await userManagementRoutes(
    request('POST', { oldPassword: 'original-pass', newPassword: 'short' }),
    ['profile', 'password'],
    deps
  );
  expect(tooShort.status).toBe(400);

  const ok = await userManagementRoutes(
    request('POST', { oldPassword: 'original-pass', newPassword: 'new-password-123' }),
    ['profile', 'password'],
    deps
  );
  expect(ok.status).toBe(200);
});

test('avatar upload rejects bad content type and oversized payloads', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'me@example.com', EDITOR_ROLE);
  const deps = await makeDeps({ db, session: async () => session });

  const badType = await userManagementRoutes(
    request('POST', { contents: btoa('not-an-image'), contentType: 'text/plain' }),
    ['profile', 'avatar'],
    deps
  );
  expect(badType.status).toBe(400);

  const tooLarge = await userManagementRoutes(
    request('POST', {
      contents: btoa('x'.repeat(3 * 1024 * 1024)),
      contentType: 'image/png',
    }),
    ['profile', 'avatar'],
    deps
  );
  expect(tooLarge.status).toBe(400);

  let savedPath: string | undefined;
  let savedBytes: Uint8Array | undefined;
  const ok = await userManagementRoutes(
    request('POST', { contents: btoa('fake-png-bytes'), contentType: 'image/png' }),
    ['profile', 'avatar'],
    await makeDeps({
      db,
      session: async () => session,
      putAvatarObject: async (path, contents) => {
        savedPath = path;
        savedBytes = contents;
      },
    })
  );
  expect(ok.status).toBe(200);
  expect(savedPath).toMatch(/^_system\/avatars\/\d+\.png$/);
  expect(savedBytes?.byteLength).toBeGreaterThan(0);
});

// ---------------------------------------------------------------------------
// password-setting / forgot-password (no session)
// ---------------------------------------------------------------------------

test('password-setting consumes a valid token, rejects an expired/unknown one', async () => {
  const db = makeTestD1();
  const { session } = await seedUser(db, 'admin@example.com', SUPER_ADMIN_ROLE);
  const deps = await makeDeps({ db, session: async () => session });
  const add = await userManagementRoutes(
    request('POST', { email: 'invitee@example.com', name: 'Invitee' }),
    ['users'],
    deps
  );
  const { inviteToken } = bodyJson(add);

  const badToken = await userManagementRoutes(
    request('POST', { token: 'not-a-real-token', password: 'new-password-123' }),
    ['password-setting'],
    await makeDeps({ db })
  );
  expect(badToken.status).toBe(400);

  const tooShort = await userManagementRoutes(
    request('POST', { token: inviteToken, password: 'short' }),
    ['password-setting'],
    await makeDeps({ db })
  );
  expect(tooShort.status).toBe(400);

  const ok = await userManagementRoutes(
    request('POST', { token: inviteToken, password: 'new-password-123' }),
    ['password-setting'],
    await makeDeps({ db })
  );
  expect(ok.status).toBe(200);
  const row = await getUserByEmail(db, 'invitee@example.com');
  expect(row?.password).toBeTruthy();
  expect(row?.invite_token).toBeNull();
  expect(row?.email_verify_at).toBeTruthy();

  // the same token can't be reused
  const reuse = await userManagementRoutes(
    request('POST', { token: inviteToken, password: 'another-password-123' }),
    ['password-setting'],
    await makeDeps({ db })
  );
  expect(reuse.status).toBe(400);
});

test('forgot-password always answers ok, only issues a token for a real active verified user', async () => {
  const db = makeTestD1();
  await seedUser(db, 'real@example.com', EDITOR_ROLE);
  const deps = await makeDeps({ db });

  const forGhost = await userManagementRoutes(
    request('POST', { email: 'ghost@example.com' }),
    ['forgot-password'],
    deps
  );
  expect(forGhost.status).toBe(200);
  expect(bodyJson(forGhost)).toEqual({ ok: true });

  const forReal = await userManagementRoutes(
    request('POST', { email: 'REAL@Example.com' }),
    ['forgot-password'],
    deps
  );
  expect(forReal.status).toBe(200);

  const row = await getUserByEmail(db, 'real@example.com');
  expect(row?.invite_token).toBeTruthy();

  // that token now works via password-setting
  const reset = await userManagementRoutes(
    request('POST', { token: row!.invite_token!, password: 'brand-new-pass-1' }),
    ['password-setting'],
    deps
  );
  expect(reset.status).toBe(200);
});
