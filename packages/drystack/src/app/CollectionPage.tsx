import { useLocalizedStringFormatter } from "@react-aria/i18n";
import Fuse from "fuse.js";
import { isHotkey } from "is-hotkey";
import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ActionButton, Button } from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { alertCircleIcon } from "@keystar/ui/icon/icons/alertCircleIcon";
import { listXIcon } from "@keystar/ui/icon/icons/listXIcon";
import { searchIcon } from "@keystar/ui/icon/icons/searchIcon";
import { searchXIcon } from "@keystar/ui/icon/icons/searchXIcon";
import { diffIcon } from "@keystar/ui/icon/icons/diffIcon";
import { plusSquareIcon } from "@keystar/ui/icon/icons/plusSquareIcon";
import { dotSquareIcon } from "@keystar/ui/icon/icons/dotSquareIcon";
import { Flex } from "@keystar/ui/layout";
import { TextLink } from "@keystar/ui/link";
import { ProgressCircle } from "@keystar/ui/progress";
import { SearchField } from "@keystar/ui/search-field";
import {
  breakpointQueries,
  css,
  tokenSchema,
  useMediaQuery,
} from "@keystar/ui/style";
import {
  TableView,
  TableBody,
  TableHeader,
  Column,
  Cell,
  Row,
  SortDescriptor,
} from "@keystar/ui/table";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Heading, Text } from "@keystar/ui/typography";

import { Config } from "../config";
import { sortBy } from "./collection-sort";
import { renderColumnCell } from "./collection-table/cells";
import {
  ColumnDescriptor,
  columnValueToSearchText,
  getDisplayKind,
} from "./collection-table/column-model";
import { ColumnsMenu } from "./collection-table/ColumnsMenu";
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
import { useTree, TreeData, useBaseCommit, useRepoInfo } from "./shell/data";
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
import { useClient } from "urql";

// document + magnifier glyph for the "search content" toggle - not part of
// @keystar/ui's stroke-icon set (see searchIcon), so its paths carry their
// own fill instead of relying on the shared --kui-icon-stroke variable.
// Authored for a 20x20 grid (Icon's wrapper svg hardcodes viewBox="0 0 24
// 24"), so scaled 1.2x (24/20) to fill the same box as every other icon.
const contentSearchIcon = (
  <path
    strokeWidth={0.5}
    fill="currentColor"
    fillRule="evenodd"
    d="M10.944 1.25h2.112c1.838 0 3.294 0 4.433.153c1.172.158 2.121.49 2.87 1.238c.748.749 1.08 1.698 1.238 2.87c.153 1.14.153 2.595.153 4.433v4.112c0 1.838 0 3.294-.153 4.433c-.158 1.172-.49 2.121-1.238 2.87c-.749.748-1.698 1.08-2.87 1.238c-1.14.153-2.595.153-4.433.153h-2.112c-1.838 0-3.294 0-4.433-.153c-1.172-.158-2.121-.49-2.87-1.238c-.748-.749-1.08-1.698-1.238-2.87c-.153-1.14-.153-2.595-.153-4.433V9.944c0-1.838 0-3.294.153-4.433c.158-1.172.49-2.121 1.238-2.87c.749-.748 1.698-1.08 2.87-1.238c1.14-.153 2.595-.153 4.433-.153M6.71 2.89c-1.006.135-1.586.389-2.01.812c-.422.423-.676 1.003-.811 2.009c-.138 1.028-.14 2.382-.14 4.289v4c0 1.907.002 3.262.14 4.29c.135 1.005.389 1.585.812 2.008s1.003.677 2.009.812c1.028.138 2.382.14 4.289.14h2c1.907 0 3.262-.002 4.29-.14c1.005-.135 1.585-.389 2.008-.812s.677-1.003.812-2.009c.138-1.027.14-2.382.14-4.289v-4c0-1.907-.002-3.261-.14-4.29c-.135-1.005-.389-1.585-.812-2.008s-1.003-.677-2.009-.812c-1.027-.138-2.382-.14-4.289-.14h-2c-1.907 0-3.261.002-4.29.14M7.25 10A.75.75 0 0 1 8 9.25h8a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75m0 4a.75.75 0 0 1 .75-.75h5a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75"
    clipRule="evenodd"
  />
);

