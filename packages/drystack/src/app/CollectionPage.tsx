import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { isHotkey } from 'is-hotkey';
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { ActionButton, Button } from '@keystar/ui/button';
import { DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { alertCircleIcon } from '@keystar/ui/icon/icons/alertCircleIcon';
import { listXIcon } from '@keystar/ui/icon/icons/listXIcon';
import { searchIcon } from '@keystar/ui/icon/icons/searchIcon';
import { searchXIcon } from '@keystar/ui/icon/icons/searchXIcon';
import { diffIcon } from '@keystar/ui/icon/icons/diffIcon';
import { plusSquareIcon } from '@keystar/ui/icon/icons/plusSquareIcon';
import { dotSquareIcon } from '@keystar/ui/icon/icons/dotSquareIcon';
import { Flex } from '@keystar/ui/layout';
import { TextLink } from '@keystar/ui/link';
import { ProgressCircle } from '@keystar/ui/progress';
import { SearchField } from '@keystar/ui/search-field';
import {
  breakpointQueries,
  css,
  tokenSchema,
  useMediaQuery,
} from '@keystar/ui/style';
import {
  TableView,
  TableBody,
  TableHeader,
  Column,
  Cell,
  Row,
  SortDescriptor,
} from '@keystar/ui/table';
import { Heading, Text } from '@keystar/ui/typography';

import { Config } from '../config';
import { sortBy } from './collection-sort';
import { renderColumnCell } from './collection-table/cells';
import {
  ColumnDescriptor,
  columnValueToSearchText,
  getDisplayKind,
} from './collection-table/column-model';
import { ColumnsMenu } from './collection-table/ColumnsMenu';
import {
  PendingCheckboxEdit,
  QuickEditCheckboxDialog,
} from './collection-table/QuickEditCheckboxDialog';
import { useCollectionViewState } from './collection-table/useCollectionViewState';
import l10nMessages from './l10n';
import { useRouter } from './router';
import { EmptyState } from './shell/empty-state';
import {
  useTree,
  TreeData,
  useBaseCommit,
  useCurrentBranch,
  useRepoInfo,
} from './shell/data';
import { PageRoot, PageHeader } from './shell/page';
import {
  getCollectionFormat,
  getCollectionItemPath,
  getCollectionPath,
  getEntriesInCollectionWithTreeKey,
  getEntryDataFilepath,
  getSlugGlobForCollection,
  isLocalConfig,
} from './utils';
import { notFound } from './not-found';
import { fetchBlobsBatch } from './useItemData';
import { loadDataFile } from './required-files';
import { parseProps } from '../form/parse-props';
import { useData } from './useData';
import { useClient } from 'urql';

type CollectionPageProps = {
  collection: string;
  config: Config;
  basePath: string;
};

export function CollectionPage(props: CollectionPageProps) {
  const { collection, config } = props;
  const containerWidth = 'none'; // TODO: use a "large" when we have more columns
  const collectionConfig = config.collections?.[collection];
  if (!collectionConfig) notFound();

  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(
    new URLSearchParams(router.search).get('search') ?? ''
  );

  const setSearchTermFromForm = useCallback(
    (value: string) => {
      setSearchTerm(value);
      const params = new URLSearchParams(router.search);
      if (value) {
        params.set('search', value);
      } else {
        params.delete('search');
      }
      router.replace(router.pathname + '?' + params.toString());
    },
    [router]
  );

  let debouncedSearchTerm = useDebouncedValue(searchTerm, 300);

  // every schema field becomes a column automatically — the designated slug
  // field always comes first and is rendered as the "Name" column (see
  // getDisplayKind in collection-table/column-model.ts)
  const columnDescriptors = useMemo<ColumnDescriptor[]>(() => {
    const nameKey = collectionConfig.slugField;
    const keys = [
      nameKey,
      ...Object.keys(collectionConfig.schema).filter(key => key !== nameKey),
    ];
    return keys.map(key => {
      const schema = collectionConfig.schema[key];
      const label = ('label' in schema && schema.label) || key;
      return {
        key,
        label,
        displayKind: getDisplayKind(schema, key, nameKey),
        schema,
      };
    });
  }, [collectionConfig]);

  // image/content fields tend to be heavy (media previews, long text) and
  // clutter the table, so they start out hidden until the user opts in
  const defaultHiddenColumns = useMemo(
    () =>
      columnDescriptors
        .filter(c => c.displayKind === 'image' || c.displayKind === 'content')
        .map(c => c.key),
    [columnDescriptors]
  );

  const { hiddenColumns, setHiddenColumns, columnWidths, setColumnWidths } =
    useCollectionViewState(collection, defaultHiddenColumns);

  const visibleColumnDescriptors = useMemo(
    () =>
      columnDescriptors.filter(
        c => c.displayKind === 'name' || !hiddenColumns.has(c.key)
      ),
    [columnDescriptors, hiddenColumns]
  );

  return (
    <PageRoot containerWidth={containerWidth}>
      <CollectionPageHeader
        collectionLabel={collectionConfig.label}
        createHref={`${props.basePath}/collection/${encodeURIComponent(
          props.collection
        )}/create`}
      />
      <CollectionToolbar
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTermFromForm}
        columns={columnDescriptors}
        hiddenColumns={hiddenColumns}
        onHiddenColumnsChange={setHiddenColumns}
      />
      <CollectionPageContent
        searchTerm={debouncedSearchTerm}
        columnDescriptors={visibleColumnDescriptors}
        columnWidths={columnWidths}
        onColumnWidthsChange={setColumnWidths}
        {...props}
      />
    </PageRoot>
  );
}

