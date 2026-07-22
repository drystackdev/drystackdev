import { RoleRow } from './d1';

// Permission model for storage:{kind:'r2'} (plan/user-managent.md mục 4).
// Pure/no I/O on purpose - the D1 lookups that produce a user's RoleRow[]
// live in d1.ts; this module only ever reasons about role objects already
// in hand, so it's cheap to unit test without a database.

export type PermissionAction =
  | 'view'
  | 'created'
  | 'updated'
  | 'magicWriter'
  | 'deleted';

export function collectionPermission(
  key: string,
  action: PermissionAction
): string {
  return `collection:${key}.${action}`;
}

export function singletonPermission(
  key: string,
  action: PermissionAction
): string {
  return `singleton:${key}.${action}`;
}

// Built-in role names - never renamable/deletable (SuperAdmin/Admin) or
// assignable outside the one-time /register-first bootstrap (SuperAdmin).
export const SUPER_ADMIN_ROLE = 'SuperAdmin';
export const ADMIN_ROLE = 'Admin';
export const EDITOR_ROLE = 'Editor';
export const BUILTIN_ROLE_NAMES = [SUPER_ADMIN_ROLE, ADMIN_ROLE, EDITOR_ROLE];

export function isSuperAdmin(roles: Pick<RoleRow, 'name'>[]): boolean {
  return roles.some(r => r.name === SUPER_ADMIN_ROLE);
}

export function isAdmin(roles: Pick<RoleRow, 'name'>[]): boolean {
  return roles.some(r => r.name === ADMIN_ROLE);
}

// SuperAdmin/Admin have every permission by construction - hardcoded here
// rather than stored as permission strings, so the config-permission page
// never needs to (and never lets you) edit them. See plan mục 4.
function hasFullAccess(roles: Pick<RoleRow, 'name'>[]): boolean {
  return isSuperAdmin(roles) || isAdmin(roles);
}

function parsePermissions(permissions: string): string[] {
  try {
    const parsed = JSON.parse(permissions);
    return Array.isArray(parsed) ? parsed.filter(p => typeof p === 'string') : [];
  } catch {
    return [];
  }
}

// Effective permission = union across every role the user holds (multi-role,
// see plan mục 0/4).
export function hasPermission(
  roles: Pick<RoleRow, 'name' | 'permissions'>[],
  permission: string
): boolean {
  if (hasFullAccess(roles)) return true;
  for (const role of roles) {
    if (parsePermissions(role.permissions).includes(permission)) return true;
  }
  return false;
}

export function effectivePermissions(
  roles: Pick<RoleRow, 'name' | 'permissions'>[]
): Set<string> {
  const set = new Set<string>();
  for (const role of roles) {
    for (const permission of parsePermissions(role.permissions)) {
      set.add(permission);
    }
  }
  return set;
}
