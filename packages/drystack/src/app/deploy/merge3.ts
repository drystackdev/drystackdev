// Pure 3-way merge logic for Deploy (see plan/brand.md §6-7). No React/IO here
// — useDeploy.ts fetches blob text and calls into these functions.
import { diff3Merge } from 'node-diff3';
import { TreeData } from '../shell/data';

// .yaml/.html (+.yml) are the only extensions that ever get a real 3-way text
// merge; everything else is "never conflicts" — the brand's version always
// wins on divergence, per plan/brand.md §1.
const MERGEABLE_EXTENSIONS = new Set(['.yaml', '.yml', '.html']);

function extOf(path: string): string {
  const i = path.lastIndexOf('.');
  return i === -1 ? '' : path.slice(i).toLowerCase();
}

export type ChangeClassification = {
  // paths whose brand version should be written as-is (byte-for-byte copy);
  // covers both new/modified files and the "only brand touched it" case
  takeOursAdditions: string[];
  // paths that existed at the base and should be removed (brand deleted them
  // and main left them untouched)
  takeOursDeletions: string[];
  // paths needing a real 3-way text merge — both sides changed a mergeable
  // file differently (including one side deleting it — see merge3.ts's
  // treatment of a missing side as empty text)
  conflictEligible: string[];
};

// Classifies every path across base/ours(brand)/theirs(main) using the same
// three-way logic git itself uses for a fast-forward-free merge: unchanged
// relative to base on either side needs no action; changed on exactly one
// side takes that side; changed differently on both sides is a conflict
// (unless the extension is exempt, in which case brand still wins).
export function classifyChanges(
  base: TreeData,
  ours: TreeData,
  theirs: TreeData
): ChangeClassification {
  const allPaths = new Set<string>([
    ...base.entries.keys(),
    ...ours.entries.keys(),
    ...theirs.entries.keys(),
  ]);

  const takeOursAdditions: string[] = [];
  const takeOursDeletions: string[] = [];
  const conflictEligible: string[] = [];

  for (const path of allPaths) {
    const b = base.entries.get(path);
    const o = ours.entries.get(path);
    const t = theirs.entries.get(path);
    // tree (directory) entries are implied by their children; only blobs
    // are independently meaningful to diff
    if (b?.type === 'tree' || o?.type === 'tree' || t?.type === 'tree') {
      continue;
    }

    const bSha = b?.sha;
    const oSha = o?.sha;
    const tSha = t?.sha;

    if (oSha === tSha) continue; // brand & main already agree
    if (oSha === bSha) continue; // brand never touched this path
    if (tSha === bSha) {
      // only brand changed it (added, modified, or deleted)
      if (o) takeOursAdditions.push(path);
      else takeOursDeletions.push(path);
      continue;
    }
    // both sides changed it, differently
    if (MERGEABLE_EXTENSIONS.has(extOf(path))) {
      conflictEligible.push(path);
    } else if (o) {
      takeOursAdditions.push(path);
    } else {
      takeOursDeletions.push(path);
    }
  }

  return { takeOursAdditions, takeOursDeletions, conflictEligible };
}

// Text-level 3-way merge
// -----------------------------------------------------------------------------

export type Hunk =
  | { kind: 'ok'; lines: string[] }
  | { kind: 'conflict'; ours: string[]; base: string[]; theirs: string[] };

export type FileMergeResult =
  | { kind: 'clean'; content: string }
  | { kind: 'conflict'; hunks: Hunk[] };

// Splits keeping line terminators attached, so `.join('')` round-trips the
// original text exactly (including a missing/present trailing newline).
function splitLines(text: string): string[] {
  if (text === '') return [];
  return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

// `oursText`/`theirsText` pass '' for a side that deleted the file (see
// classifyChanges — a mergeable-extension delete-vs-modify is still routed
// here rather than auto-resolved) — diff3 then surfaces it as an ordinary
// conflict with an empty side, reusing the same hunk UI instead of a special
// "keep or delete" mode. useDeploy treats an all-empty resolved result as a
// deletion (see resolveHunks below).
export function merge3Text(
  oursText: string,
  baseText: string,
  theirsText: string
): FileMergeResult {
  const regions = diff3Merge(
    splitLines(oursText),
    splitLines(baseText),
    splitLines(theirsText),
    { excludeFalseConflicts: true }
  );

  const hunks: Hunk[] = regions.map(region =>
    region.conflict
      ? {
          kind: 'conflict',
          ours: region.conflict.a,
          base: region.conflict.o,
          theirs: region.conflict.b,
        }
      : { kind: 'ok', lines: region.ok ?? [] }
  );

  if (hunks.every(h => h.kind === 'ok')) {
    return {
      kind: 'clean',
      content: hunks.flatMap(h => (h as { lines: string[] }).lines).join(''),
    };
  }
  return { kind: 'conflict', hunks };
}

// Rebuilds a file's final text from a resolved FileMergeResult. `choices` has
// one entry per conflict hunk, in the same order those hunks appear in
// `hunks` (i.e. skipping 'ok' hunks) — exactly the order ConflictDialog
// enumerates them in.
export function resolveHunks(
  hunks: Hunk[],
  choices: ('ours' | 'theirs')[]
): string {
  let choiceIndex = 0;
  const parts: string[] = [];
  for (const hunk of hunks) {
    if (hunk.kind === 'ok') {
      parts.push(...hunk.lines);
    } else {
      const choice = choices[choiceIndex];
      choiceIndex++;
      parts.push(...(choice === 'ours' ? hunk.ours : hunk.theirs));
    }
  }
  return parts.join('');
}

export function conflictHunkCount(hunks: Hunk[]): number {
  return hunks.filter(h => h.kind === 'conflict').length;
}
