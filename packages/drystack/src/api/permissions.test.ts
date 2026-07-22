/** @jest-environment node */
import { expect, test } from '@jest/globals';
import {
  ADMIN_ROLE,
  EDITOR_ROLE,
  SUPER_ADMIN_ROLE,
  collectionPermission,
  effectivePermissions,
  hasPermission,
  isAdmin,
  isSuperAdmin,
  singletonPermission,
} from './permissions';

test('collectionPermission/singletonPermission build the dotted strings', () => {
  expect(collectionPermission('blog', 'view')).toEqual('collection:blog.view');
  expect(singletonPermission('demo', 'created')).toEqual('singleton:demo.created');
});

test('SuperAdmin and Admin have every permission, regardless of stored permissions', () => {
  const superAdmin = [{ name: SUPER_ADMIN_ROLE, permissions: '[]' }];
  const admin = [{ name: ADMIN_ROLE, permissions: '[]' }];
  expect(hasPermission(superAdmin, 'collection:blog.deleted')).toBe(true);
  expect(hasPermission(admin, 'singleton:demo.magicWriter')).toBe(true);
  expect(isSuperAdmin(superAdmin)).toBe(true);
  expect(isAdmin(admin)).toBe(true);
  expect(isSuperAdmin(admin)).toBe(false);
});

test('Editor (or any custom role) only has explicitly listed permissions', () => {
  const editor = [
    { name: EDITOR_ROLE, permissions: JSON.stringify(['collection:blog.view']) },
  ];
  expect(hasPermission(editor, 'collection:blog.view')).toBe(true);
  expect(hasPermission(editor, 'collection:blog.deleted')).toBe(false);
  expect(hasPermission(editor, 'singleton:demo.view')).toBe(false);
});

test('effective permission is the union across every role a user holds', () => {
  const roles = [
    { name: 'A', permissions: JSON.stringify(['collection:blog.view']) },
    { name: 'B', permissions: JSON.stringify(['collection:blog.updated']) },
  ];
  expect(hasPermission(roles, 'collection:blog.view')).toBe(true);
  expect(hasPermission(roles, 'collection:blog.updated')).toBe(true);
  expect(hasPermission(roles, 'collection:blog.deleted')).toBe(false);
  expect(effectivePermissions(roles)).toEqual(
    new Set(['collection:blog.view', 'collection:blog.updated'])
  );
});

test('a user with no roles has no permissions', () => {
  expect(hasPermission([], 'collection:blog.view')).toBe(false);
  expect(effectivePermissions([])).toEqual(new Set());
});

test('malformed stored permissions JSON is treated as empty, not a crash', () => {
  const broken = [{ name: 'Broken', permissions: 'not json' }];
  expect(hasPermission(broken, 'collection:blog.view')).toBe(false);
  expect(effectivePermissions(broken)).toEqual(new Set());

  const notAnArray = [{ name: 'Broken2', permissions: '{"a":1}' }];
  expect(hasPermission(notAnArray, 'collection:blog.view')).toBe(false);
});
