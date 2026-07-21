import { ReactNode, createContext, useContext, useEffect, useState } from 'react';
import { R2Config } from '../config';
import { useRouter } from './router';

// The signed-in identity for `storage: { kind: 'r2' }` (see plan/auth.md).
// github mode gets this for free from the GitHub GraphQL viewer query (see
// shell/viewer-data.ts's ViewerContext) - r2 has no such query, so this is a
// small one-shot fetch of `auth/me` instead, mirrored into a context so the
// sidebar (UserActions) can render the email/logout without every consumer
// re-fetching.
export type NativeUser = { email: string; profile: unknown };

// undefined = still loading, null = fetch failed/unauthenticated (shouldn't
// normally happen - the page itself is gated server-side before this ever
// mounts, see drystack-astro-page.astro).
const NativeUserContext = createContext<NativeUser | null | undefined>(
  undefined
);

export function useNativeUser() {
  return useContext(NativeUserContext);
}

export function NativeUserProvider(props: {
  config: R2Config;
  children: ReactNode;
}) {
  const { basePath } = useRouter();
  const [user, setUser] = useState<NativeUser | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    fetch(`/api${basePath}/auth/me`)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (active) setUser(data);
      })
      .catch(() => {
        if (active) setUser(null);
      });
    return () => {
      active = false;
    };
  }, [basePath]);

  return (
    <NativeUserContext.Provider value={user}>
      {props.children}
    </NativeUserContext.Provider>
  );
}

// Revokes the session server-side (see api-r2.ts's jti blacklist) before
// bouncing to /login - a plain cookie-clear alone would leave the token
// usable by anyone who'd copied it until it naturally expired.
export async function nativeLogout(basePath: string) {
  try {
    await fetch(`/api${basePath}/auth/logout`, { method: 'POST' });
  } catch {
    // Best-effort - even if the network call fails, still send the user to
    // /login; a stale local cookie just means the next request re-auths.
  }
  location.assign('/login');
}
