import * as s from 'superstruct';
import { DrystackRequest, DrystackResponse } from './internal-utils';

const ghAppSchema = s.type({
  slug: s.string(),
  client_id: s.string(),
  client_secret: s.string(),
});

export type GitHubAppManifestData = s.Infer<typeof ghAppSchema>;

export async function exchangeGitHubAppManifestCode(
  req: DrystackRequest
): Promise<
  { ok: true; data: GitHubAppManifestData } | { ok: false; response: DrystackResponse }
> {
  const searchParams = new URL(req.url, 'https://localhost').searchParams;
  const code = searchParams.get('code');
  if (typeof code !== 'string' || !/^[a-zA-Z0-9]+$/.test(code)) {
    return { ok: false, response: { status: 400, body: 'Bad Request' } };
  }
  const ghAppRes = await fetch(
    `https://api.github.com/app-manifests/${code}/conversions`,
    {
      method: 'POST',
      headers: { Accept: 'application/json', 'User-Agent': 'drystack' },
    }
  );
  if (!ghAppRes.ok) {
    console.log(ghAppRes);
    return {
      ok: false,
      response: {
        status: 500,
        body: 'An error occurred while creating the GitHub App',
      },
    };
  }
  const ghAppDataRaw = await ghAppRes.json();
  try {
    return { ok: true, data: s.create(ghAppDataRaw, ghAppSchema) };
  } catch {
    console.log(ghAppDataRaw);
    return {
      ok: false,
      response: {
        status: 500,
        body: 'An unexpected response was received from GitHub',
      },
    };
  }
}