// ActionButton's own `isSelected` styling is a neutral gray, targeted via a
// compound `&:not([data-prominence])[data-selected]` selector (see
// useActionButtonStyles.tsx) - there's no built-in prop for the app's
// primary/accent color. A same-specificity override here loses the
// cascade tie to that selector's extra `:not(...)` clause regardless of
// insertion order (module-level css() runs at import time, before
// ActionButton's own css() call from its first render, so ours is
// actually the *earlier* rule) - `!important` sidesteps the specificity
// fight entirely rather than trying to out-specify it. Colors match the
// `indigo9/10/11` scale steps the "Add" button (Button prominence="high"
// tone="accent") uses, so the toggle reads as the same primary color.
const contentSearchToggleStyle = css({
  "&[data-selected]": {
    backgroundColor: `${tokenSchema.color.scale.indigo9} !important`,
    borderColor: `${tokenSchema.color.scale.indigo9} !important`,
    color: `${tokenSchema.color.foreground.onEmphasis} !important`,
  },
  "&[data-selected][data-interaction=hover]": {
    backgroundColor: `${tokenSchema.color.scale.indigo10} !important`,
    borderColor: `${tokenSchema.color.scale.indigo10} !important`,
  },
  "&[data-selected][data-interaction=press]": {
    backgroundColor: `${tokenSchema.color.scale.indigo11} !important`,
    borderColor: `${tokenSchema.color.scale.indigo11} !important`,
  },
});

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

