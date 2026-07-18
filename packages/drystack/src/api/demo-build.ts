import { realFsPromises as fs, realPath as path } from './real-node';
import { readToDirEntries, getAllowedDirectories } from './read-local';
import { updateTreeWithChanges, TreeEntry } from '../app/trees';
import { TRASH_DIRECTORY } from '../app/media-library/constants';
import { Config } from '../config';

// Node-only, build-time counterpart to app/demo-source.ts. Produces the
// dataset that gets zipped into the public `/__data.zip` a demo build serves
// (see @drystack/astro's demo-zip endpoint) - everything a demo needs to
// reconstruct a read-only `/tree` + `/blob` without a server.

function getIsPathAllowed(config: Config) {
  // Mirrors api-node.ts's getIsPathValid exactly - it's the same boundary
  // the real `/blob` route enforces for local mode, so reusing it here means
  // a demo can never bundle anything (source, config, .env) that local mode's
  // own API wouldn't have served anyway.
  const allowedDirectories = getAllowedDirectories(config);
  return (filepath: string) =>
    !filepath.includes('\\') &&
    filepath.split('/').every(x => x !== '.' && x !== '..') &&
    allowedDirectories.some(x => filepath.startsWith(x));
}

function isUnderTrash(filepath: string) {
  return filepath === TRASH_DIRECTORY || filepath.startsWith(`${TRASH_DIRECTORY}/`);
}

// Any directory literally named `assets/` is already mirrored verbatim into
// the static build output by the astro integration's copyDrystackAssets, at
// its real repo-relative path - so it's already servable there and doesn't
// need its bytes duplicated into the zip too (images/video would otherwise
// dwarf the yaml/markdown that's the actual point of the dataset).
function isAssetPath(filepath: string) {
  return filepath.split('/').includes('assets');
}

export type DemoDataset = {
  // Full manifest - directory ("tree") entries included - scoped to exactly
  // the directories `getAllowedDirectories` would allow, so it never leaks
  // anything outside collections/singletons/media-library. Trash is excluded
  // outright: a public demo has no business exposing content someone deleted.
  manifest: TreeEntry[];
  // Raw bytes for every manifest blob entry that isn't an asset (see
  // isAssetPath above) - i.e. exactly what actually needs to ship inside the
  // zip itself.
  files: { path: string; contents: Uint8Array }[];
};

export async function buildDemoDataset(
  config: Config,
  baseDirectory: string
): Promise<DemoDataset> {
  const allEntries = await readToDirEntries(baseDirectory);
  const isAllowed = getIsPathAllowed(config);
  const scopedBlobs = allEntries.filter(
    e => e.type === 'blob' && isAllowed(e.path) && !isUnderTrash(e.path)
  );
  const { entries: manifest } = await updateTreeWithChanges(new Map(), {
    additions: scopedBlobs.map(e => ({
      path: e.path,
      contents: { byteLength: e.size ?? 0, sha: e.sha },
    })),
    deletions: [],
  });
  const files = await Promise.all(
    scopedBlobs
      .filter(e => !isAssetPath(e.path))
      .map(async e => ({
        path: e.path,
        contents: await fs.readFile(path.join(baseDirectory, e.path)),
      }))
  );
  return { manifest, files };
}
