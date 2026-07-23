// A 401 from the local-shaped REST write route only ever means one thing: an
// r2-mode session expired (demo 403s instead, and never reaches this route
// via the admin UI). Bounce through /login - unsaved edits survive in
// IndexedDB (see persistence.tsx) and `from` brings the user straight back.
// Callers still throw right after for the non-401 cases.
export function redirectToNativeLoginIfUnauthorized(status: number) {
  if (status !== 401 || typeof location === "undefined") return;
  location.assign(
    `/login?from=${encodeURIComponent(location.pathname + location.search)}`
  );
}
