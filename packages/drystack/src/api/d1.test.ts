/** @jest-environment node */
import { expect, test } from '@jest/globals';
import { makeTestD1 } from './d1-test-helpers';
import {
  assignRole,
  countRoleUsers,
  countUsers,
  createRole,
  createUser,
  deleteRole,
  deleteUser,
  getActiveSessionUser,
  getRoleByName,
  getRolesForUser,
  getUserByEmail,
  getUserByInviteToken,
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

test('migrations seed SuperAdmin/Admin/Editor as builtin roles with no users', async () => {
  const db = makeTestD1();
  const roles = await listRoles(db);
  expect(roles.map(r => r.name)).toEqual(['SuperAdmin', 'Admin', 'Editor']);
  expect(roles.every(r => r.is_builtin === 1)).toBe(true);
  for (const role of roles) {
    expect(await countRoleUsers(db, role.id)).toBe(0);
  }
  expect(await countUsers(db)).toBe(0);
});

test('createUser + getUserByEmail round-trip, email is unique', async () => {
  const db = makeTestD1();
  const created = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  expect(created.id).toBeGreaterThan(0);
  expect(created.password).toBeNull();
  expect(created.active).toBe(1);

  const found = await getUserByEmail(db, 'a@example.com');
  expect(found?.name).toEqual('Alice');

  await expect(createUser(db, { email: 'a@example.com', name: 'Dup' })).rejects
    .toBeTruthy();
});

test('setInviteToken + getUserByInviteToken, then setPasswordAndConsumeToken clears it', async () => {
  const db = makeTestD1();
  const user = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  await setInviteToken(db, user.id, 'tok123', '2099-01-01T00:00:00.000Z');

  const byToken = await getUserByInviteToken(db, 'tok123');
  expect(byToken?.id).toEqual(user.id);
  expect(await getUserByInviteToken(db, 'nope')).toBeNull();

  await setPasswordAndConsumeToken(db, user.id, 'pbkdf2$sha256$...');
  const after = await getUserByEmail(db, 'a@example.com');
  expect(after?.password).toEqual('pbkdf2$sha256$...');
  expect(after?.invite_token).toBeNull();
  expect(after?.email_verify_at).toBeTruthy();

  // a second call doesn't clobber the first verify timestamp
  const firstVerifyAt = after!.email_verify_at;
  await setPasswordAndConsumeToken(db, user.id, 'pbkdf2$sha256$new');
  const again = await getUserByEmail(db, 'a@example.com');
  expect(again?.email_verify_at).toEqual(firstVerifyAt);
});

test('updateUserProfile only touches the given fields', async () => {
  const db = makeTestD1();
  const user = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  await updateUserProfile(db, user.id, { phone_number: '0900000000' });
  const after = await getUserByEmail(db, 'a@example.com');
  expect(after?.name).toEqual('Alice');
  expect(after?.phone_number).toEqual('0900000000');
});

test('setUserActive gates getActiveSessionUser', async () => {
  const db = makeTestD1();
  const user = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  expect((await getActiveSessionUser(db, 'a@example.com'))?.user.id).toEqual(user.id);

  await setUserActive(db, user.id, false);
  expect(await getActiveSessionUser(db, 'a@example.com')).toBeNull();

  await setUserActive(db, user.id, true);
  expect((await getActiveSessionUser(db, 'a@example.com'))?.user.id).toEqual(user.id);
});

test('getActiveSessionUser returns null for an unknown email', async () => {
  const db = makeTestD1();
  expect(await getActiveSessionUser(db, 'ghost@example.com')).toBeNull();
});

test('deleteUser removes the row', async () => {
  const db = makeTestD1();
  const user = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  await deleteUser(db, user.id);
  expect(await getUserByEmail(db, 'a@example.com')).toBeNull();
});

test('role CRUD: create, rename, update permissions, delete', async () => {
  const db = makeTestD1();
  const role = await createRole(db, 'Marketing');
  expect(role.permissions).toEqual('[]');
  expect(role.is_builtin).toBe(0);

  await renameRole(db, role.id, 'Marketing Team');
  expect((await getRoleByName(db, 'Marketing Team'))?.id).toEqual(role.id);

  await updateRolePermissions(db, role.id, ['collection:blog.view']);
  const updated = await getRoleByName(db, 'Marketing Team');
  expect(JSON.parse(updated!.permissions)).toEqual(['collection:blog.view']);

  await deleteRole(db, role.id);
  expect(await getRoleByName(db, 'Marketing Team')).toBeNull();
});

test('assignRole/unassignRole/getRolesForUser, and multi-role union', async () => {
  const db = makeTestD1();
  const user = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  const editor = await getRoleByName(db, 'Editor');
  const marketing = await createRole(db, 'Marketing');

  await assignRole(db, user.id, editor!.id);
  await assignRole(db, user.id, marketing.id);
  // assigning the same role twice is a harmless no-op (INSERT OR IGNORE)
  await assignRole(db, user.id, editor!.id);

  const roles = await getRolesForUser(db, user.id);
  expect(roles.map(r => r.name).sort()).toEqual(['Editor', 'Marketing']);
  expect(await countRoleUsers(db, editor!.id)).toBe(1);

  await unassignRole(db, user.id, marketing.id);
  expect((await getRolesForUser(db, user.id)).map(r => r.name)).toEqual(['Editor']);
});

test('deleting a role cascades out of user_role (ON DELETE CASCADE)', async () => {
  const db = makeTestD1();
  const user = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  const marketing = await createRole(db, 'Marketing');
  await assignRole(db, user.id, marketing.id);
  await deleteRole(db, marketing.id);
  expect(await getRolesForUser(db, user.id)).toEqual([]);
});

test('listUsersWithRoleNames attaches each user their role names', async () => {
  const db = makeTestD1();
  const alice = await createUser(db, { email: 'a@example.com', name: 'Alice' });
  const bob = await createUser(db, { email: 'b@example.com', name: 'Bob' });
  const editor = await getRoleByName(db, 'Editor');
  await assignRole(db, alice.id, editor!.id);

  const rows = await listUsersWithRoleNames(db);
  const byEmail = new Map(rows.map(r => [r.email, r]));
  expect(byEmail.get('a@example.com')?.roleNames).toEqual(['Editor']);
  expect(byEmail.get('b@example.com')?.roleNames).toEqual([]);
  expect(byEmail.size).toBe(2);
  void bob;
});
