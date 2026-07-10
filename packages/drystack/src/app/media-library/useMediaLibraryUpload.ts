import { useCallback } from 'react';
import { base64Encode } from '#base64';
import { useRouter } from '../router';
import { hydrateTreeCacheWithEntries } from '../shell/data';
import { TreeEntry } from '../trees';
import { trackFreshUpload } from './upload-session';

function uniquePath(
  directory: string,
  filename: string,
  existing: ReadonlySet<string>
) {
  const dotIndex = filename.lastIndexOf('.');
  const base = dotIndex === -1 ? filename : filename.slice(0, dotIndex);
  const extension = dotIndex === -1 ? '' : filename.slice(dotIndex);
  let candidate = `${directory}/${filename}`;
  let i = 1;
  while (existing.has(candidate)) {
    candidate = `${directory}/${base}-${i}${extension}`;
    i++;
  }
  return candidate;
}

// Note: this intentionally does NOT call `setTreeSha`. Doing so would update
// the app-wide tree state, which the currently open entry form treats as an
// "external change" and resets its unsaved edits to match (see
// `localTreeKey` handling in ItemPage/SingletonPage). An upload triggered
// from within this same form shouldn't blow away what the user is editing.
// The uploaded file is already durably written to disk; the tree will catch
// up next time it's naturally refreshed (e.g. after Save).
export function useMediaLibraryUpload() {
  const { basePath } = useRouter();

  return useCallback(
    async (
      directory: string,
      content: Uint8Array,
      filename: string,
      existingPaths: ReadonlySet<string>
    ): Promise<string> => {
      const path = uniquePath(directory, filename, existingPaths);
      const res = await fetch(`/api${basePath}/update`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'no-cors': '1',
        },
        body: JSON.stringify({
          additions: [{ path, contents: base64Encode(content) }],
          deletions: [],
        }),
      });
      if (!res.ok) {
        throw new Error(await res.text());
      }
      const newTree: TreeEntry[] = await res.json();
      await hydrateTreeCacheWithEntries(newTree);
      // `uniquePath` above always picks a non-colliding path, so this write
      // never overwrites something pre-existing — always fresh.
      trackFreshUpload(path);
      return `/${path}`;
    },
    [basePath]
  );
}
