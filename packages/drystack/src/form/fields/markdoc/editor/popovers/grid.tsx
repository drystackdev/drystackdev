import { useState } from "react";
import { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../../app/l10n";

import { ActionButton } from "@keystar/ui/button";
import {
  AlertDialog,
  DialogContainer,
  DialogTrigger,
} from "@keystar/ui/dialog";
import { plusIcon } from "@keystar/ui/icon/icons/plusIcon";
import { Icon } from "@keystar/ui/icon";
import { xIcon } from "@keystar/ui/icon/icons/xIcon";
import { Divider, Flex } from "@keystar/ui/layout";
import { Picker, Item } from "@keystar/ui/picker";
import { css, tokenSchema } from "@keystar/ui/style";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";

import { useEditorDispatchCommand, useEditorState } from "../editor-view";
import { CaptionButton } from "../figcaption";
import {
  addCell,
  deleteFocusedCell,
  findGridCell,
  gridHasContent,
  setFocusedCellPlace,
  GridPlace,
  GRID_GAP_OPTIONS,
} from "../grid";

// "Remove grid" icon (a layout box with a torn corner) - not in @keystar/ui's
// bundled set, but drawn in the same 24×24 stroke convention as its other
// icons, so it goes through <Icon> like any of them.
const gridDeleteIcon = (
  <path d="M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3m13 4l5 5m-5 0l5-5" />
);

const spacingFieldWidth = 110;

// Grid track counts (columns/rows) aren't user-configurable - columns are a
// fixed 12-unit grid, rows auto-grow to fit the tallest cell (see grid.ts's
// GRID_DEFAULT_COLUMNS and GridCellView's commitSpans). Spacing is the only
// grid-wide setting left, so it lives directly on the toolbar rather than
// behind a settings menu.
function GridSpacingPicker(props: { node: Node; pos: number }) {
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const gap = props.node.attrs.gap as string;
  return (
    <TooltipTrigger>
      <Picker
        aria-label={stringFormatter.format("gridSpacing")}
        selectedKey={gap}
        onSelectionChange={(key) => {
          const value = String(key);
          runCommand((state, dispatch) => {
            if (dispatch) {
              dispatch(state.tr.setNodeAttribute(props.pos, "gap", value));
            }
            return true;
          });
        }}
        UNSAFE_style={{ width: spacingFieldWidth }}
      >
        {GRID_GAP_OPTIONS.map((g) => (
          <Item key={g}>{g.replace("em", "")}</Item>
        ))}
      </Picker>
      <Tooltip>{stringFormatter.format("gridSpacing")}</Tooltip>
    </TooltipTrigger>
  );
}

// Item layout - an icon button that opens a 3×3 alignment picker built from
// Tabler `box-align-*` glyphs (a box with the marker in the matching corner /
// edge; the plain box = center). The cell matching the focused cell's current
// placement is highlighted; clicking it again clears back to the default
// (top, full width). The popover stays open on click so several alignments
// can be tried in a row.
const PLACES: { place: GridPlace; labelKey: string; path: string }[] = [
  {
    place: "start start",
    labelKey: "gridPlaceTopLeft",
    path: "M11 5v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1m4-1h-.01M20 4h-.01M20 9h-.01m.01 6h-.01M4 15h-.01M20 20h-.01M15 20h-.01M9 20h-.01M4 20h-.01",
  },
  {
    place: "start center",
    labelKey: "gridPlaceTopCenter",
    path: "M4 10.005h16v-5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1zm0 5v-.01m0 5.01v-.01m5 .01v-.01m6 .01v-.01m5 .01v-.01m0-4.99v-.01",
  },
  {
    place: "start end",
    labelKey: "gridPlaceTopRight",
    path: "M19 11.01h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1m1 4V15m0 5.01V20m-5 .01V20m-6 .01V20M9 4.01V4M4 20.01V20m0-4.99V15m0-5.99V9m0-4.99V4",
  },
  {
    place: "center start",
    labelKey: "gridPlaceMiddleLeft",
    path: "M10.002 20.003v-16h-5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1zm5 0h-.01m5.011 0h-.011m.011-5.001h-.011m.011-6h-.011m.011-5h-.011m-4.99 0h-.01",
  },
  {
    place: "center center",
    labelKey: "gridPlaceCenter",
    path: "m12 3l8 4.5v9L12 21l-8-4.5v-9zm0 9l8-4.5M12 12v9m0-9L4 7.5",
  },
  {
    place: "center end",
    labelKey: "gridPlaceMiddleRight",
    path: "M13.998 20.003v-16h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1zm-5 0h.01m-5.011 0h.011m-.011-5.001h.011m-.011-6h.011m-.011-5h.011m4.99 0h.01",
  },
  {
    place: "end start",
    labelKey: "gridPlaceBottomLeft",
    path: "M5 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1M4 9v.01M4 4v.01M9 4v.01M15 4v.01M15 20v.01M20 4v.01M20 9v.01M20 15v.01M20 20v.01",
  },
  {
    place: "end center",
    labelKey: "gridPlaceBottomCenter",
    path: "M4 14h16v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm0-5v.01M4 4v.01M9 4v.01M15 4v.01M20 4v.01M20 9v.01",
  },
  {
    place: "end end",
    labelKey: "gridPlaceBottomRight",
    path: "M19 13h-5a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1h5a1 1 0 0 0 1-1v-5a1 1 0 0 0-1-1m1-4v.01M20 4v.01M15 4v.01M9 4v.01M9 20v.01M4 4v.01M4 9v.01M4 15v.01M4 20v.01",
  },
];

// the box-align glyph for a given placement. `null`/unplaced falls back to the
// top-left glyph - matching how unplaced content actually flows (top, full
// width). Reused by both the toolbar button and the 3×3 picker.
function PlaceGlyph(props: { place: GridPlace; size?: number }) {
  const size = props.size ?? 20;
  const entry =
    PLACES.find((p) => p.place === (props.place ?? "start start")) ?? PLACES[0];
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={entry.path} />
    </svg>
  );
}