function CollectionToolbar(props: {
  searchTerm: string;
  onSearchTermChange: (value: string) => void;
  columns: ColumnDescriptor[];
  hiddenColumns: ReadonlySet<string>;
  onHiddenColumnsChange: (hidden: Set<string>) => void;
  searchContent: boolean;
  onSearchContentChange: (value: boolean) => void;
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

      if (isHotkey("mod+f", event)) {
        event.preventDefault();
        searchRef.current?.select();
      }
    };
    document.addEventListener("keydown", listener);
    return () => document.removeEventListener("keydown", listener);
  }, []);

  return (
    <Flex
      alignItems="center"
      justifyContent="flex-end"
      gap="regular"
      paddingTop={{ tablet: "large" }}
      UNSAFE_className={css({
        // Tighter than the table below it: with the content toggle now always
        // on screen, the open search field and three buttons need the room.
        marginInline: tokenSchema.size.space.small,
        [breakpointQueries.above.mobile]: {
          marginInline: `calc(${tokenSchema.size.space.xlarge} - ${tokenSchema.size.space.medium})`,
        },
        [breakpointQueries.above.tablet]: {
          marginInline: `calc(${tokenSchema.size.space.xxlarge} - ${tokenSchema.size.space.medium})`,
        },
      })}
    >
      <Flex role="search" alignItems="center" gap="regular">
        <SearchField
          ref={searchRef}
          // Only the field itself collapses on mobile - the content toggle
          // beside it stays put, like the columns menu. It's a persistent
          // preference for how the collection is searched, so hiding it behind
          // the field made it look like it had been turned off.
          isHidden={!searchVisible}
          aria-label={stringFormatter.format("search")} // TODO: l10n "Search {collection}"?
          onChange={props.onSearchTermChange}
          onClear={() => {
            props.onSearchTermChange("");
            if (!isAboveMobile) {
              setTimeout(() => {
                setSearchVisible(false);
              }, 250);
            }
          }}
          onBlur={() => {
            if (!isAboveMobile && props.searchTerm === "") {
              setSearchVisible(false);
            }
          }}
          placeholder={stringFormatter.format("search")}
          value={props.searchTerm}
          width="scale.2400"
        />
        <TooltipTrigger>
          <ActionButton
            aria-label={stringFormatter.format("searchContent")}
            isSelected={props.searchContent}
            onPress={() => props.onSearchContentChange(!props.searchContent)}
            UNSAFE_className={contentSearchToggleStyle}
          >
            <Icon src={contentSearchIcon} />
          </ActionButton>
          <Tooltip>{stringFormatter.format("searchContentHelp")}</Tooltip>
        </TooltipTrigger>
      </Flex>
      <ActionButton
        aria-label={stringFormatter.format("showSearchAriaLabel")}
        isHidden={searchVisible || { above: "mobile" }}
        onPress={() => {
          setSearchVisible(true);
          // NOTE: this hack is to force the search field to focus, and invoke
          // the software keyboard on mobile safari
          let tempInput = document.createElement("input");
          tempInput.style.position = "absolute";
          tempInput.style.opacity = "0";
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
const COLUMN_MIN_WIDTH = 100;

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

  const client = useClient();
  const repoInfo = useRepoInfo();
  let router = useRouter();
  const collection = props.config.collections![props.collection]!;
  let [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: collection.slugField,
    direction: "ascending",
  });

  const baseCommit = useBaseCommit();

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
        client,
        entriesWithStatus.map((entry) => ({
          oid: entry.sha,
          filepath: getEntryDataFilepath(
            getCollectionItemPath(props.config, props.collection, entry.name),
            formatInfo,
          ),
        })),
        baseCommit,
        repoInfo,
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
      baseCommit,
      repoInfo,
      router.basePath,
      client,
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
        client,
        requests.map((r) => ({ oid: r.oid, filepath: r.filepath })),
        baseCommit,
        repoInfo,
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
      client,
      baseCommit,
      repoInfo,
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

  // live drag feedback for controlled column widths - react-stately only
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
        : [{ name: "Status", key: STATUS, minWidth: 32, width: 32 }]),
      ...columnDescriptors.map((c) => ({
        name: c.label,
        key: c.key,
        // the last column never gets a stored width - it's left to grow or
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
  // key - used both to snapshot the layout right as a drag starts (giving
  // resize deltas a stable baseline) and to persist the layout once a drag
  // ends, since react-stately's own resize widths map is only reliable for
  // the dragged column itself (see findDraggedColumn below).
  const measureHeaderWidths = useCallback(() => {
    const container = tableWrapperRef.current;
    const widths = new Map<string, number>();
    let total = 0;
    if (!container) return { widths, total };
    const headers = Array.from(
      container.querySelectorAll<HTMLElement>('[role="columnheader"]'),
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

  // batches onResize drag ticks - declared here since
  // commitColumnWidthsFromDom also needs to cancel a still-pending frame
  // when a drag ends
  const pendingWidthsRef = useRef<Map<React.Key, unknown> | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  // pixel widths of every column, measured right as the current drag
  // started - the baseline resize deltas below are computed against
  const resizeStartWidthsRef = useRef<Map<string, number> | null>(null);

  // react-stately's resize widths map only carries a live, accurate pixel
  // value for the dragged column itself - every other column falls back to
  // its current `width` prop unchanged. That's normally enough to tell the
  // dragged column apart from the rest (its entry is the only "fresh" one),
  // but since we deliberately feed a fresh pixel value to its neighbor too
  // (to make the neighbor visibly absorb the difference), the neighbor's
  // entry becomes numeric on the very next tick as well - which would make
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
        container.querySelectorAll<HTMLElement>('[role="columnheader"]'),
      );
      const draggedIndex = headers.findIndex(
        (el) => el.querySelector('[data-resizing="true"]') != null,
      );
      const col = columns[draggedIndex];
      if (!col) return null;
      const draggedKey = String(col.key);
      const raw = widths.get(col.key);
      const draggedPx = typeof raw === "number" ? raw : Number(raw);
      if (!Number.isFinite(draggedPx)) return null;
      const neighbor = columns[draggedIndex + 1];
      return {
        draggedKey,
        draggedPx,
        neighborKey: neighbor ? String(neighbor.key) : null,
      };
    },
    [columns],
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
        // - leave every other column's persisted width untouched
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
      // the ephemeral drag-tracking overrides in favor of them - including
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
    [columnDescriptors, findDraggedColumn, measureHeaderWidths, props],
  );

  // mirrors each drag tick into local state so the dragged column and its
  // immediate neighbor visibly track the pointer, transferring width
  // between just the two of them - see the comment on findDraggedColumn
  // above for why the neighbor needs to be computed by hand rather than
  // read off react-stately's own widths map. `onResize` fires on every
  // pointermove, which can be far more often than the screen actually
  // repaints, so a state update per event just piles up redundant
  // re-renders (visible as jank) without any visual benefit - coalesce
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
        // minimum - clamp the delta so the dragged column can't grow past
        // what the neighbor is actually able to hand over
        if (newNeighborPx < COLUMN_MIN_WIDTH) {
          delta = startNeighborPx - COLUMN_MIN_WIDTH;
          newNeighborPx = COLUMN_MIN_WIDTH;
          update[dragged.draggedKey] = startDraggedPx + delta;
        }
        update[dragged.neighborKey] = newNeighborPx;
      }
    }
    setLiveColumnWidths((prev) => ({ ...prev, ...update }));
  }, [findDraggedColumn]);
  const onColumnResize = useCallback(
    (widths: Map<React.Key, unknown>) => {
      pendingWidthsRef.current = widths;
      if (resizeRafRef.current == null) {
        resizeRafRef.current = requestAnimationFrame(flushPendingResize);
      }
    },
    [flushPendingResize],
  );
  useEffect(() => {
    return () => {
      if (resizeRafRef.current != null) {
        cancelAnimationFrame(resizeRafRef.current);
      }
    };
  }, []);

  return (
    <>
      <div ref={tableWrapperRef} className={css({ display: "contents" })}>
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
          onAction={(key) => {
            router.push(
              getItemPath(
                props.basePath,
                props.collection,
                key.toString().slice("key:".length),
              ),
            );
          }}
          renderEmptyState={() => (
            <EmptyState
              icon={searchXIcon}
              title={stringFormatter.format("noResultsTitle")}
              message={stringFormatter.format("noResultsMessage", {
                term: searchTerm,
              })}
            />
          )}
          flex
          marginTop={{ tablet: "large" }}
          marginBottom={{ mobile: "regular", tablet: "xlarge" }}
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

            "[role=rowheader]": {
              cursor: "pointer",
            },
            "[role=gridcell], [role=rowheader]": {
              display: "flex",
              alignItems: "center",
            },
          })}
        >
          <TableHeader columns={columns}>
            {({ name, key, ...options }) =>
              key === STATUS ? (
                <Column key={key} isRowHeader allowsSorting {...options}>
                  <Icon
                    aria-label={stringFormatter.format("statusColumnAriaLabel")}
                    src={diffIcon}
                  />
                </Column>
              ) : (
                <Column key={key} isRowHeader allowsSorting {...options}>
                  {name}
                </Column>
              )
            }
          </TableHeader>
          <TableBody items={tableItems}>
            {(item) => {
              const statusCell = (
                <Cell
                  key={STATUS + item.name}
                  textValue={stringFormatter.format(
                    item.status === "Added"
                      ? "statusAdded"
                      : item.status === "Changed"
                        ? "statusChanged"
                        : "statusUnchanged",
                  )}
                >
                  {item.status === "Added" ? (
                    <Icon color="positive" src={plusSquareIcon} />
                  ) : item.status === "Changed" ? (
                    <Icon color="accent" src={dotSquareIcon} />
                  ) : null}
                </Cell>
              );
              const row = item.data ?? {};
              return (
                <Row key={"key:" + item.name}>
                  {[
                    ...(hideStatusColumn ? [] : [statusCell]),
                    ...columnDescriptors.map((descriptor) => {
                      const value = row[descriptor.key];
                      const contentText =
                        descriptor.displayKind === "content"
                          ? item.contentTexts?.get(descriptor.key)
                          : undefined;
                      const contentCtx =
                        descriptor.displayKind === "content"
                          ? {
                              fullText: contentText,
                              matchIndices: item.contentMatches?.get(
                                descriptor.key,
                              ),
                              isClickable:
                                props.searchContent &&
                                contentText !== undefined,
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
                            text: columnValueToSearchText(
                              descriptor,
                              value,
                              item.name,
                            ),
                            indices: columnMatchIndices,
                          }
                        : undefined;
                      return (
                        <Cell
                          key={descriptor.key + item.name}
                          textValue={cellTextValue(
                            descriptor,
                            value,
                            item.name,
                          )}
                        >
                          {renderColumnCell(descriptor, value, item.name, {
                            onRequestCheckboxEdit: setPendingCheckboxEdit,
                            content: contentCtx,
                            match: matchCtx,
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