function CollectionPageHeader(props: {
  createHref: string;
  collectionLabel: string;
}) {
  const { collectionLabel, createHref } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  return (
    <PageHeader>
      <Heading elementType="h1" id="page-title" size="small" flex minWidth={0}>
        {collectionLabel}
      </Heading>
      <Button marginStart="auto" prominence="high" href={createHref}>
        {stringFormatter.format('add')}
      </Button>
    </PageHeader>
  );
}

function CollectionToolbar(props: {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  columns: ColumnDescriptor[];
  hiddenColumns: ReadonlySet<string>;
  onHiddenColumnsChange: (hidden: Set<string>) => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const isAboveMobile = useMediaQuery(breakpointQueries.above.mobile);
  const [searchVisible, setSearchVisible] = useState(isAboveMobile);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setSearchVisible(isAboveMobile);
  }, [isAboveMobile]);

  // entries are presented in a virtualized table view, so we replace the
  // default (e.g. ctrl+f) browser search behaviour
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      // bail if the search field is already focused; let users invoke the
      // browser search if they need to
      if (document.activeElement === searchRef.current) {
        return;
      }

      if (isHotkey('mod+f', event)) {
        event.preventDefault();
        searchRef.current?.select();
      }
    };
    document.addEventListener('keydown', listener);
    return () => document.removeEventListener('keydown', listener);
  }, []);

  return (
    <Flex
      alignItems="center"
      justifyContent="flex-end"
      gap="regular"
      paddingTop={{ tablet: 'large' }}
      UNSAFE_className={css({
        marginInline: tokenSchema.size.space.regular,
        [breakpointQueries.above.mobile]: {
          marginInline: `calc(${tokenSchema.size.space.xlarge} - ${tokenSchema.size.space.medium})`,
        },
        [breakpointQueries.above.tablet]: {
          marginInline: `calc(${tokenSchema.size.space.xxlarge} - ${tokenSchema.size.space.medium})`,
        },
      })}
    >
      <div
        role="search"
        style={{
          display: searchVisible ? 'block' : 'none',
        }}
      >
        <SearchField
          ref={searchRef}
          aria-label={stringFormatter.format('search')} // TODO: l10n "Search {collection}"?
          onChange={props.onSearchTermChange}
          onClear={() => {
            props.onSearchTermChange('');
            if (!isAboveMobile) {
              setTimeout(() => {
                setSearchVisible(false);
              }, 250);
            }
          }}
          onBlur={() => {
            if (!isAboveMobile && props.searchTerm === '') {
              setSearchVisible(false);
            }
          }}
          placeholder={stringFormatter.format('search')}
          value={props.searchTerm}
          width="scale.2400"
        />
      </div>
      <ActionButton
        aria-label="show search"
        isHidden={searchVisible || { above: 'mobile' }}
        onPress={() => {
          setSearchVisible(true);
          // NOTE: this hack is to force the search field to focus, and invoke
          // the software keyboard on mobile safari
          let tempInput = document.createElement('input');
          tempInput.style.position = 'absolute';
          tempInput.style.opacity = '0';
          document.body.appendChild(tempInput);
          tempInput.focus();

          setTimeout(() => {
            searchRef.current?.focus();
            tempInput.remove();
          }, 0);
        }}
      >
        <Icon src={searchIcon} />
      </ActionButton>
      <ColumnsMenu
        columns={props.columns}
        hiddenColumns={props.hiddenColumns}
        onHiddenColumnsChange={props.onHiddenColumnsChange}
      />
    </Flex>
  );
}

