import type { EntryRef } from "../path-utils";

// One "Import content" pick: which entry, and which of its top-level content
// fields to import. Mirrors media-library/bridge.ts's opener-registry
// pattern, so the node's insertMenu/toolbar command can await a picker dialog
// mounted elsewhere in the tree (app shell or VEI host) without either side
// knowing about the other directly.
export type ContentRefPick = { ref: EntryRef; field: string };

type Opener = (options: {
  // The entry currently being edited - excluded from the picker so an entry
  // can never import its own top-level content field.
  excludeRef: EntryRef | null;
}) => Promise<ContentRefPick | undefined>;

let currentOpener: Opener | null = null;
let openerReadyResolvers: Array<() => void> = [];

export function registerContentRefPickerOpener(opener: Opener | null) {
  currentOpener = opener;
  if (opener) {
    openerReadyResolvers.forEach((resolve) => resolve());
    openerReadyResolvers = [];
  }
}

// See waitForMediaLibraryOpener's doc comment - same lazy-mount race.
export function waitForContentRefPickerOpener(
  timeoutMs = 8000,
): Promise<boolean> {
  if (currentOpener) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    openerReadyResolvers.push(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

export function openContentRefPicker(options: {
  excludeRef: EntryRef | null;
}): Promise<ContentRefPick | undefined> {
  if (!currentOpener) {
    // eslint-disable-next-line no-console
    console.warn("Content reference picker is not available yet");
    return Promise.resolve(undefined);
  }
  return currentOpener(options);
}
