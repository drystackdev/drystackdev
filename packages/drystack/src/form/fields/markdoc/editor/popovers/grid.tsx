import { ReactElement, useState } from "react";
import { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";

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
import { Text } from "@keystar/ui/typography";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";

import { useEditorDispatchCommand, useEditorState } from "../editor-view";
import {
  addCell,
  deleteFocusedCell,
  findGridCell,
  gridHasContent,
  setFocusedCellPlace,
  setGridColumns,
  setGridRows,
  GridPlace,
  GRID_GAP_OPTIONS,
  GRID_COLUMN_OPTIONS,
  GRID_ROW_OPTIONS,
} from "../grid";

// "Remove grid" icon (a layout box with a torn corner) - not in @keystar/ui's
// bundled set, but drawn in the same 24×24 stroke convention as its other
// icons, so it goes through <Icon> like any of them.
const gridDeleteIcon = (
  <path d="M12 3v17a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v6a1 1 0 0 1-1 1H3m13 4l5 5m-5 0l5-5" />
);

// Not in @keystar/ui's bundled (Tabler-derived) icon set, so drawn directly
// rather than through <Icon> - that wrapper assumes a 24×24 stroke-only
// glyph, but this one is a filled 16×16 shape.
function GridSettingsIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 16 16"
      aria-hidden="true"
    >
      <path d="M0 0h16v16H0z" fill="none" />
      <path
        fill="currentColor"
        d="M2 10h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1v-3a1 1 0 0 1 1-1m9-9h3a1 1 0 0 1 1 1v3a1 1 0 0 1-1 1h-3a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1m0 9a1 1 0 0 0-1 1v3a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1zm0-10a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2V2a2 2 0 0 0-2-2zM2 9a2 2 0 0 0-2 2v3a2 2 0 0 0 2 2h3a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2zm7 2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2h-3a2 2 0 0 1-2-2zM0 2a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v3a2 2 0 0 1-2 2H2a2 2 0 0 1-2-2zm5.354.854a.5.5 0 1 0-.708-.708L3 3.793l-.646-.647a.5.5 0 1 0-.708.708l1 1a.5.5 0 0 0 .708 0z"
      />
    </svg>
  );
}

// Keystar's `Picker` stacks its label above the field (no `labelPosition`
// prop in this version) - this puts the label to the left instead, matching
// the settings panel's row layout, and lets the field itself stay narrow
// since these are all short values (a track count, a CSS length).
function SettingRow(props: { label: string; children: ReactElement }) {
  return (
    <Flex direction="row" alignItems="center" justifyContent="space-between">
      <Text>{props.label}</Text>
      {props.children}
    </Flex>
  );
}

const settingFieldWidth = 90;

// The gear opens a settings panel (keystar's Menu has no nested submenus, so
// the grid-wide controls - columns, rows, gap - live in a popover instead of
// as separate toolbar buttons). Add/delete item live as their own +/x
// buttons on the toolbar (see GridPopover).
function GridSettingsMenu(props: {
  node: Node;
  state: EditorState;
  pos: number;
}) {
  const runCommand = useEditorDispatchCommand();
  const columns = String(props.node.attrs.columns);
  const rows = String(props.node.attrs.rows);
  const gap = props.node.attrs.gap as string;
  return (
    <DialogTrigger type="popover" hideArrow>
      <ActionButton prominence="low" aria-label="Grid settings">
        <GridSettingsIcon />
      </ActionButton>
      {(close: () => void) => (
        <Flex
          direction="column"
          gap="regular"
          padding="large"
          UNSAFE_style={{ minWidth: 200 }}
        >
          <SettingRow label="Column">
            <Picker
              aria-label="Column"
              selectedKey={columns}
              onSelectionChange={(key) => {
                runCommand(
                  setGridColumns(props.pos, parseInt(String(key), 10)),
                );
                close();
              }}
              UNSAFE_style={{ width: settingFieldWidth }}
            >
              {GRID_COLUMN_OPTIONS.map((cols) => (
                <Item key={String(cols)}>{String(cols)}</Item>
              ))}
            </Picker>
          </SettingRow>
          <SettingRow label="Row">
            <Picker
              aria-label="Row"
              selectedKey={rows}
              onSelectionChange={(key) => {
                runCommand(setGridRows(props.pos, parseInt(String(key), 10)));
                close();
              }}
              UNSAFE_style={{ width: settingFieldWidth }}
            >
              {GRID_ROW_OPTIONS.map((r) => (
                <Item key={String(r)}>{String(r)}</Item>
              ))}
            </Picker>
          </SettingRow>
          <SettingRow label="Spacing">
            <Picker
              aria-label="Spacing"
              selectedKey={gap}
              onSelectionChange={(key) => {
                const value = String(key);
                runCommand((state, dispatch) => {
                  if (dispatch) {
                    dispatch(
                      state.tr.setNodeAttribute(props.pos, "gap", value),
                    );
                  }
                  return true;
                });
                close();
              }}
              UNSAFE_style={{ width: settingFieldWidth }}
            >
              {GRID_GAP_OPTIONS.map((g) => (
                <Item key={g}>{g.replace("em", "")}</Item>
              ))}
            </Picker>
          </SettingRow>
        </Flex>
      )}
    </DialogTrigger>
  );
}

