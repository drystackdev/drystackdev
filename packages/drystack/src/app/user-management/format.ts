export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString();
}

// Avatars live outside the content tree (no git blob sha to pin against),
// so they're served through the dedicated `avatar/*` route rather than the
// generic `blob/<sha>/*` one - see avatarBlob in api-r2.ts.
export function avatarUrl(basePath: string, path: string): string {
  return `/api${basePath}/avatar/${path}`;
}
