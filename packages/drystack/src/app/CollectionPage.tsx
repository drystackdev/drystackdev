import { useLocalizedStringFormatter } from "@react-aria/i18n";
import Fuse from "fuse.js";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { alertCircleIcon } from "@keystar/ui/icon/icons/alertCircleIcon";
import { listXIcon } from "@keystar/ui/icon/icons/listXIcon";
import { searchXIcon } from "@keystar/ui/icon/icons/searchXIcon";
import { diffIcon } from "@keystar/ui/icon/icons/diffIcon";
import { plusSquareIcon } from "@keystar/ui/icon/icons/plusSquareIcon";
import { dotSquareIcon } from "@keystar/ui/icon/icons/dotSquareIcon";
import { TextLink } from "@keystar/ui/link";
import { ProgressCircle } from "@keystar/ui/progress";
import { SortDescriptor } from "@keystar/ui/table";
import { Heading, Text } from "@keystar/ui/typography";

import { Config } from "../config";
import { sortBy } from "./collection-sort";
import { renderColumnCell } from "./collection-table/cells";
import {
  ColumnDescriptor,
  columnValueToSearchText,
  getDisplayKind,
} from "./collection-table/column-model";
import { CollectionToolbar } from "./collection-table/CollectionToolbar";
import {
  DataColumn,
  EntityTableView,
  FixtureColumn,
} from "./collection-table/EntityTableView";
import { ContentPreviewDialog } from "./collection-table/ContentPreviewDialog";
import { MatchRange } from "./collection-table/highlight";
import {
  PendingCheckboxEdit,
  QuickEditCheckboxDialog,
} from "./collection-table/QuickEditCheckboxDialog";
import { useCollectionViewState } from "./collection-table/useCollectionViewState";
import l10nMessages from "./l10n";
import { useRouter } from "./router";
import { EmptyState } from "./shell/empty-state";
import { useTree, TreeData } from "./shell/data";
import { PageRoot, PageHeader } from "./shell/page";
import {
  getCollectionFormat,
  getCollectionItemPath,
  getCollectionPath,
  getEntriesInCollectionWithTreeKey,
  getEntryDataFilepath,
  getSlugGlobForCollection,
} from "./utils";
import { useCollectionDraftSlugs } from "./persistence";
import { notFound } from "./not-found";
import { fetchBlobsBatch } from "./useItemData";
import { getTreeNodeAtPath } from "./trees";
import { loadDataFile } from "./required-files";
import { parseProps } from "../form/parse-props";
import { useData } from "./useData";

type CollectionPageProps = {
  collection: string;
  config: Config;
  basePath: string;
};

