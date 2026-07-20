import { toastQueue } from "@keystar/ui/toast";
import { Text } from "@keystar/ui/typography";
import { useLocale } from "@react-aria/i18n";
import { UseStore, clear, createStore, del, get, keys, set } from "idb-keyval";
import { useState, useMemo, useEffect } from "react";

const units = {
  seconds: 60,
  minutes: 60,
  hours: 24,
  days: 7,
  weeks: 4,
  months: 12,
  years: Infinity,
};

function formatTimeAgo(
  targetDate: Date,
  currentDate: Date,
  formatter: Intl.RelativeTimeFormat,
) {
  let duration = (targetDate.getTime() - currentDate.getTime()) / 1000;

  for (const [name, amount] of Object.entries(units) as [
    keyof typeof units,
    number,
  ][]) {
    if (Math.abs(duration) < amount) {
      return formatter.format(Math.round(duration), name);
    }
    duration /= amount;
  }
  return "unknown";
}

function RelativeTime(props: { date: Date }) {
  const { locale } = useLocale();
  const [now] = useState(() => new Date());
  const formatted = useMemo(() => {
    const formatter = new Intl.RelativeTimeFormat(locale);
    formatter.format(props.date.getTime() - now.getTime(), "second");
    return formatTimeAgo(props.date, now, formatter);
  }, [locale, now, props.date]);
  return <time dateTime={props.date.toISOString()}>{formatted}</time>;
}

export function showDraftRestoredToast(
  savedAt: Date,
  hasChangedSince: boolean,
  stringFormatter: { format(key: string): string },
) {
  toastQueue.info(
    <Text>
      {stringFormatter.format("draftRestoredFromPrefix")}{" "}
      <RelativeTime date={savedAt} />.{" "}
      {hasChangedSince && (
        <Text color="accent">
          {stringFormatter.format("draftChangedSinceWarning")}
        </Text>
      )}
    </Text>,
    { timeout: 8000 },
  );
}

let store: UseStore;

function getStore() {
  if (!store) {
    store = createStore("drystack", "items");
  }
  return store;
}

type Key =
  | readonly [kind: "collection", collection: string, slug: string]
  | readonly [
      kind: "collection-create",
      collection: string,
      duplicateSlug?: string,
    ]
  | readonly [kind: "singleton", singleton: string];

// the as anys are because the indexeddb types dont't accept readonly arrays

export function setDraft(key: Key, val: unknown) {
  return set(key as any, val, getStore()).then(notifyDraftsChanged);
}

export function delDraft(key: Key) {
  return del(key as any, getStore()).then(notifyDraftsChanged);
}

export function getDraft(key: Key): Promise<unknown> {
  return get(key as any, getStore());
}

export async function clearDrafts() {
  await clear(getStore());
  notifyDraftsChanged();
}

export function listDraftKeys(): Promise<Key[]> {
  return keys(getStore()) as unknown as Promise<Key[]>;
}

// same-tab pub/sub so UI (sidebar nav, collection status column) can react
// live to drafts being written/removed elsewhere in the app - idb-keyval has
// no built-in change events
const draftListeners = new Set<() => void>();

function notifyDraftsChanged() {
  for (const listener of draftListeners) listener();
}

export function subscribeDrafts(listener: () => void): () => void {
  draftListeners.add(listener);
  return () => {
    draftListeners.delete(listener);
  };
}

export function useDraftKeys(): Key[] {
  const [draftKeys, setDraftKeys] = useState<Key[]>([]);
  useEffect(() => {
    let cancelled = false;
    const refresh = () => {
      listDraftKeys().then((ks) => {
        if (!cancelled) setDraftKeys(ks);
      });
    };
    refresh();
    const unsubscribe = subscribeDrafts(refresh);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);
  return draftKeys;
}

export function useCollectionDraftSlugs(collection: string): Set<string> {
  const draftKeys = useDraftKeys();
  return useMemo(() => {
    const slugs = new Set<string>();
    for (const key of draftKeys) {
      if (key[0] === "collection" && key[1] === collection) {
        slugs.add(key[2]);
      }
    }
    return slugs;
  }, [draftKeys, collection]);
}

export function useSingletonHasDraft(singleton: string): boolean {
  const draftKeys = useDraftKeys();
  return useMemo(
    () =>
      draftKeys.some((key) => key[0] === "singleton" && key[1] === singleton),
    [draftKeys, singleton],
  );
}

// per-collection entries-table column visibility/widths - kept in its own
// store since, unlike drafts, it should never be cleared alongside
// in-progress entry edits
let viewsStore: UseStore;

function getViewsStore() {
  if (!viewsStore) {
    // separate database (not just a separate store within 'drystack') -
    // idb-keyval's createStore only creates the object store during
    // onupgradeneeded, which won't fire for existing users' 'drystack' DB
    // since opening it here doesn't bump its version. A distinct DB name
    // guarantees onupgradeneeded runs and the store gets created.
    viewsStore = createStore("drystack-views", "collection-views");
  }
  return viewsStore;
}

// `hiddenColumns` (rather than a visible-columns allowlist) so newly added
// schema fields show up automatically instead of being silently hidden.
// `columnWidths` are percentage strings (e.g. "24%") so they scale with the
// table instead of pinning a pixel width.
export type CollectionViewState = {
  hiddenColumns: string[];
  columnWidths?: Record<string, string>;
};

export function getCollectionViewState(
  collection: string,
): Promise<CollectionViewState | undefined> {
  return get(collection, getViewsStore());
}

export function setCollectionViewState(
  collection: string,
  val: CollectionViewState,
) {
  return set(collection, val, getViewsStore());
}