type CollectionPageContentProps = CollectionPageProps & {
  searchTerm: string;
  columnDescriptors: ColumnDescriptor[];
  columnWidths: Record<string, string> | undefined;
  onColumnWidthsChange: (widths: Record<string, string>) => void;
};
function CollectionPageContent(props: CollectionPageContentProps) {
  const trees = useTree();

  const tree =
    trees.merged.kind === 'loaded'
      ? trees.merged.data.current.entries.get(
          getCollectionPath(props.config, props.collection)
        )
      : null;

  if (trees.merged.kind === 'error') {
    return (
      <EmptyState
        icon={alertCircleIcon}
        title="Unable to load collection"
        message={trees.merged.error.message}
        actions={
          <Button tone="accent" href={props.basePath}>
            Dashboard
          </Button>
        }
      />
    );
  }

  if (trees.merged.kind === 'loading') {
    return (
      <EmptyState>
        <ProgressCircle
          aria-label="Loading Entries"
          isIndeterminate
          size="large"
        />
      </EmptyState>
    );
  }

  if (!tree) {
    return (
      <EmptyState
        icon={listXIcon}
        title="Empty collection"
        message={
          <>
            There aren't any entries yet.{' '}
            <TextLink
              href={`${props.basePath}/collection/${encodeURIComponent(
                props.collection
              )}/create`}
            >
              Create the first entry
            </TextLink>{' '}
            to see it here.
          </>
        }
      />
    );
  }

  return <CollectionTable {...props} trees={trees.merged.data} />;
}

const STATUS = '@@status';
const COLUMN_MIN_WIDTH = 100;

