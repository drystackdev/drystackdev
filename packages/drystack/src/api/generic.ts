import * as cookie from 'cookie';
import * as s from 'superstruct';
import { Config } from '..';
import {
  DrystackResponse,
  DrystackRequest,
  redirect,
} from './internal-utils';
import { handleGitHubAppCreation, localModeApiHandler } from '#api-handler';
import { webcrypto } from '#webcrypto';
import { bytesToHex } from '../hex';
import { decryptValue, encryptValue } from './encryption';

export type APIRouteConfig = {
  /** @default process.env.DRYSTACK_GITHUB_CLIENT_ID */
  clientId?: string;
  /** @default process.env.DRYSTACK_GITHUB_CLIENT_SECRET */
  clientSecret?: string;
  /** @default process.env.DRYSTACK_SECRET */
  secret?: string;
  localBaseDirectory?: string;
  config: Config<any, any>;
  /**
   * The path segment the drystack UI and API routes are mounted at, without slashes.
   * e.g. 'admin' mounts the UI at /admin and the API at /api/admin.
   * @default 'drystack'
   */
  basePath?: string;
};

type InnerAPIRouteConfig = {
  clientId: string;
  clientSecret: string;
  secret: string;
  config: Config;
  uiBasePath: string;
  apiBasePath: string;
};

const drystackRouteRegex =
  /^branch\/[^]+(\/collection\/[^/]+(|\/(create|item\/[^/]+))|\/singleton\/[^/]+)?$/;

