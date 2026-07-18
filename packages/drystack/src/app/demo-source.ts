import { unzipSync, strFromU8 } from 'fflate';
import { TreeEntry } from './trees';

// Backs `storage: { kind: 'local', demo: true }` (see storage-mode.ts). A demo
// build is fully static - there's no `/api/*` to serve `/tree` or `/blob/...`
// - so instead every collection/singleton data file the config touches gets
// bundled at build time (see api/demo-build.ts + the astro integration's
// `__data.zip` endpoint) into one zip, published as a public static asset.
// This module is the client-side counterpart: fetch it once, unzip it once,
// and serve tree/blob reads out of memory from then on.
//
// Deliberately framework-agnostic and dependency-light (only trees.ts) so
// both the admin app (shell/data.tsx's fetchLocalTree, useItemData.ts's
// fetchBlob) and the VEI live-editor toolbar (a separate package,
// @drystack/astro, importing this via the "./demo-source" subpath) can share
// the exact same parsed dataset instead of each fetching/unzipping their own
// copy.
//
// Assets (anything under a directory literally named `assets/`) are NOT
// embedded in the zip - `copyDrystackAssets` in the astro integration already
// mirrors those into the static build output at their real repo-relative
// path, so bundling their bytes a second time would only bloat the zip
// (images/video dwarf yaml/markdown). `getDemoBlob` falls back to fetching
// the real path for anything the zip doesn't have inline.
const DEMO_ZIP_PATH = '/__data.zip';
const MANIFEST_KEY = '__manifest.json';

type DemoDataset = {
  manifest: TreeEntry[];
  files: Map<string, Uint8Array>;
};

let datasetPromise: Promise<DemoDataset> | undefined;

async function loadDemoDataset(): Promise<DemoDataset> {
  const res = await fetch(DEMO_ZIP_PATH);
  if (!res.ok) {
    throw new Error(
      `Could not load the demo dataset (${DEMO_ZIP_PATH}, ${res.status}). Was this site built with storage.demo: true?`
    );
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  const unzipped = unzipSync(bytes);
  const manifestBytes = unzipped[MANIFEST_KEY];
  if (!manifestBytes) {
    throw new Error(`${DEMO_ZIP_PATH} is missing its ${MANIFEST_KEY} entry`);
  }
  const manifest: TreeEntry[] = JSON.parse(strFromU8(manifestBytes));
  const files = new Map<string, Uint8Array>();
  for (const [path, contents] of Object.entries(unzipped)) {
    if (path === MANIFEST_KEY) continue;
    files.set(path, contents);
  }
  return { manifest, files };
}

// Memoized: every caller across the page's lifetime shares one download and
// one unzip, the same way shell/data.tsx's treeCache and useItemData.ts's
// blobCache share fetches within a single mode.
function getDemoDataset(): Promise<DemoDataset> {
  if (!datasetPromise) {
    datasetPromise = loadDemoDataset().catch(err => {
      // A failed load shouldn't wedge every future caller into the same
      // rejected promise forever - let the next read attempt retry.
      datasetPromise = undefined;
      throw err;
    });
  }
  return datasetPromise;
}

export async function getDemoTreeEntries(): Promise<TreeEntry[]> {
  return (await getDemoDataset()).manifest;
}

export async function getDemoBlob(filepath: string): Promise<Uint8Array> {
  const { files } = await getDemoDataset();
  const embedded = files.get(filepath);
  if (embedded) return embedded;
  // Not in the zip - must be an asset, mirrored to its real static path.
  const res = await fetch(`/${filepath}`);
  if (!res.ok) {
    throw new Error(`Could not fetch demo asset ${filepath}: ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}
