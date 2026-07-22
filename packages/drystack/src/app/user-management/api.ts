// Thin fetch wrappers over user-management.ts's routes (see
// plan/user-managent.md). Every call is same-origin (cookies ride along
// automatically) - no auth header plumbing needed, matching the rest of the
// admin app's REST calls.

export type PublicUser = {
  id: number;
  email: string;
  name: string;
  avatar: string | null;
  phoneNumber: string | null;
  address: string | null;
  emailVerifyAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  pendingInvite: boolean;
  roles: string[];
};

export type PublicRole = {
  id: number;
  name: string;
  permissions: string[];
  isBuiltin: boolean;
  isLocked: boolean;
  userCount: number;
};

export class ApiError extends Error {
  status: number;
  code?: string;
  constructor(status: number, code?: string) {
    super(code ?? `request-failed-${status}`);
    this.status = status;
    this.code = code;
  }
}

async function call<T>(
  apiBase: string,
  path: string,
  init?: { method?: string; body?: unknown }
): Promise<T> {
  const res = await fetch(`${apiBase}/${path}`, {
    method: init?.method ?? (init?.body !== undefined ? 'POST' : 'GET'),
    headers: init?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(res.status, body?.error);
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export function makeUserManagementApi(basePath: string) {
  const apiBase = `/api${basePath}`;
  return {
    listUsers: () => call<PublicUser[]>(apiBase, 'users'),
    addUser: (data: { email: string; name: string; phoneNumber?: string; address?: string }) =>
      call<{ user: PublicUser; inviteToken: string; emailSent: boolean }>(apiBase, 'users', {
        body: data,
      }),
    resendInvite: (userId: number) =>
      call<{ inviteToken: string; emailSent: boolean }>(apiBase, `users/${userId}/resend-invite`, {
        body: {},
      }),
    setUserActive: (userId: number, active: boolean) =>
      call<{ ok: true }>(apiBase, `users/${userId}/active`, { body: { active } }),
    deleteUser: (userId: number) =>
      call<{ ok: true }>(apiBase, `users/${userId}/delete`, { body: {} }),
    assignRole: (userId: number, roleId: number) =>
      call<{ ok: true }>(apiBase, `users/${userId}/roles`, { body: { roleId } }),
    unassignRole: (userId: number, roleId: number) =>
      call<{ ok: true }>(apiBase, `users/${userId}/roles/${roleId}/remove`, { body: {} }),

    listRoles: () => call<PublicRole[]>(apiBase, 'roles'),
    createRole: (name: string) => call<PublicRole>(apiBase, 'roles', { body: { name } }),
    renameRole: (roleId: number, name: string) =>
      call<{ ok: true }>(apiBase, `roles/${roleId}/rename`, { body: { name } }),
    updateRolePermissions: (roleId: number, permissions: string[]) =>
      call<{ ok: true }>(apiBase, `roles/${roleId}/permissions`, { body: { permissions } }),
    deleteRole: (roleId: number) =>
      call<{ ok: true }>(apiBase, `roles/${roleId}/delete`, { body: {} }),

    getProfile: () => call<PublicUser>(apiBase, 'profile'),
    updateProfile: (data: { name?: string; phoneNumber?: string; address?: string }) =>
      call<{ ok: true }>(apiBase, 'profile', { body: data }),
    uploadAvatar: (contents: string, contentType: string) =>
      call<{ avatar: string }>(apiBase, 'profile/avatar', { body: { contents, contentType } }),
    changePassword: (oldPassword: string, newPassword: string) =>
      call<{ ok: true }>(apiBase, 'profile/password', { body: { oldPassword, newPassword } }),
  };
}

export type UserManagementApi = ReturnType<typeof makeUserManagementApi>;

// A File's bytes as a bare base64 string (no `data:...;base64,` prefix) -
// what uploadAvatar's `contents` field expects, matching the server's
// `atob(...)` decode in user-management.ts.
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(',') + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