function tryOrUndefined<T>(fn: () => T) {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

export function makeGenericAPIRouteHandler(
  _config: APIRouteConfig,
  options?: { slugEnvName?: string }
) {
  const _config2: APIRouteConfig = {
    clientId:
      _config.clientId ??
      tryOrUndefined(() => process.env.DRYSTACK_GITHUB_CLIENT_ID),
    clientSecret:
      _config.clientSecret ??
      tryOrUndefined(() => process.env.DRYSTACK_GITHUB_CLIENT_SECRET),
    secret:
      _config.secret ?? tryOrUndefined(() => process.env.DRYSTACK_SECRET),
    config: _config.config,
    basePath: _config.basePath,
  };

  const rawBasePath = (_config2.basePath ?? 'drystack').replace(
    /^\/+|\/+$/g,
    ''
  );
  const uiBasePath = `/${rawBasePath}`;
  const apiBasePath = `/api/${rawBasePath}`;

  const getParams = (req: DrystackRequest) => {
    let url;
    try {
      url = new URL(req.url);
    } catch (err) {
      throw new Error('Found incomplete URL in drystack API route URL handler');
    }
    let pathname = url.pathname;
    if (pathname.startsWith(apiBasePath)) {
      pathname = pathname.slice(apiBasePath.length);
    }
    return pathname
      .split('/')
      .map(x => decodeURIComponent(x))
      .filter(Boolean);
  };

  if (_config2.config.storage.kind === 'local') {
    const handler = localModeApiHandler(
      _config2.config,
      _config.localBaseDirectory
    );
    return (req: DrystackRequest) => {
      const params = getParams(req);
      return handler(req, params);
    };
  }
  if (!_config2.clientId || !_config2.clientSecret || !_config2.secret) {
    return async function drystackAPIRoute(
      req: DrystackRequest
    ): Promise<DrystackResponse> {
      const params = getParams(req);
      const joined = params.join('/');
      if (joined === 'github/created-app') {
        return handleGitHubAppCreation(req, options?.slugEnvName, uiBasePath);
      }
      if (
        joined === 'github/login' ||
        joined === 'github/repo-not-found' ||
        joined === 'github/logout'
      ) {
        return redirect(`${uiBasePath}/setup`);
      }
      return { status: 404, body: 'Not Found' };
    };
  }
  const config: InnerAPIRouteConfig = {
    clientId: _config2.clientId,
    clientSecret: _config2.clientSecret,
    secret: _config2.secret,
    config: _config2.config,
    uiBasePath,
    apiBasePath,
  };

  return async function drystackAPIRoute(
    req: DrystackRequest
  ): Promise<DrystackResponse> {
    const params = getParams(req);
    const joined = params.join('/');
    if (joined === 'github/oauth/callback') {
      return githubOauthCallback(req, config);
    }
    if (joined === 'github/login') {
      return githubLogin(req, config);
    }
    if (joined === 'github/refresh-token') {
      return githubRefreshToken(req, config);
    }
    if (joined === 'github/repo-not-found') {
      return githubRepoNotFound(req, config);
    }
    if (joined === 'github/logout') {
      const cookies = cookie.parse(req.headers.get('cookie') ?? '');
      const access_token = cookies['drystack-gh-access-token'];
      if (access_token) {
        await fetch(
          `https://api.github.com/applications/${config.clientId}/token`,
          {
            method: 'DELETE',
            headers: {
              Authorization: `Basic ${btoa(
                config.clientId + ':' + config.clientSecret
              )}`,
            },
            body: JSON.stringify({ access_token }),
          }
        );
      }
      return redirect(config.uiBasePath, [
        ['Set-Cookie', immediatelyExpiringCookie('drystack-gh-access-token')],
        ['Set-Cookie', immediatelyExpiringCookie('drystack-gh-refresh-token')],
      ]);
    }
    if (joined === 'github/created-app') {
      return {
        status: 404,
        body: 'It looks like you just tried to create a GitHub App for drystack but there is already a GitHub App configured for drystack.\n\nYou may be here because you started creating a GitHub App but then started the process again elsewhere and completed it there. You should likely go back to drystack and sign in with GitHub to continue.',
      };
    }
    return { status: 404, body: 'Not Found' };
  };
}

const tokenDataResultType = s.type({
  access_token: s.string(),
  expires_in: s.number(),
  refresh_token: s.string(),
  refresh_token_expires_in: s.number(),
  scope: s.string(),
  token_type: s.literal('bearer'),
});

async function githubOauthCallback(
  req: DrystackRequest,
  config: InnerAPIRouteConfig
): Promise<DrystackResponse> {
  const searchParams = new URL(req.url, 'http://localhost').searchParams;
  const error = searchParams.get('error');
  const errorDescription = searchParams.get('error_description');
  if (typeof errorDescription === 'string') {
    return {
      status: 400,
      body: `An error occurred when trying to authenticate with GitHub:\n${errorDescription}${
        error === 'redirect_uri_mismatch'
          ? `\n\nIf you were trying to sign in locally, you need to add \`http://127.0.0.1${config.apiBasePath}/github/oauth/callback\` as a callback URL in your GitHub app.`
          : ''
      }`,
    };
  }
  const code = searchParams.get('code');
  const state = searchParams.get('state');
  if (typeof code !== 'string') {
    return { status: 400, body: 'Bad Request' };
  }
  const cookies = cookie.parse(req.headers.get('cookie') ?? '');
  const fromCookie = state ? cookies['ks-' + state] : undefined;
  const from =
    typeof fromCookie === 'string' && drystackRouteRegex.test(fromCookie)
      ? fromCookie
      : undefined;
  const url = new URL('https://github.com/login/oauth/access_token');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('client_secret', config.clientSecret);
  url.searchParams.set('code', code);

  const tokenRes = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!tokenRes.ok) {
    return { status: 401, body: 'Authorization failed' };
  }
  const _tokenData = await tokenRes.json();
  let tokenData;
  try {
    tokenData = tokenDataResultType.create(_tokenData);
  } catch {
    return { status: 401, body: 'Authorization failed' };
  }

  const headers = await getTokenCookies(tokenData, config);
  if (state === 'close') {
    return {
      headers: [...headers, ['Content-Type', 'text/html']],
      body: "<script>localStorage.setItem('ks-refetch-installations', 'true');window.close();</script>",
      status: 200,
    };
  }
  return redirect(`${config.uiBasePath}${from ? `/${from}` : ''}`, headers);
}

async function getTokenCookies(
  tokenData: s.Infer<typeof tokenDataResultType>,
  config: InnerAPIRouteConfig
) {
  const headers: [string, string][] = [
    [
      'Set-Cookie',
      cookie.serialize('drystack-gh-access-token', tokenData.access_token, {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: tokenData.expires_in,
        expires: new Date(Date.now() + tokenData.expires_in * 1000),
        path: '/',
      }),
    ],
    [
      'Set-Cookie',
      cookie.serialize(
        'drystack-gh-refresh-token',
        await encryptValue(tokenData.refresh_token, config.secret),
        {
          sameSite: 'lax',
          secure: process.env.NODE_ENV === 'production',
          httpOnly: true,
          maxAge: tokenData.refresh_token_expires_in,
          expires: new Date(
            Date.now() + tokenData.refresh_token_expires_in * 100
          ),
          path: '/',
        }
      ),
    ],
  ];
  return headers;
}

async function getRefreshToken(
  req: DrystackRequest,
  config: InnerAPIRouteConfig
) {
  const cookies = cookie.parse(req.headers.get('cookie') || '');
  const refreshTokenCookie = cookies['drystack-gh-refresh-token'];
  if (!refreshTokenCookie) return;
  let refreshToken;
  try {
    refreshToken = await decryptValue(refreshTokenCookie, config.secret);
  } catch {
    return;
  }
  return refreshToken;
}

async function githubRefreshToken(
  req: DrystackRequest,
  config: InnerAPIRouteConfig
): Promise<DrystackResponse> {
  const headers = await refreshGitHubAuth(req, config);
  if (!headers) {
    return { status: 401, body: 'Authorization failed' };
  }
  return { status: 200, headers, body: '' };
}

async function refreshGitHubAuth(
  req: DrystackRequest,
  config: InnerAPIRouteConfig
) {
  const refreshToken = await getRefreshToken(req, config);
  if (!refreshToken) {
    return;
  }
  const url = new URL('https://github.com/login/oauth/access_token');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('client_secret', config.clientSecret);
  url.searchParams.set('grant_type', 'refresh_token');
  url.searchParams.set('refresh_token', refreshToken);
  const tokenRes = await fetch(url, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  if (!tokenRes.ok) {
    return;
  }
  const _tokenData = await tokenRes.json();
  let tokenData;
  try {
    tokenData = tokenDataResultType.create(_tokenData);
  } catch {
    return;
  }
  return getTokenCookies(tokenData, config);
}

async function githubRepoNotFound(
  req: DrystackRequest,
  config: InnerAPIRouteConfig
): Promise<DrystackResponse> {
  const headers = await refreshGitHubAuth(req, config);
  if (headers) {
    return redirect(`${config.uiBasePath}/repo-not-found`, headers);
  }
  return githubLogin(req, config);
}

async function githubLogin(
  req: DrystackRequest,
  config: InnerAPIRouteConfig
): Promise<DrystackResponse> {
  const reqUrl = new URL(req.url);
  const rawFrom = reqUrl.searchParams.get('from');
  const from =
    typeof rawFrom === 'string' && drystackRouteRegex.test(rawFrom)
      ? rawFrom
      : '/';
  const state = bytesToHex(webcrypto.getRandomValues(new Uint8Array(10)));
  const url = new URL('https://github.com/login/oauth/authorize');
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set(
    'redirect_uri',
    `${reqUrl.origin}${config.apiBasePath}/github/oauth/callback`
  );
  if (from === '/') {
    return redirect(url.toString());
  }
  url.searchParams.set('state', state);
  return redirect(url.toString(), [
    [
      'Set-Cookie',
      cookie.serialize('ks-' + state, from, {
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        // 1 day
        maxAge: 60 * 60 * 24,
        expires: new Date(Date.now() + 60 * 60 * 24 * 1000),
        path: '/',
        httpOnly: true,
      }),
    ],
  ]);
}

function immediatelyExpiringCookie(name: string) {
  return cookie.serialize(name, '', {
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
    expires: new Date(),
  });
}