export function CollectionPage(props: CollectionPageProps) {
  const { collection, config } = props;
  const containerWidth = "none"; // TODO: use a "large" when we have more columns
  const collectionConfig = config.collections?.[collection];
  if (!collectionConfig) notFound();

  const router = useRouter();
  const [searchTerm, setSearchTerm] = useState(
    new URLSearchParams(router.search).get("search") ?? "",
  );

  const setSearchTermFromForm = useCallback(
    (value: string) => {
      setSearchTerm(value);
      const params = new URLSearchParams(router.search);
      if (value) {
        params.set("search", value);
      } else {
        params.delete("search");
      }
      router.replace(router.pathname + "?" + params.toString());
    },
    [router],
  );

  let debouncedSearchTerm = useDebouncedValue(searchTerm, 300);

  // opt-in: fields.content() bodies live in their own .html file and aren't
  // fetched for the table listing by default (see the mainFiles loader
  // below) - checking this trades extra network/decoding work for the
  // ability to fuzzy-match inside that HTML.
  const [searchContent, setSearchContent] = useState(false);

  // every schema field becomes a column automatically - the designated slug
  // field always comes first and is rendered as the "Name" column (see
  // getDisplayKind in collection-table/column-model.ts)
  const columnDescriptors = useMemo<ColumnDescriptor[]>(() => {
    const nameKey = collectionConfig.slugField;
    const keys = [
      nameKey,
      ...Object.keys(collectionConfig.schema).filter((key) => key !== nameKey),
    ];
    return keys.map((key) => {
      const schema = collectionConfig.schema[key];
      const label = ("label" in schema && schema.label) || key;
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
        .filter((c) => c.displayKind === "image" || c.displayKind === "content")
        .map((c) => c.key),
    [columnDescriptors],
  );

  const { hiddenColumns, setHiddenColumns, columnWidths, setColumnWidths } =
    useCollectionViewState(collection, defaultHiddenColumns);

  const visibleColumnDescriptors = useMemo(
    () =>
      columnDescriptors.filter(
        (c) => c.displayKind === "name" || !hiddenColumns.has(c.key),
      ),
    [columnDescriptors, hiddenColumns],
  );

  return (
    <PageRoot containerWidth={containerWidth}>
      <CollectionPageHeader
        collectionLabel={collectionConfig.label}
        createHref={`${props.basePath}/collection/${encodeURIComponent(
          props.collection,
        )}/create`}
      />
      <CollectionToolbar
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTermFromForm}
        columns={columnDescriptors}
        hiddenColumns={hiddenColumns}
        onHiddenColumnsChange={setHiddenColumns}
        searchContent={searchContent}
        onSearchContentChange={setSearchContent}
      />
      <CollectionPageContent
        searchTerm={debouncedSearchTerm}
        searchContent={searchContent}
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
        {stringFormatter.format("add")}
      </Button>
    </PageHeader>
  );
}

type CollectionPageContentProps = CollectionPageProps & {
  searchTerm: string;
  searchContent: boolean;
  columnDescriptors: ColumnDescriptor[];
  columnWidths: Record<string, string> | undefined;
  onColumnWidthsChange: (widths: Record<string, string>) => void;
};
function CollectionPageContent(props: CollectionPageContentProps) {
  const trees = useTree();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const tree =
    trees.merged.kind === "loaded"
      ? trees.merged.data.current.entries.get(
          getCollectionPath(props.config, props.collection),
        )
      : null;

  if (trees.merged.kind === "error") {
    return (
      <EmptyState
        icon={alertCircleIcon}
        title={stringFormatter.format("unableToLoadCollectionTitle")}
        message={trees.merged.error.message}
        actions={
          <Button tone="accent" href={props.basePath}>
            {stringFormatter.format("dashboardAction")}
          </Button>
        }
      />
    );
  }

  if (trees.merged.kind === "loading") {
    return (
      <EmptyState>
        <ProgressCircle
          aria-label={stringFormatter.format("loadingEntriesAriaLabel")}
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
        title={stringFormatter.format("emptyCollectionTitle")}
        message={
          <>
            {stringFormatter.format("emptyCollectionBodyPrefix")}{" "}
            <TextLink
              href={`${props.basePath}/collection/${encodeURIComponent(
                props.collection,
              )}/create`}
            >
              {stringFormatter.format("createFirstEntryLink")}
            </TextLink>{" "}
            {stringFormatter.format("emptyCollectionBodySuffix")}
          </>
        }
      />
    );
  }

  return <CollectionTable {...props} trees={trees.merged.data} />;
}

const STATUS = "@@status";

// A row handed to the shared EntityTableView: an entry's parsed data plus the
// async-fetched content text / search-match ranges baked onto it (see
// `tableItems` below - baking them on gives react-aria a fresh item identity to
// redraw against when that data arrives).
type CollectionTableItem = {
  name: string;
  status: string;
  sha: string;
  data?: Record<string, unknown>;
  contentTexts?: Map<string, string>;
  contentMatches?: Map<string, MatchRange[]>;
  columnMatches?: Map<string, MatchRange[]>;
};

function CollectionTable(
  props: CollectionPageContentProps & {
    trees: {
      default: TreeData;
      current: TreeData;
    };
  },
) {
  let { searchTerm, columnDescriptors } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  let router = useRouter();
  const collection = props.config.collections![props.collection]!;
  let [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: collection.slugField,
    direction: "ascending",
  });

  const [pendingCheckboxEdit, setPendingCheckboxEdit] =
    useState<PendingCheckboxEdit | null>(null);

  const [contentPreview, setContentPreview] = useState<{
    name: string;
    fieldKey: string;
    label: string;
  } | null>(null);

  const draftSlugs = useCollectionDraftSlugs(props.collection);

  const entriesWithStatus = useMemo(() => {
    const defaultEntries = new Map(
      getEntriesInCollectionWithTreeKey(
        props.config,
        props.collection,
        props.trees.default.tree,
      ).map((x) => [x.slug, x.key]),
    );
    return getEntriesInCollectionWithTreeKey(
      props.config,
      props.collection,
      props.trees.current.tree,
    ).map((entry) => {
      const treeStatus = defaultEntries.has(entry.slug)
        ? defaultEntries.get(entry.slug) === entry.key
          ? "Unchanged"
          : "Changed"
        : "Added";
      return {
        name: entry.slug,
        status:
          treeStatus === "Unchanged" && draftSlugs.has(entry.slug)
            ? "Changed"
            : treeStatus,
        sha: entry.sha,
      };
    });
  }, [props.collection, props.config, props.trees, draftSlugs]);

  // unlike the pure git-tree diff this replaces, this also reflects unsaved
  // in-browser drafts (see useCollectionDraftSlugs) - so it stays hidden
  // only when there's truly nothing changed to show, not just because we're
  // in local mode or on the default branch (where a committed diff can never
  // exist, but a draft still can)
  let hideStatusColumn = !entriesWithStatus.some(
    (entry) => entry.status !== "Unchanged",
  );

  const mainFiles = useData(
    useCallback(async () => {
      const formatInfo = getCollectionFormat(props.config, props.collection);
      const blobsByOid = await fetchBlobsBatch(
        props.config,
        entriesWithStatus.map((entry) => ({
          oid: entry.sha,
          filepath: getEntryDataFilepath(
            getCollectionItemPath(props.config, props.collection, entry.name),
            formatInfo,
          ),
        })),
        router.basePath,
      );
      const entries = entriesWithStatus.map(
        (entry) => [entry.name, blobsByOid.get(entry.sha)!] as const,
      );
      const glob = getSlugGlobForCollection(props.config, props.collection);
      const rootSchema = { kind: "object" as const, fields: collection.schema };
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
              if (schema.formKind === "asset") {
                return schema.reader.parse(value);
              }
              if (schema.formKind === "assets") {
                if (schema.contentExtension) {
                  // fields.content() stores only lightweight
                  // { wordCount, charCount } metadata inline - the actual
                  // HTML body lives in its own file that the table listing
                  // deliberately doesn't fetch, see mainFiles above
                  return value;
                }
                // cheap: markdoc.inline()'s reader just returns the raw
                // text as-is, no document parsing needed
                return schema.reader.parse(value);
              }
              if (schema.formKind === "content") {
                // deprecated markdoc field; needs asset bytes we don't fetch
                // for the table listing
                return;
              }
              if (path.length === 1 && slug !== undefined) {
                if (path[0] === collection.slugField) {
                  if (schema.formKind !== "slug") {
                    throw new Error(
                      `Slug field ${collection.slugField} is not a slug field`,
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
            true,
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
      router.basePath,
    ]),
  );

  const entriesWithData = useMemo((): {
    name: string;
    status: string;
    sha: string;
    data?: Record<string, unknown>;
  }[] => {
    if (mainFiles.kind !== "loaded" || !mainFiles.data) {
      return entriesWithStatus;
    }
    const { data } = mainFiles;
    return entriesWithStatus.map((entry) => {
      return {
        ...entry,
        data: data.get(entry.name),
      };
    });
  }, [entriesWithStatus, mainFiles]);

  // fields.content() bodies live in their own `<field>.html` file per entry
  // (see mainFiles above) - only look them up when the user has opted in,
  // since fetching+decoding one blob per entry per content field is real
  // extra work for a large collection.
  const contentFieldKeys = useMemo(
    () =>
      Object.entries(collection.schema)
        .filter(
          ([, schema]) =>
            schema.kind === "form" &&
            schema.formKind === "assets" &&
            !!schema.contentExtension,
        )
        .map(([key]) => key),
    [collection],
  );

  // entryName -> fieldKey -> plain text stripped from that field's .html
  const contentTexts = useData(
    useCallback(async () => {
      if (!props.searchContent || contentFieldKeys.length === 0) {
        return new Map<string, Map<string, string>>();
      }
      const requests: {
        oid: string;
        filepath: string;
        name: string;
        field: string;
      }[] = [];
      for (const entry of entriesWithStatus) {
        const entryDir = getCollectionItemPath(
          props.config,
          props.collection,
          entry.name,
        );
        for (const fieldKey of contentFieldKeys) {
          const node = getTreeNodeAtPath(
            props.trees.current.tree,
            `${entryDir}/${fieldKey}.html`,
          );
          if (node && !node.children) {
            requests.push({
              oid: node.entry.sha,
              filepath: node.entry.path,
              name: entry.name,
              field: fieldKey,
            });
          }
        }
      }
      if (requests.length === 0) return new Map<string, Map<string, string>>();
      const blobsByOid = await fetchBlobsBatch(
        props.config,
        requests.map((r) => ({ oid: r.oid, filepath: r.filepath })),
        router.basePath,
      );
      const textByEntry = new Map<string, Map<string, string>>();
      const decoder = new TextDecoder();
      for (const request of requests) {
        const bytes = blobsByOid.get(request.oid);
        if (!bytes) continue;
        const text = htmlToSearchableText(decoder.decode(bytes));
        let fields = textByEntry.get(request.name);
        if (!fields) {
          fields = new Map();
          textByEntry.set(request.name, fields);
        }
        fields.set(request.field, text);
      }
      return textByEntry;
    }, [
      props.searchContent,
      contentFieldKeys,
      entriesWithStatus,
      props.config,
      props.collection,
      props.trees,
      router.basePath,
    ]),
  );
  const contentTextsByEntry =
    contentTexts.kind === "loaded" ? contentTexts.data : undefined;

  // every column feeds search except image/checkbox (no text to fuzzy-match
  // against) and content (handled separately above, since it needs the
  // fetched .html text rather than the inline {wordCount,charCount} value)
  const searchableColumnDescriptors = useMemo(
    () =>
      columnDescriptors.filter(
        (d) =>
          d.displayKind !== "image" &&
          d.displayKind !== "checkbox" &&
          d.displayKind !== "content",
      ),
    [columnDescriptors],
  );

  const searchableItems = useMemo(() => {
    return entriesWithData.map((item) => {
      const row = item.data ?? {};
      const columns: Record<string, string> = {};
      for (const descriptor of searchableColumnDescriptors) {
        columns[descriptor.key] = columnValueToSearchText(
          descriptor,
          row[descriptor.key],
          item.name,
        );
      }
      const content: Record<string, string> = {};
      const fields = contentTextsByEntry?.get(item.name);
      if (fields) {
        for (const [fieldKey, text] of fields) content[fieldKey] = text;
      }
      return { item, name: item.name, columns, content };
    });
  }, [entriesWithData, searchableColumnDescriptors, contentTextsByEntry]);

  const fuse = useMemo(
    () =>
      new Fuse(searchableItems, {
        keys: [
          ...searchableColumnDescriptors.map((d) => `columns.${d.key}`),
          ...contentFieldKeys.map((key) => `content.${key}`),
        ],
        includeMatches: true,
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [searchableItems, searchableColumnDescriptors, contentFieldKeys],
  );

  // per matched entry, the matches Fuse found, split by which bucket they
  // landed in - drives the highlighted text shown in each column's cell
  // (columnMatchesByEntry), the content field's cell snippet, and the marks
  // in the full-text preview dialog (contentMatchesByEntry). Both empty
  // whenever there's no active search term.
  const { filteredItems, contentMatchesByEntry, columnMatchesByEntry } =
    useMemo(() => {
      const term = searchTerm.trim();
      if (!term) {
        return {
          filteredItems: entriesWithData,
          contentMatchesByEntry: new Map<string, Map<string, MatchRange[]>>(),
          columnMatchesByEntry: new Map<string, Map<string, MatchRange[]>>(),
        };
      }
      const results = fuse.search(term);
      const contentMatches = new Map<string, Map<string, MatchRange[]>>();
      const columnMatches = new Map<string, Map<string, MatchRange[]>>();
      for (const result of results) {
        for (const match of result.matches ?? []) {
          if (!match.key || !match.indices?.length) continue;
          if (match.key.startsWith("content.")) {
            const fieldKey = match.key.slice("content.".length);
            let fields = contentMatches.get(result.item.name);
            if (!fields) {
              fields = new Map();
              contentMatches.set(result.item.name, fields);
            }
            fields.set(fieldKey, [...match.indices] as MatchRange[]);
          } else if (match.key.startsWith("columns.")) {
            const columnKey = match.key.slice("columns.".length);
            let cols = columnMatches.get(result.item.name);
            if (!cols) {
              cols = new Map();
              columnMatches.set(result.item.name, cols);
            }
            cols.set(columnKey, [...match.indices] as MatchRange[]);
          }
        }
      }
      return {
        filteredItems: results.map((result) => result.item.item),
        contentMatchesByEntry: contentMatches,
        columnMatchesByEntry: columnMatches,
      };
    }, [fuse, searchTerm, entriesWithData]);
  const sortedItems = useMemo(() => {
    return [...filteredItems].sort((a, b) => {
      const readCol = (
        row: typeof a,
        other: Record<string, unknown> | undefined,
      ) => {
        if (sortDescriptor.column === STATUS) {
          return row.status;
        }
        if (sortDescriptor.column === collection.slugField) {
          return collection.parseSlugForSort?.(row.name) ?? row.name;
        }
        return other?.[sortDescriptor.column!] ?? row.name;
      };
      const other = mainFiles.kind === "loaded" ? mainFiles.data : undefined;
      return sortBy(
        sortDescriptor.direction!,
        readCol(a, other?.get(a.name)),
        readCol(b, other?.get(b.name)),
      );
    });
  }, [
    collection,
    filteredItems,
    mainFiles,
    sortDescriptor.column,
    sortDescriptor.direction,
  ]);

  // react-aria's table Collection caches each row's rendered output keyed by
  // the identity of the item object handed to `TableBody items={...}` - it
  // does *not* re-invoke the render prop just because CollectionTable itself
  // re-rendered. contentTexts/contentMatchesByEntry arrive asynchronously
  // (after the initial row render) and live outside the item objects
  // themselves, so a plain closure lookup inside the render prop would read
  // stale (pre-fetch) data forever once react-aria decides a row doesn't
  // need re-rendering. Baking the per-row content data directly onto a new
  // item object here forces a genuinely different identity whenever that
  // data changes, which is what actually triggers react-aria to redraw it.
  const tableItems = useMemo(
    () =>
      sortedItems.map((item) => ({
        ...item,
        contentTexts: contentTextsByEntry?.get(item.name),
        contentMatches: contentMatchesByEntry.get(item.name),
        columnMatches: columnMatchesByEntry.get(item.name),
      })),
    [
      sortedItems,
      contentTextsByEntry,
      contentMatchesByEntry,
      columnMatchesByEntry,
    ],
  );

  const leadingColumns = useMemo<FixtureColumn<CollectionTableItem>[]>(
    () =>
      hideStatusColumn
        ? []
        : [
            {
              key: STATUS,
              label: "Status",
              width: 32,
              minWidth: 32,
              isRowHeader: true,
              allowsSorting: true,
              header: (
                <Icon
                  aria-label={stringFormatter.format("statusColumnAriaLabel")}
                  src={diffIcon}
                />
              ),
              renderCell: (item) => ({
                textValue: stringFormatter.format(
                  item.status === "Added"
                    ? "statusAdded"
                    : item.status === "Changed"
                      ? "statusChanged"
                      : "statusUnchanged",
                ),
                node:
                  item.status === "Added" ? (
                    <Icon color="positive" src={plusSquareIcon} />
                  ) : item.status === "Changed" ? (
                    <Icon color="accent" src={dotSquareIcon} />
                  ) : null,
              }),
            },
          ],
    [hideStatusColumn, stringFormatter],
  );

  const dataColumns = useMemo<DataColumn<CollectionTableItem>[]>(
    () =>
      columnDescriptors.map((descriptor) => ({
        descriptor,
        renderCell: (item) => {
          const row = item.data ?? {};
          const value = row[descriptor.key];
          const contentText =
            descriptor.displayKind === "content"
              ? item.contentTexts?.get(descriptor.key)
              : undefined;
          const contentCtx =
            descriptor.displayKind === "content"
              ? {
                  fullText: contentText,
                  matchIndices: item.contentMatches?.get(descriptor.key),
                  isClickable: props.searchContent && contentText !== undefined,
                  onOpenPreview: () =>
                    setContentPreview({
                      name: item.name,
                      fieldKey: descriptor.key,
                      label: descriptor.label,
                    }),
                }
              : undefined;
          const columnMatchIndices =
            descriptor.displayKind !== "content" &&
            descriptor.displayKind !== "image" &&
            descriptor.displayKind !== "checkbox"
              ? item.columnMatches?.get(descriptor.key)
              : undefined;
          const matchCtx = columnMatchIndices?.length
            ? {
                text: columnValueToSearchText(descriptor, value, item.name),
                indices: columnMatchIndices,
              }
            : undefined;
          return {
            textValue: cellTextValue(descriptor, value, item.name),
            node: renderColumnCell(descriptor, value, item.name, {
              onRequestCheckboxEdit: setPendingCheckboxEdit,
              content: contentCtx,
              match: matchCtx,
            }),
          };
        },
      })),
    [columnDescriptors, props.searchContent],
  );

  return (
    <>
      <EntityTableView
        aria-labelledby="page-title"
        leadingColumns={leadingColumns}
        dataColumns={dataColumns}
        items={tableItems}
        getItemKey={(item) => item.name}
        sortDescriptor={sortDescriptor}
        onSortChange={setSortDescriptor}
        columnWidths={props.columnWidths}
        onColumnWidthsChange={props.onColumnWidthsChange}
        onAction={(key) =>
          router.push(getItemPath(props.basePath, props.collection, key))
        }
        renderEmptyState={() => (
          <EmptyState
            icon={searchXIcon}
            title={stringFormatter.format("noResultsTitle")}
            message={stringFormatter.format("noResultsMessage", {
              term: searchTerm,
            })}
          />
        )}
      />
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
      <DialogContainer onDismiss={() => setContentPreview(null)}>
        {contentPreview &&
          (() => {
            const text = contentTextsByEntry
              ?.get(contentPreview.name)
              ?.get(contentPreview.fieldKey);
            if (text === undefined) return null;
            const descriptor = columnDescriptors.find(
              (d) => d.key === contentPreview.fieldKey,
            );
            return (
              <ContentPreviewDialog
                label={descriptor?.label ?? contentPreview.label}
                text={text}
                matchIndices={contentMatchesByEntry
                  .get(contentPreview.name)
                  ?.get(contentPreview.fieldKey)}
              />
            );
          })()}
      </DialogContainer>
    </>
  );
}

function cellTextValue(
  descriptor: ColumnDescriptor,
  value: unknown,
  itemSlug: string,
): string {
  if (descriptor.displayKind === "name") {
    return typeof value === "string" && value ? value : itemSlug;
  }
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.join(", ");
  return "";
}

function getItemPath(
  basePath: string,
  collection: string,
  key: string | number,
): string {
  return `${basePath}/collection/${encodeURIComponent(
    collection,
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

// block-level elements a ProseMirror content body can contain - a boundary
// here gets a space inserted after it, so "</p><p>" doesn't fuse the last
// word of one paragraph onto the first word of the next (plain
// `.textContent` does exactly that, since it has no notion of layout).
const BLOCK_TAGS = new Set([
  "P",
  "DIV",
  "LI",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "BR",
  "TR",
  "TD",
  "TH",
  "TABLE",
  "UL",
  "OL",
  "BLOCKQUOTE",
  "FIGURE",
  "FIGCAPTION",
  "SECTION",
  "ARTICLE",
  "HR",
]);

function collectText(node: Node, out: string[]): void {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      out.push(child.textContent ?? "");
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      const el = child as Element;
      // script/style children are text nodes to the DOM even though a
      // browser never renders them - skip rather than let their raw source
      // (e.g. the responsive-grid CSS embedded in some content bodies) leak
      // into the search index and highlighted snippets.
      if (el.tagName === "SCRIPT" || el.tagName === "STYLE") continue;
      collectText(el, out);
      if (BLOCK_TAGS.has(el.tagName)) out.push(" ");
    }
  }
}

// fields.content() bodies are serialized ProseMirror HTML - parsing through
// the DOM (rather than stripping tags with a regex) gets tag soup and
// entities right for free, matching how a browser would actually decode it.
function htmlToSearchableText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const parts: string[] = [];
  collectText(doc.body, parts);
  return parts.join("").replace(/\s+/g, " ").trim();
}