function CollectionTable(
  props: CollectionPageContentProps & {
    trees: {
      default: TreeData;
      current: TreeData;
    };
  }
) {
  let { searchTerm, columnDescriptors } = props;

  const client = useClient();
  const repoInfo = useRepoInfo();
  const currentBranch = useCurrentBranch();
  let isLocalMode = isLocalConfig(props.config);
  let router = useRouter();
  const collection = props.config.collections![props.collection]!;
  let [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: collection.slugField,
    direction: 'ascending',
  });
  let hideStatusColumn =
    isLocalMode || currentBranch === repoInfo?.defaultBranch;

  const baseCommit = useBaseCommit();

  const [pendingCheckboxEdit, setPendingCheckboxEdit] =
    useState<PendingCheckboxEdit | null>(null);

  const entriesWithStatus = useMemo(() => {
    const defaultEntries = new Map(
      getEntriesInCollectionWithTreeKey(
        props.config,
        props.collection,
        props.trees.default.tree
      ).map(x => [x.slug, x.key])
    );
    return getEntriesInCollectionWithTreeKey(
      props.config,
      props.collection,
      props.trees.current.tree
    ).map(entry => {
      return {
        name: entry.slug,
        status: defaultEntries.has(entry.slug)
          ? defaultEntries.get(entry.slug) === entry.key
            ? 'Unchanged'
            : 'Changed'
          : 'Added',
        sha: entry.sha,
      };
    });
  }, [props.collection, props.config, props.trees]);

  const mainFiles = useData(
    useCallback(async () => {
      const formatInfo = getCollectionFormat(props.config, props.collection);
      const blobsByOid = await fetchBlobsBatch(
        props.config,
        client,
        entriesWithStatus.map(entry => ({
          oid: entry.sha,
          filepath: getEntryDataFilepath(
            getCollectionItemPath(props.config, props.collection, entry.name),
            formatInfo
          ),
        })),
        baseCommit,
        repoInfo,
        router.basePath
      );
      const entries = entriesWithStatus.map(
        entry => [entry.name, blobsByOid.get(entry.sha)!] as const
      );
      const glob = getSlugGlobForCollection(props.config, props.collection);
      const rootSchema = { kind: 'object' as const, fields: collection.schema };
      const parsedEntries = new Map<string, Record<string, unknown>>();
      for (const [slug, dataFile] of entries) {
        try {
          const { loaded } = loadDataFile(dataFile, formatInfo);
          const validated = parseProps(
            rootSchema,
            loaded,
            [],
            [],
            (schema, value, path) => {
              if (schema.formKind === 'asset') {
                return schema.reader.parse(value);
              }
              if (schema.formKind === 'assets') {
                if (schema.contentExtension) {
                  // fields.content() stores only lightweight
                  // { wordCount, charCount } metadata inline — the actual
                  // HTML body lives in its own file that the table listing
                  // deliberately doesn't fetch, see mainFiles above
                  return value;
                }
                // cheap: markdoc.inline()'s reader just returns the raw
                // text as-is, no document parsing needed
                return schema.reader.parse(value);
              }
              if (schema.formKind === 'content') {
                // deprecated markdoc field; needs asset bytes we don't fetch
                // for the table listing
                return;
              }
              if (path.length === 1 && slug !== undefined) {
                if (path[0] === collection.slugField) {
                  if (schema.formKind !== 'slug') {
                    throw new Error(
                      `Slug field ${collection.slugField} is not a slug field`
                    );
                  }
                  return schema.reader.parseWithSlug(value, {
                    slug,
                    glob,
                  });
                }
              }
              return schema.reader.parse(value);
            },
            true
          );
          parsedEntries.set(slug, validated as Record<string, unknown>);
        } catch {}
      }
      return parsedEntries;
    }, [
      collection,
      props.config,
      props.collection,
      entriesWithStatus,
      baseCommit,
      repoInfo,
      router.basePath,
      client,
    ])
  );

  const entriesWithData = useMemo((): {
    name: string;
    status: string;
    sha: string;
    data?: Record<string, unknown>;
  }[] => {
    if (mainFiles.kind !== 'loaded' || !mainFiles.data) {
      return entriesWithStatus;
    }
    const { data } = mainFiles;
    return entriesWithStatus.map(entry => {
      return {
        ...entry,
        data: data.get(entry.name),
      };
    });
  }, [entriesWithStatus, mainFiles]);

  const filteredItems = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return entriesWithData;
    return entriesWithData.filter(item => {
      const row = item.data ?? {};
      const haystack = columnDescriptors
        .map(descriptor =>
          columnValueToSearchText(descriptor, row[descriptor.key], item.name)
        )
        .join(' ')
        .toLowerCase();
      return haystack.includes(term);
    });
  }, [entriesWithData, searchTerm, columnDescriptors]);
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const readCol = (
        row: typeof a,
        other: Record<string, unknown> | undefined
      ) => {
        if (sortDescriptor.column === STATUS) {
          return row.status;
        }
        if (sortDescriptor.column === collection.slugField) {
          return collection.parseSlugForSort?.(row.name) ?? row.name;
        }
        return other?.[sortDescriptor.column!] ?? row.name;
      };
      const other = mainFiles.kind === 'loaded' ? mainFiles.data : undefined;
      return sortBy(
        sortDescriptor.direction!,
        readCol(a, other?.get(a.name)),
        readCol(b, other?.get(b.name))
      );
    });
  }, [
    collection,
    filteredItems,
    mainFiles,
    sortDescriptor.column,
    sortDescriptor.direction,
  ]);

  // live drag feedback for controlled column widths — react-stately only
  // re-renders a *controlled* column at the width we feed it via the
  // `width` prop, and only tracks its own internal drag state for
  // *uncontrolled* columns. Since our widths are controlled (persisted
  // percentages), we mirror each drag tick into this local, unpersisted
  // state so the dragged column and its immediate neighbor visibly track
  // the pointer; `commitColumnWidthsFromDom` clears it again once the drag
  // ends and the real, persisted percentages take over.
  const [liveColumnWidths, setLiveColumnWidths] = useState<
    Record<string, number>
  >({});

  const columns = useMemo(() => {
    const lastKey = columnDescriptors[columnDescriptors.length - 1]?.key;
    return [
      ...(hideStatusColumn
        ? []
        : [{ name: 'Status', key: STATUS, minWidth: 32, width: 32 }]),
      ...columnDescriptors.map(c => ({
        name: c.label,
        key: c.key,
        // the last column never gets a stored width — it's left to grow or
        // shrink to whatever space the others don't claim, absorbing any
        // slack left behind by showing/hiding columns
        width:
          c.key === lastKey
            ? undefined
            : (liveColumnWidths[c.key] ?? props.columnWidths?.[c.key]),
        minWidth: COLUMN_MIN_WIDTH,
        allowsResizing: true,
      })),
    ];
  }, [
    columnDescriptors,
    hideStatusColumn,
    props.columnWidths,
    liveColumnWidths,
  ]);

  const tableWrapperRef = useRef<HTMLDivElement>(null);

  // reads the actual rendered header widths from the DOM, keyed by column
  // key — used both to snapshot the layout right as a drag starts (giving
  // resize deltas a stable baseline) and to persist the layout once a drag
  // ends, since react-stately's own resize widths map is only reliable for
  // the dragged column itself (see findDraggedColumn below).
  const measureHeaderWidths = useCallback(() => {
    const container = tableWrapperRef.current;
    const widths = new Map<string, number>();
    let total = 0;
    if (!container) return { widths, total };
    const headers = Array.from(
      container.querySelectorAll<HTMLElement>('[role="columnheader"]')
    );
    headers.forEach((el, i) => {
      const col = columns[i];
      if (!col) return;
      const px = el.getBoundingClientRect().width;
      widths.set(String(col.key), px);
      total += px;
    });
    return { widths, total };
  }, [columns]);

  // batches onResize drag ticks — declared here since
  // commitColumnWidthsFromDom also needs to cancel a still-pending frame
  // when a drag ends
  const pendingWidthsRef = useRef<Map<React.Key, unknown> | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  // pixel widths of every column, measured right as the current drag
  // started — the baseline resize deltas below are computed against
  const resizeStartWidthsRef = useRef<Map<string, number> | null>(null);

  // react-stately's resize widths map only carries a live, accurate pixel
  // value for the dragged column itself — every other column falls back to
  // its current `width` prop unchanged. That's normally enough to tell the
  // dragged column apart from the rest (its entry is the only "fresh" one),
  // but since we deliberately feed a fresh pixel value to its neighbor too
  // (to make the neighbor visibly absorb the difference), the neighbor's
  // entry becomes numeric on the very next tick as well — which would make
  // either one look like the dragged column from the widths map alone. So
  // instead we read the DOM directly: react-stately marks the header of
  // whichever column is actively being resized with `data-resizing="true"`
  // (see the indicator div in @keystar/ui's table), independent of what
  // we've fed back as `width` props.
  const findDraggedColumn = useCallback(
    (widths: Map<React.Key, unknown>) => {
      const container = tableWrapperRef.current;
      if (!container) return null;
      const headers = Array.from(
        container.querySelectorAll<HTMLElement>('[role="columnheader"]')
      );
      const draggedIndex = headers.findIndex(
        el => el.querySelector('[data-resizing="true"]') != null
      );
      const col = columns[draggedIndex];
      if (!col) return null;
      const draggedKey = String(col.key);
      const raw = widths.get(col.key);
      const draggedPx = typeof raw === 'number' ? raw : Number(raw);
      if (!Number.isFinite(draggedPx)) return null;
      const neighbor = columns[draggedIndex + 1];
      return {
        draggedKey,
        draggedPx,
        neighborKey: neighbor ? String(neighbor.key) : null,
      };
    },
    [columns]
  );

  const onColumnResizeStart = useCallback(() => {
    resizeStartWidthsRef.current = measureHeaderWidths().widths;
  }, [measureHeaderWidths]);

  const commitColumnWidthsFromDom = useCallback(
    (widths: Map<React.Key, unknown>) => {
      const lastKey = columnDescriptors[columnDescriptors.length - 1]?.key;
      const dragged = findDraggedColumn(widths);
      const { widths: measured, total } = measureHeaderWidths();
      if (dragged && total > 0) {
        // only the dragged column and its immediate neighbor changed size
        // — leave every other column's persisted width untouched
        const next: Record<string, string> = { ...props.columnWidths };
        for (const key of [dragged.draggedKey, dragged.neighborKey]) {
          if (key == null || key === lastKey) continue;
          const px = measured.get(key);
          if (px == null) continue;
          next[key] = `${Math.round((px / total) * 100)}%`;
        }
        props.onColumnWidthsChange(next);
      }
      // the persisted percentages now represent the current layout, so drop
      // the ephemeral drag-tracking overrides in favor of them — including
      // any still-queued animation-frame update, which would otherwise
      // reapply a stale width right after this
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      pendingWidthsRef.current = null;
      resizeStartWidthsRef.current = null;
      setLiveColumnWidths({});
    },
    [columnDescriptors, findDraggedColumn, measureHeaderWidths, props]
  );

  // mirrors each drag tick into local state so the dragged column and its
  // immediate neighbor visibly track the pointer, transferring width
  // between just the two of them — see the comment on findDraggedColumn
  // above for why the neighbor needs to be computed by hand rather than
  // read off react-stately's own widths map. `onResize` fires on every
  // pointermove, which can be far more often than the screen actually
  // repaints, so a state update per event just piles up redundant
  // re-renders (visible as jank) without any visual benefit — coalesce
  // them into at most one update per animation frame instead.
  const flushPendingResize = useCallback(() => {
    resizeRafRef.current = null;
    const widths = pendingWidthsRef.current;
    pendingWidthsRef.current = null;
    const startWidths = resizeStartWidthsRef.current;
    if (!widths || !startWidths) return;
    const dragged = findDraggedColumn(widths);
    if (!dragged) return;
    const startDraggedPx =
      startWidths.get(dragged.draggedKey) ?? dragged.draggedPx;
    let delta = dragged.draggedPx - startDraggedPx;
    const update: Record<string, number> = {
      [dragged.draggedKey]: dragged.draggedPx,
    };
    if (dragged.neighborKey != null) {
      const startNeighborPx = startWidths.get(dragged.neighborKey);
      if (startNeighborPx != null) {
        let newNeighborPx = startNeighborPx - delta;
        // the neighbor can't give up more than it has down to its own
        // minimum — clamp the delta so the dragged column can't grow past
        // what the neighbor is actually able to hand over
        if (newNeighborPx < COLUMN_MIN_WIDTH) {
          delta = startNeighborPx - COLUMN_MIN_WIDTH;
          newNeighborPx = COLUMN_MIN_WIDTH;
          update[dragged.draggedKey] = startDraggedPx + delta;
        }
        update[dragged.neighborKey] = newNeighborPx;
      }
    }
    setLiveColumnWidths(prev => ({ ...prev, ...update }));
  }, [findDraggedColumn]);
  const onColumnResize = useCallback((widths: Map<React.Key, unknown>) => {
    pendingWidthsRef.current = widths;
    if (resizeRafRef.current == null) {
      resizeRafRef.current = requestAnimationFrame(flushPendingResize);
    }
  }, [flushPendingResize]);
  useEffect(() => {
    return () => {
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, []);

  return (
    <>
      <div ref={tableWrapperRef} className={css({ display: 'contents' })}>
      <TableView
        aria-labelledby="page-title"
        selectionMode="none"
        onSortChange={setSortDescriptor}
        sortDescriptor={sortDescriptor}
        density="spacious"
        overflowMode="wrap"
        prominence="low"
        onResizeStart={onColumnResizeStart}
        onResize={onColumnResize}
        onResizeEnd={commitColumnWidthsFromDom}
        onAction={key => {
          router.push(
            getItemPath(
              props.basePath,
              props.collection,
              key.toString().slice('key:'.length)
            )
          );
        }}
        renderEmptyState={() => (
          <EmptyState
            icon={searchXIcon}
            title="No results"
            message={`No items matching "${searchTerm}" were found.`}
          />
        )}
        flex
        marginTop={{ tablet: 'large' }}
        marginBottom={{ mobile: 'regular', tablet: 'xlarge' }}
        UNSAFE_className={css({
          // flex items default to a content-based min-width, which can let
          // the table (a flex child of PageRoot) grow past the page instead
          // of scrolling internally if its content is ever wider than
          // available space
          minWidth: 0,
          marginInline: tokenSchema.size.space.regular,
          [breakpointQueries.above.mobile]: {
            marginInline: `calc(${tokenSchema.size.space.xlarge} - ${tokenSchema.size.space.medium})`,
          },
          [breakpointQueries.above.tablet]: {
            marginInline: `calc(${tokenSchema.size.space.xxlarge} - ${tokenSchema.size.space.medium})`,
          },

          '[role=rowheader]': {
            cursor: 'pointer',
          },
          '[role=gridcell], [role=rowheader]': {
            display: 'flex',
            alignItems: 'center',
          },
        })}
      >
        <TableHeader columns={columns}>
          {({ name, key, ...options }) =>
            key === STATUS ? (
              <Column key={key} isRowHeader allowsSorting {...options}>
                <Icon aria-label="Status" src={diffIcon} />
              </Column>
            ) : (
              <Column key={key} isRowHeader allowsSorting {...options}>
                {name}
              </Column>
            )
          }
        </TableHeader>
        <TableBody items={sortedItems}>
          {item => {
            const statusCell = (
              <Cell key={STATUS + item.name} textValue={item.status}>
                {item.status === 'Added' ? (
                  <Icon color="positive" src={plusSquareIcon} />
                ) : item.status === 'Changed' ? (
                  <Icon color="accent" src={dotSquareIcon} />
                ) : null}
              </Cell>
            );
            const row = item.data ?? {};
            return (
              <Row key={'key:' + item.name}>
                {[
                  ...(hideStatusColumn ? [] : [statusCell]),
                  ...columnDescriptors.map(descriptor => {
                    const value = row[descriptor.key];
                    return (
                      <Cell
                        key={descriptor.key + item.name}
                        textValue={cellTextValue(descriptor, value, item.name)}
                      >
                        {renderColumnCell(descriptor, value, item.name, {
                          onRequestCheckboxEdit: setPendingCheckboxEdit,
                        })}
                      </Cell>
                    );
                  }),
                ]}
              </Row>
            );
          }}
        </TableBody>
      </TableView>
      </div>
      <DialogContainer onDismiss={() => setPendingCheckboxEdit(null)}>
        {pendingCheckboxEdit && (
          <QuickEditCheckboxDialog
            config={props.config}
            collectionKey={props.collection}
            schema={collection.schema}
            slugField={collection.slugField}
            edit={pendingCheckboxEdit}
            onDone={() => setPendingCheckboxEdit(null)}
          />
        )}
      </DialogContainer>
    </>
  );
}

function cellTextValue(
  descriptor: ColumnDescriptor,
  value: unknown,
  itemSlug: string
): string {
  if (descriptor.displayKind === 'name') {
    return typeof value === 'string' && value ? value : itemSlug;
  }
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.join(', ');
  return '';
}

function getItemPath(
  basePath: string,
  collection: string,
  key: string | number
): string {
  return `${basePath}/collection/${encodeURIComponent(
    collection
  )}/item/${encodeURIComponent(key)}`;
}
export function useDebouncedValue<T>(value: T, delay = 300): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);

  return debouncedValue;
}