function GridLayoutMenu(props: { state: EditorState }) {
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const cell = findGridCell(props.state);
  const current: GridPlace = cell?.node.attrs.place ?? null;
  return (
    <DialogTrigger type="popover" hideArrow>
      <ActionButton
        prominence="low"
        isDisabled={!cell}
        aria-label={stringFormatter.format("gridItemLayout")}
      >
        {/* icon mirrors the active item's current placement (top-left if none) */}
        <PlaceGlyph place={current} />
      </ActionButton>
      <div
        className={layoutPanelClass}
        role="group"
        aria-label={stringFormatter.format("gridItemLayout")}
      >
        {PLACES.map(({ place, labelKey }) => {
          const active = current === place;
          return (
            <button
              key={place ?? "none"}
              type="button"
              aria-label={stringFormatter.format(labelKey)}
              aria-pressed={active}
              className={active ? layoutCellActiveClass : layoutCellClass}
              // keep the editor selection inside the focused cell - otherwise
              // pressing would blur it before the command runs
              onMouseDown={(event) => event.preventDefault()}
              onClick={() =>
                runCommand(setFocusedCellPlace(active ? null : place))
              }
            >
              <PlaceGlyph place={place} size={18} />
            </button>
          );
        })}
      </div>
    </DialogTrigger>
  );
}

const layoutPanelClass = css({
  display: "grid",
  gridTemplateColumns: "repeat(3, auto)",
  gap: tokenSchema.size.space.xsmall,
  padding: tokenSchema.size.space.regular,
});

const layoutCellClass = css({
  width: 28,
  height: 28,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 0,
  border: "none",
  background: "transparent",
  cursor: "pointer",
  borderRadius: tokenSchema.size.radius.small,
  color: tokenSchema.color.foreground.neutralSecondary,
  "&:hover": { color: tokenSchema.color.foreground.neutral },
});

// mirror keystar's selected low-prominence ActionButton (neutralSecondary
// fill, inverse foreground) so the active cell matches every other selected
// button - the old accent fill + canvas foreground read as hardcoded black
const layoutCellActiveClass = css(layoutCellClass, {
  backgroundColor: tokenSchema.color.foreground.neutralSecondary,
  color: tokenSchema.color.foreground.inverse,
  "&:hover": {
    backgroundColor: tokenSchema.color.foreground.neutral,
    color: tokenSchema.color.foreground.inverse,
  },
});

// The grid-wide controls (settings, item layout, add/delete item) - shared
// between the grid's own popover and the merged table-in-grid popover (see
// `TableInGridPopover` in `popovers/index.tsx`), which needs these alongside
// the table's own controls since a table's popover otherwise shadows its
// enclosing grid's.
export function GridItemControls(props: {
  node: Node;
  state: EditorState;
  pos: number;
}) {
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  // "delete item" targets the focused cell - disabled until one is focused
  const hasCell = findGridCell(props.state) !== null;

  return (
    <>
      <GridSpacingPicker node={props.node} pos={props.pos} />
      <CaptionButton
        caption={props.node.attrs.caption}
        subject={stringFormatter.format("captionGrid")}
        onSubmit={(caption) => {
          runCommand((state, dispatch) => {
            if (dispatch) {
              dispatch(state.tr.setNodeAttribute(props.pos, "caption", caption));
            }
            return true;
          });
        }}
      />
      <GridLayoutMenu state={props.state} />
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label={stringFormatter.format("gridAddItem")}
          onPress={() => runCommand(addCell)}
        >
          <Icon src={plusIcon} />
        </ActionButton>
        <Tooltip>{stringFormatter.format("gridAddItem")}</Tooltip>
      </TooltipTrigger>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label={stringFormatter.format("gridDeleteItem")}
          isDisabled={!hasCell}
          onPress={() => runCommand(deleteFocusedCell)}
        >
          <Icon src={xIcon} />
        </ActionButton>
        <Tooltip>{stringFormatter.format("gridDeleteItem")}</Tooltip>
      </TooltipTrigger>
    </>
  );
}

export function GridPopover(props: {
  node: Node;
  state: EditorState;
  pos: number;
}) {
  const runCommand = useEditorDispatchCommand();
  const state = useEditorState();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const deleteGrid = () => {
    runCommand((s, dispatch) => {
      if (dispatch) {
        dispatch(s.tr.delete(props.pos, props.pos + props.node.nodeSize));
      }
      return true;
    });
  };

  return (
    <Flex gap="regular" padding="regular" alignItems="center">
      <GridItemControls node={props.node} state={state} pos={props.pos} />
      <Divider orientation="vertical" />
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          onPress={() => {
            if (gridHasContent(props.node)) {
              setConfirmOpen(true);
            } else {
              deleteGrid();
            }
          }}
        >
          <Icon src={gridDeleteIcon} />
        </ActionButton>
        <Tooltip tone="critical">{stringFormatter.format("gridRemoveTooltip")}</Tooltip>
      </TooltipTrigger>
      <DialogContainer onDismiss={() => setConfirmOpen(false)}>
        {confirmOpen && (
          <AlertDialog
            title={stringFormatter.format("gridRemoveConfirmTitle")}
            tone="critical"
            cancelLabel={stringFormatter.format("cancel")}
            primaryActionLabel={stringFormatter.format("remove")}
            onPrimaryAction={deleteGrid}
          >
            {stringFormatter.format("gridRemoveConfirmBody")}
          </AlertDialog>
        )}
      </DialogContainer>
    </Flex>
  );
}
