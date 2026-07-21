import React, {
  ReactElement,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { breakpointQueries, css, tokenSchema } from "@keystar/ui/style";
import {
  Cell,
  Column,
  Row,
  SortDescriptor,
  TableBody,
  TableHeader,
  TableView,
} from "@keystar/ui/table";

import { ColumnDescriptor } from "./column-model";

const COLUMN_MIN_WIDTH = 100;

// The rendered content of a single table cell: the node plus the plain-text
// value react-aria uses for its typeahead / accessible name.
export type RenderedCell = { node: ReactNode; textValue: string };

// A schema-driven data column: resizable, sortable, hideable - the collection's
// entry fields, or a user's profile fields (+ email/createdAt). The last data
// column is left widthless so it absorbs whatever horizontal slack the others
// don't claim (matching the collection table's original behavior).
export type DataColumn<Item> = {
  descriptor: ColumnDescriptor;
  renderCell: (item: Item) => RenderedCell;
};

// A fixed fixture column that frames the data columns - status (collection),
// avatar / delete-actions (users). Not resizable; renders at a fixed width and
// may hide its header. `isRowHeader`/`allowsSorting` default off.
export type FixtureColumn<Item> = {
  key: string;
  label: string;
  width?: number;
  minWidth?: number;
  hideHeader?: boolean;
  isRowHeader?: boolean;
  allowsSorting?: boolean;
  header?: ReactNode; // custom header content (e.g. an icon); defaults to `label`
  renderCell: (item: Item) => RenderedCell;
};

type ColumnModel<Item> = {
  key: string;
  header: ReactNode;
  width: number | string | undefined;
  minWidth: number | undefined;
  allowsResizing: boolean;
  allowsSorting: boolean;
  isRowHeader: boolean;
  hideHeader: boolean;
  renderCell: (item: Item) => RenderedCell;
};

export type EntityTableViewProps<Item> = {
  dataColumns: DataColumn<Item>[];
  leadingColumns?: FixtureColumn<Item>[];
  trailingColumns?: FixtureColumn<Item>[];
  items: Item[];
  getItemKey: (item: Item) => string;
  sortDescriptor: SortDescriptor;
  onSortChange: (descriptor: SortDescriptor) => void;
  columnWidths: Record<string, string> | undefined;
  onColumnWidthsChange: (widths: Record<string, string>) => void;
  onAction: (key: string) => void;
  renderEmptyState: () => ReactElement;
  "aria-labelledby"?: string;
};

// The shared, data-source-agnostic table shell used by the collection list
// (CollectionPage). Owns the virtualized TableView, the header/row
// scaffolding, and the drag-to-resize engine (persisted column widths).
// Callers supply the columns and per-cell renderers; where the rows come
// from (git tree vs. REST) is none of its
// business.
export function EntityTableView<Item>(props: EntityTableViewProps<Item>) {
  const {
    dataColumns,
    leadingColumns = [],
    trailingColumns = [],
    items,
    getItemKey,
    columnWidths,
  } = props;

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

  const dataKeys = useMemo(
    () => dataColumns.map((c) => c.descriptor.key),
    [dataColumns],
  );
  const lastDataKey = dataKeys[dataKeys.length - 1];
  // only the non-last data columns carry a persisted width - the last one is
  // widthless (absorbs slack), and fixture columns are fixed-width.
  const resizableKeys = useMemo(
    () => new Set(dataKeys.filter((key) => key !== lastDataKey)),
    [dataKeys, lastDataKey],
  );
  const dataKeySet = useMemo(() => new Set(dataKeys), [dataKeys]);

  const columns = useMemo<ColumnModel<Item>[]>(() => {
    const fixture = (
      col: FixtureColumn<Item>,
    ): ColumnModel<Item> => ({
      key: col.key,
      header: col.header ?? col.label,
      width: col.width,
      minWidth: col.minWidth ?? col.width,
      allowsResizing: false,
      allowsSorting: col.allowsSorting ?? false,
      isRowHeader: col.isRowHeader ?? false,
      hideHeader: col.hideHeader ?? false,
      renderCell: col.renderCell,
    });
    return [
      ...leadingColumns.map(fixture),
      ...dataColumns.map((c) => ({
        key: c.descriptor.key,
        header: c.descriptor.label,
        // the last column never gets a stored width - it's left to grow or
        // shrink to whatever space the others don't claim, absorbing any
        // slack left behind by showing/hiding columns
        width:
          c.descriptor.key === lastDataKey
            ? undefined
            : (liveColumnWidths[c.descriptor.key] ??
              columnWidths?.[c.descriptor.key]),
        minWidth: COLUMN_MIN_WIDTH,
        allowsResizing: true,
        allowsSorting: true,
        isRowHeader: true,
        hideHeader: false,
        renderCell: c.renderCell,
      })),
      ...trailingColumns.map(fixture),
    ];
  }, [
    leadingColumns,
    dataColumns,
    trailingColumns,
    lastDataKey,
    liveColumnWidths,
    columnWidths,
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
      // only transfer width to a neighbor that's actually a resizable data
      // column - a fixed fixture (e.g. the trailing actions column) can't
      // give or take space.
      const neighborKey =
        neighbor && dataKeySet.has(String(neighbor.key))
          ? String(neighbor.key)
          : null;
      return { draggedKey, draggedPx, neighborKey };
    },
    [columns, dataKeySet],
  );

  const onColumnResizeStart = useCallback(() => {
    resizeStartWidthsRef.current = measureHeaderWidths().widths;
  }, [measureHeaderWidths]);

  const commitColumnWidthsFromDom = useCallback(
    (widths: Map<React.Key, unknown>) => {
      const dragged = findDraggedColumn(widths);
      const { widths: measured, total } = measureHeaderWidths();
      if (dragged && total > 0) {
        // only the dragged column and its immediate neighbor changed size
        // - leave every other column's persisted width untouched
        const next: Record<string, string> = { ...columnWidths };
        for (const key of [dragged.draggedKey, dragged.neighborKey]) {
          if (key == null || !resizableKeys.has(key)) continue;
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
    [findDraggedColumn, measureHeaderWidths, resizableKeys, columnWidths, props],
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
    <div ref={tableWrapperRef} className={css({ display: "contents" })}>
      <TableView
        aria-labelledby={props["aria-labelledby"]}
        selectionMode="none"
        onSortChange={props.onSortChange}
        sortDescriptor={props.sortDescriptor}
        density="spacious"
        overflowMode="wrap"
        prominence="low"
        onResizeStart={onColumnResizeStart}
        onResize={onColumnResize}
        onResizeEnd={commitColumnWidthsFromDom}
        onAction={(key) => {
          props.onAction(key.toString().slice("key:".length));
        }}
        renderEmptyState={props.renderEmptyState}
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
          {(col) => (
            <Column
              key={col.key}
              width={col.width}
              minWidth={col.minWidth}
              allowsResizing={col.allowsResizing}
              allowsSorting={col.allowsSorting}
              isRowHeader={col.isRowHeader}
              hideHeader={col.hideHeader}
            >
              {col.header}
            </Column>
          )}
        </TableHeader>
        <TableBody items={items}>
          {(item) => (
            <Row key={"key:" + getItemKey(item)}>
              {columns.map((col) => {
                const cell = col.renderCell(item);
                return (
                  <Cell
                    key={col.key + getItemKey(item)}
                    textValue={cell.textValue}
                  >
                    {cell.node}
                  </Cell>
                );
              })}
            </Row>
          )}
        </TableBody>
      </TableView>
    </div>
  );
}
