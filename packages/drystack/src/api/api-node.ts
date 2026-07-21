import * as s from 'superstruct';
import {
  realFsPromises as fs,
  realPath as path,
  realCrypto,
} from './real-node';
import { Config } from '../config';
import {
  DrystackRequest,
  DrystackResponse,
  redirect,
} from './internal-utils';
import { readToDirEntries, getAllowedDirectories } from './read-local';
import { blobSha } from '../app/trees';
import { base64UrlDecode } from '#base64';
import { exchangeGitHubAppManifestCode } from './github-app-manifest';
import { isDemoConfig } from '../app/storage-mode';

const { randomBytes } = realCrypto;

// this should be trivially dead code eliminated
// it's just to ensure the types are exactly the same between this and local-noop.ts
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _typeTest() {
  const a: typeof import('./api-node') = undefined as any;
  const b: typeof import('./api-noop') = undefined as any;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _c: typeof a = b;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _d: typeof b = a;
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

export async function handleGitHubAppCreation(
  req: DrystackRequest,
  slugEnvVarName: string | undefined,
  uiBasePath: string
): Promise<DrystackResponse> {
  const result = await exchangeGitHubAppManifestCode(req);
  if (!result.ok) return result.response;
  const ghAppDataResult = result.data;
  const toAddToEnv = `# drystack
DRYSTACK_GITHUB_CLIENT_ID=${ghAppDataResult.client_id}
DRYSTACK_GITHUB_CLIENT_SECRET=${ghAppDataResult.client_secret}
DRYSTACK_SECRET=${randomBytes(40).toString('hex')}
${
  slugEnvVarName
    ? `${slugEnvVarName}=${ghAppDataResult.slug} # https://github.com/apps/${ghAppDataResult.slug}\n`
    : ''
}`;

  let prevEnv: string | undefined;
  try {
    prevEnv = await fs.readFile('.env', 'utf-8');
  } catch (err) {
    if ((err as any).code !== 'ENOENT') throw err;
  }
  const newEnv = prevEnv ? `${prevEnv}\n\n${toAddToEnv}` : toAddToEnv;
  await fs.writeFile('.env', newEnv);
  await wait(200);
  return redirect(
    `${uiBasePath}/created-github-app?slug=${encodeURIComponent(ghAppDataResult.slug)}`
  );
}

export function localModeApiHandler(
  config: Config,
  localBaseDirectory: string | undefined
) {
  const baseDirectory = path.resolve(localBaseDirectory ?? process.cwd());
  return async (
    req: DrystackRequest,
    params: string[]
  ): Promise<DrystackResponse> => {
    const joined = params.join('/');
    if (req.method === 'GET' && joined === 'tree') {
      return tree(req, config, baseDirectory);
    }
    if (req.method === 'GET' && params[0] === 'blob') {
      return blob(req, config, params, baseDirectory);
    }
    if (req.method === 'POST' && joined === 'update') {
      return update(req, config, baseDirectory);
    }
    return { status: 404, body: 'Not Found' };
  };
}

async function tree(
  req: DrystackRequest,
  config: Config,
  baseDirectory: string
): Promise<DrystackResponse> {
  if (req.headers.get('no-cors') !== '1') {
    return { status: 400, body: 'Bad Request' };
  }
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await readToDirEntries(baseDirectory)),
  };
}

function getIsPathValid(config: Config) {
  const allowedDirectories = getAllowedDirectories(config);
  return (filepath: string) =>
    !filepath.includes('\\') &&
    filepath.split('/').every(x => x !== '.' && x !== '..') &&
    allowedDirectories.some(x => filepath.startsWith(x));
}

async function blob(
  req: DrystackRequest,
  config: Config,
  params: string[],
  baseDirectory: string
): Promise<DrystackResponse> {
  if (req.headers.get('no-cors') !== '1') {
    return { status: 400, body: 'Bad Request' };
  }

  const expectedSha = params[1];
  const filepath = params.slice(2).join('/');
  const isFilepathValid = getIsPathValid(config);
  if (!isFilepathValid(filepath)) {
    return { status: 400, body: 'Bad Request' };
  }

  let contents;
  try {
    contents = await fs.readFile(path.join(baseDirectory, filepath));
  } catch (err) {
    if ((err as any).code === 'ENOENT') {
      return { status: 404, body: 'Not Found' };
    }
    throw err;
  }
  const sha = await blobSha(contents);

  if (sha !== expectedSha) {
    return { status: 404, body: 'Not Found' };
  }
  return { status: 200, body: contents };
}

const base64Schema = s.coerce(s.instance(Uint8Array), s.string(), val =>
  base64UrlDecode(val)
);

async function update(
  req: DrystackRequest,
  config: Config,
  baseDirectory: string
): Promise<DrystackResponse> {
  if (
    req.headers.get('no-cors') !== '1' ||
    req.headers.get('content-type') !== 'application/json'
  ) {
    return { status: 400, body: 'Bad Request' };
  }
  // Demo mode's only client-side gate is a toast (app/demo-guard.ts) shown
  // before the fetch is ever issued - it never reaches here through the
  // admin UI. But this route can still be reachable directly (a raw HTTP
  // request, or `astro dev` which always keeps the on-demand route live
  // regardless of storage.kind === 'demo' - see the astro integration's
  // isDemoBuild comment), so the write itself must refuse here too, not just
  // upstream.
  if (isDemoConfig(config)) {
    return { status: 403, body: 'Writes are disabled in demo mode' };
  }
  const isFilepathValid = getIsPathValid(config);
  const filepath = s.refine(s.string(), 'filepath', isFilepathValid);
  let updates;

  try {
    updates = s.create(
      await req.json(),
      s.object({
        additions: s.array(
          s.object({
            path: filepath,
            contents: base64Schema,
          })
        ),
        deletions: s.array(s.object({ path: filepath })),
      })
    );
  } catch {
    return { status: 400, body: 'Bad data' };
  }
  for (const addition of updates.additions) {
    await fs.mkdir(path.dirname(path.join(baseDirectory, addition.path)), {
      recursive: true,
    });
    await fs.writeFile(
      path.join(baseDirectory, addition.path),
      addition.contents
    );
  }
  for (const deletion of updates.deletions) {
    await fs.rm(path.join(baseDirectory, deletion.path), {
      force: true,
      recursive: true,
    });
  }
  return {
    status: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(await readToDirEntries(baseDirectory)),
  };
}