// Item layout - an icon button that opens a 3×3 alignment picker built from
// Tabler `box-align-*` glyphs (a box with the marker in the matching corner /
// edge; the plain box = center). The cell matching the focused cell's current
// placement is highlighted; clicking it again clears back to the default
// (top, full width). The popover stays open on click so several alignments
// can be tried in a row.
const PLACES: { place: GridPlace; label: string; path: string }[] = [
  {
    place: "start start",
    label: "Top left",
    path: "M11 5v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1m4-1h-.01M20 4h-.01M20 9h-.01m.01 6h-.01M4 15h-.01M20 20h-.01M15 20h-.01M9 20h-.01M4 20h-.01",
  },
  {
    place: "start center",
    label: "Top center",
    path: "M4 10.005h16v-5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1zm0 5v-.01m0 5.01v-.01m5 .01v-.01m6 .01v-.01m5 .01v-.01m0-4.99v-.01",
  },
  {
    place: "start end",
    label: "Top right",
    path: "M19 11.01h-5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1m1 4V15m0 5.01V20m-5 .01V20m-6 .01V20M9 4.01V4M4 20.01V20m0-4.99V15m0-5.99V9m0-4.99V4",
  },
  {
    place: "center start",
    label: "Middle left",
    path: "M10.002 20.003v-16h-5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1zm5 0h-.01m5.011 0h-.011m.011-5.001h-.011m.011-6h-.011m.011-5h-.011m-4.99 0h-.01",
  },
  {
    place: "center center",
    label: "Center",
    path: "m12 3l8 4.5v9L12 21l-8-4.5v-9zm0 9l8-4.5M12 12v9m0-9L4 7.5",
  },
  {
    place: "center end",
    label: "Middle right",
    path: "M13.998 20.003v-16h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1zm-5 0h.01m-5.011 0h.011m-.011-5.001h.011m-.011-6h.011m-.011-5h.011m4.99 0h.01",
  },
  {
    place: "end start",
    label: "Bottom left",
    path: "M5 13h5a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-5a1 1 0 0 1 1-1M4 9v.01M4 4v.01M9 4v.01M15 4v.01M15 20v.01M20 4v.01M20 9v.01M20 15v.01M20 20v.01",
  },
  {
    place: "end center",
    label: "Bottom center",
    path: "M4 14h16v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zm0-5v.01M4 4v.01M9 4v.01M15 4v.01M20 4v.01M20 9v.01",
  },
  {
    place: "end end",
    label: "Bottom right",
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
  const cell = findGridCell(props.state);
  const current: GridPlace = cell?.node.attrs.place ?? null;
  return (
    <DialogTrigger type="popover" hideArrow>
      <ActionButton
        prominence="low"
        isDisabled={!cell}
        aria-label="Item layout"
      >
        {/* icon mirrors the active item's current placement (top-left if none) */}
        <PlaceGlyph place={current} />
      </ActionButton>
      <div className={layoutPanelClass} role="group" aria-label="Item layout">
        {PLACES.map(({ place, label }) => {
          const active = current === place;
          return (
            <button
              key={place ?? "none"}
              type="button"
              aria-label={label}
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
  // "delete item" targets the focused cell - disabled until one is focused
  const hasCell = findGridCell(props.state) !== null;

  return (
    <>
      <GridSettingsMenu node={props.node} state={props.state} pos={props.pos} />
      <GridLayoutMenu state={props.state} />
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label="Add item"
          onPress={() => runCommand(addCell)}
        >
          <Icon src={plusIcon} />
        </ActionButton>
        <Tooltip>Add item</Tooltip>
      </TooltipTrigger>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label="Delete item"
          isDisabled={!hasCell}
          onPress={() => runCommand(deleteFocusedCell)}
        >
          <Icon src={xIcon} />
        </ActionButton>
        <Tooltip>Delete item</Tooltip>
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
        <Tooltip tone="critical">Remove grid</Tooltip>
      </TooltipTrigger>
      <DialogContainer onDismiss={() => setConfirmOpen(false)}>
        {confirmOpen && (
          <AlertDialog
            title="Remove grid?"
            tone="critical"
            cancelLabel="Cancel"
            primaryActionLabel="Remove"
            onPrimaryAction={deleteGrid}
          >
            This grid still has content. Removing it will delete everything
            inside it.
          </AlertDialog>
        )}
      </DialogContainer>
    </Flex>
  );
}
