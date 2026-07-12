import { parse } from 'cookie';
import { Config } from '../config';

export function getSyncAuth(config: Config) {
  if (typeof document === 'undefined') {
    return null;
  }
  if (config.storage.kind === 'github') {
    const cookies = parse(document.cookie);
    const accessToken = cookies['drystack-gh-access-token'];
    if (!accessToken) {
      return null;
    }
    return { accessToken };
  }
  return null;
}

let _refreshTokenPromise: Promise<{ accessToken: string } | null> | undefined;

export async function getAuth(config: Config, basePath: string) {
  const token = getSyncAuth(config);

  if (config.storage.kind === 'github' && !token) {
    if (!_refreshTokenPromise) {
      _refreshTokenPromise = (async () => {
        try {
          const res = await fetch(`/api${basePath}/github/refresh-token`, {
            method: 'POST',
          });
          if (res.status === 200) {
            const cookies = parse(document.cookie);
            const accessToken = cookies['drystack-gh-access-token'];
            if (accessToken) {
              return { accessToken };
            }
          }
        } catch {
        } finally {
          _refreshTokenPromise = undefined;
        }
        return null;
      })();
    }
    return _refreshTokenPromise;
  }
  return token;
}
