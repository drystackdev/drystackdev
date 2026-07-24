import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../../app/l10n";
import { ActionButton } from "@keystar/ui/button";
import { DialogTrigger } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { Flex } from "@keystar/ui/layout";
import { Tooltip } from "@keystar/ui/tooltip";
import { ScrollDismissTooltipTrigger } from "../ScrollDismissTooltipTrigger";
import { ReactElement } from "react";
import { Node, ResolvedPos } from "prosemirror-model";
import { Command, EditorState, Plugin, TextSelection } from "prosemirror-state";
import {
  CellSelection,
  addRowAfter,
  addRowBefore,
  deleteColumn,
  deleteRow,
  rowIsHeader,
  selectedRect,
  toggleHeader,
} from "prosemirror-tables";
import {
  addColumnAfterWithRebalance,
  addColumnBeforeWithRebalance,
  mergeCellsKeepFirst,
  unmergeCell,
} from "../commands/table";
import { useEditorDispatchCommand, useEditorState } from "../editor-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { getEditorSchema } from "../schema";

// Icons below are one-off SVGs supplied by design rather than @keystar/ui's
// bundled set - <Icon> always wraps its `src` in its own <svg viewBox="0 0
// 24 24">, so a source icon drawn to a different viewBox needs its own
// nested <svg> to establish that coordinate system, or its path coordinates
// would be read against the wrong viewBox and render shrunk/offset.
function scaledIcon(viewBox: string, path: ReactElement) {
  return (
    <svg width="24" height="24" viewBox={viewBox}>
      {path}
    </svg>
  );
}

const tableToggleHeaderIcon = scaledIcon(
  "0 0 21 21",
  <path
    fill="none"
    stroke="currentColor"
    strokeLinecap="round"
    strokeLinejoin="round"
    d="m17.498 15.498l-.01-10a2 2 0 0 0-2-1.998h-10a2 2 0 0 0-1.995 1.85l-.006.152l.01 10a2 2 0 0 0 2 1.998h10a2 2 0 0 0 1.995-1.85zM7.5 7.5v9.817m10-9.817h-14"
  />,
);

const tableDeleteRowIcon = scaledIcon(
  "0 0 16 16",
  <path
    fill="currentColor"
    d="M2 2h3v3h-.5A2.5 2.5 0 0 1 2 2.5zm8 3H6V2h4zm1 0h.5A2.5 2.5 0 0 0 14 2.5V2h-3zm3 8.5a2.5 2.5 0 0 0-2.5-2.5H11v3h3zM10 11v3H6v-3zm-5 3v-3h-.5A2.5 2.5 0 0 0 2 13.5v.5zm4.854-7.854a.5.5 0 0 1 0 .708L8.707 8l1.147 1.146a.5.5 0 0 1-.708.708L8 8.707L6.854 9.854a.5.5 0 0 1-.708-.708L7.293 8L6.146 6.854a.5.5 0 1 1 .708-.708L8 7.293l1.146-1.147a.5.5 0 0 1 .708 0M14.5 8a.5.5 0 0 1-.5.5h-3.382l-.068-.071L10.121 8l.44-.44q.03-.03.057-.06H14a.5.5 0 0 1 .5.5m-9.05.428l-.068.072H2a.5.5 0 0 1 0-1h3.382l.057.06l.44.44z"
  />,
);

const tableDeleteColumnIcon = scaledIcon(
  "0 0 16 16",
  <path
    fill="currentColor"
    d="M8 1.5a.5.5 0 0 1 .5.5v3.382l-.071.068L8 5.879l-.44-.44q-.03-.03-.06-.057V2a.5.5 0 0 1 .5-.5m.428 9.05q.035.035.072.068V14a.5.5 0 0 1-1 0v-3.382l.06-.057l.44-.44zM2.5 3A1.5 1.5 0 0 1 4 4.5V5H2.5a.5.5 0 0 0 0 1H4v4H2.5a.5.5 0 0 0 0 1H4v.5A1.5 1.5 0 0 1 2.5 13a.5.5 0 0 0 0 1A2.5 2.5 0 0 0 5 11.5v-7A2.5 2.5 0 0 0 2.5 2a.5.5 0 0 0 0 1m11-1A2.5 2.5 0 0 0 11 4.5v7a2.5 2.5 0 0 0 2.5 2.5a.5.5 0 0 0 0-1a1.5 1.5 0 0 1-1.5-1.5V11h1.5a.5.5 0 0 0 0-1H12V6h1.5a.5.5 0 0 0 0-1H12v-.5A1.5 1.5 0 0 1 13.5 3a.5.5 0 0 0 0-1M6.146 6.146a.5.5 0 0 1 .708 0L8 7.293l1.146-1.147a.5.5 0 1 1 .708.708L8.707 8l1.147 1.146a.5.5 0 0 1-.708.708L8 8.707L6.854 9.854a.5.5 0 0 1-.708-.708L7.293 8L6.146 6.854a.5.5 0 0 1 0-.708"
  />,
);

// The two "insert column" icons are mirror images of each other (the plus
// sits on whichever side the new column will land) - kept as two consts
// rather than one mirrored via CSS so their `<Icon>` aria-labels/tooltips
// stay attached to visually-distinct glyphs.
const tableInsertColumnLeftIcon = scaledIcon(
  "0 0 512 512",
  <path
    fill="currentColor"
    fillRule="evenodd"
    d="M256 106.667v42.666h-64v64h-42.667v-64h-64v-42.666h64v-64H192v64zm21.333-64h85.334v426.666H149.333V256H192v170.667h128V85.333h-42.667z"
    clipRule="evenodd"
  />,
);

const tableInsertColumnRightIcon = scaledIcon(
  "0 0 512 512",
  <path
    fill="currentColor"
    fillRule="evenodd"
    d="M149.333 469.333V42.667h85.334v42.666H192v341.334h128V256h42.667v213.333zm277.334-362.666v42.666h-64v64H320v-64h-64v-42.666h64v-64h42.667v64z"
    clipRule="evenodd"
  />,
);

const tableInsertRowAboveIcon = scaledIcon(
  "0 0 512 512",
  <path
    fill="currentColor"
    fillRule="evenodd"
    d="M106.667 85.333h42.666v64h64V192h-64v64h-42.666v-64h-64v-42.667h64zm149.333 64h213.333v213.334H42.667v-85.334h42.666V320h341.334V192H256z"
    clipRule="evenodd"
  />,
);

const tableInsertRowBelowIcon = scaledIcon(
  "0 0 512 512",
  <path
    fill="currentColor"
    fillRule="evenodd"
    d="M42.667 234.667v-85.334h426.666v213.334H256V320h170.667V192H85.333v42.667zm64 21.333h42.666v64h64v42.667h-64v64h-42.666v-64h-64V320h64z"
    clipRule="evenodd"
  />,
);

// fluent:table-cells-merge-28-regular / fluent:table-cells-split-24-regular
// (icon-sets.iconify.design) - same family, kept as the merge/unmerge pair.
const tableMergeCellsIcon = scaledIcon(
  "0 0 28 28",
  <path
    fill="currentColor"
    d="M6.75 3A3.75 3.75 0 0 0 3 6.75v14.5A3.75 3.75 0 0 0 6.75 25h14.5A3.75 3.75 0 0 0 25 21.25V6.75A3.75 3.75 0 0 0 21.25 3zm14.5 1.5a2.25 2.25 0 0 1 2.25 2.25v.75h-19v-.75A2.25 2.25 0 0 1 6.75 4.5zM4.5 9h19v10h-19zm0 12.25v-.75h19v.75a2.25 2.25 0 0 1-2.25 2.25H6.75a2.25 2.25 0 0 1-2.25-2.25m14.08-8H9.42l.89-1.002a.75.75 0 0 0-1.12-.996l-2 2.25a.75.75 0 0 0 0 .996l2 2.25a.75.75 0 1 0 1.12-.996l-.89-1.002h9.16l-.89 1.002a.75.75 0 0 0 1.12.996l2-2.25l.011-.012a.746.746 0 0 0-.013-.987l-1.997-2.247a.75.75 0 0 0-1.122.996z"
  />,
);

const tableUnmergeCellIcon = scaledIcon(
  "0 0 24 24",
  <path
    fill="currentColor"
    d="M12.5 10H11v4h1.5zM3 6.25A3.25 3.25 0 0 1 6.25 3h11.5A3.25 3.25 0 0 1 21 6.25v11.5A3.25 3.25 0 0 1 17.75 21H6.25A3.25 3.25 0 0 1 3 17.75zM6.25 4.5A1.75 1.75 0 0 0 4.5 6.25V7.5H11v-3zm13.25 12h-7v3h5.25a1.75 1.75 0 0 0 1.75-1.75zm0-10.25a1.75 1.75 0 0 0-1.75-1.75H12.5v3h7zM4.5 16.5v1.25c0 .966.784 1.75 1.75 1.75H11v-3zm0-1.5h15V9h-15z"
  />,
);

// One-shot icon button whose enabled state tracks whether `command` could
// currently apply (mirrors the disabled-item logic the old dropdown menu
// used) - shared by delete row/column and merge/unmerge below.
function TableActionButton(props: {
  command: Command;
  icon: ReactElement;
  labelKey: string;
  tone?: "critical";
}) {
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const label = stringFormatter.format(props.labelKey);
  return (
    <ScrollDismissTooltipTrigger>
      <ActionButton
        prominence="low"
        aria-label={label}
        isDisabled={!props.command(state)}
        onPress={() => runCommand(props.command)}
      >
        <Icon src={props.icon} />
      </ActionButton>
      <Tooltip tone={props.tone}>{label}</Tooltip>
    </ScrollDismissTooltipTrigger>
  );
}

function HeaderToggleButton(props: { node: Node }) {
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const schema = getEditorSchema(state.schema);
  const isHeaderRow =
    props.node.firstChild?.firstChild?.type === schema.nodes.table_header;
  const label = stringFormatter.format(
    isHeaderRow ? "tableRemoveHeaderRow" : "tableMakeHeaderRow",
  );
  return (
    <ScrollDismissTooltipTrigger>
      <ActionButton
        prominence="low"
        aria-label={label}
        onPress={() => runCommand(toggleHeader("row"))}
      >
        <Icon src={tableToggleHeaderIcon} />
      </ActionButton>
      <Tooltip>{label}</Tooltip>
    </ScrollDismissTooltipTrigger>
  );
}

// Small popover rather than a single button, since "insert column" is
// ambiguous about which side the new column lands on - matches
// `TableInsertGridPicker`'s DialogTrigger pattern in Toolbar.tsx. The
// trigger itself skips a tooltip (a `TooltipTrigger` wrapping a
// `DialogTrigger`'s own trigger child breaks its ref wiring), same as that
// picker.
function InsertColumnButton() {
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <DialogTrigger type="popover" hideArrow>
      <ActionButton
        prominence="low"
        aria-label={stringFormatter.format("tableInsertColumn")}
      >
        <Icon src={tableInsertColumnRightIcon} />
      </ActionButton>
      {(close: () => void) => (
        <Flex gap="regular" padding="regular">
          <ScrollDismissTooltipTrigger>
            <ActionButton
              prominence="low"
              aria-label={stringFormatter.format("tableInsertColumnLeft")}
              onPress={() => {
                runCommand(addColumnBeforeWithRebalance);
                close();
              }}
            >
              <Icon src={tableInsertColumnLeftIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("tableInsertColumnLeft")}</Tooltip>
          </ScrollDismissTooltipTrigger>
          <ScrollDismissTooltipTrigger>
            <ActionButton
              prominence="low"
              aria-label={stringFormatter.format("tableInsertColumnRight")}
              onPress={() => {
                runCommand(addColumnAfterWithRebalance);
                close();
              }}
            >
              <Icon src={tableInsertColumnRightIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("tableInsertColumnRight")}</Tooltip>
          </ScrollDismissTooltipTrigger>
        </Flex>
      )}
    </DialogTrigger>
  );
}

// Same popover pattern as `InsertColumnButton`, but "above" is disabled
// while the current row is the header row - markdoc only allows a header
// at row 0, so there's nowhere for a row inserted above it to go that
// wouldn't itself become (or split) the header.
function InsertRowButton() {
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const rect = selectedRect(state);
  const isCurrentRowHeader = rowIsHeader(rect.map, rect.table, rect.top);
  return (
    <DialogTrigger type="popover" hideArrow>
      <ActionButton
        prominence="low"
        aria-label={stringFormatter.format("tableInsertRow")}
      >
        <Icon src={tableInsertRowBelowIcon} />
      </ActionButton>
      {(close: () => void) => (
        <Flex gap="regular" padding="regular">
          <ScrollDismissTooltipTrigger>
            <ActionButton
              prominence="low"
              isDisabled={isCurrentRowHeader}
              aria-label={stringFormatter.format("tableInsertRowAbove")}
              onPress={() => {
                runCommand(addRowBefore);
                close();
              }}
            >
              <Icon src={tableInsertRowAboveIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("tableInsertRowAbove")}</Tooltip>
          </ScrollDismissTooltipTrigger>
          <ScrollDismissTooltipTrigger>
            <ActionButton
              prominence="low"
              aria-label={stringFormatter.format("tableInsertRowBelow")}
              onPress={() => {
                runCommand(addRowAfter);
                close();
              }}
            >
              <Icon src={tableInsertRowBelowIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("tableInsertRowBelow")}</Tooltip>
          </ScrollDismissTooltipTrigger>
        </Flex>
      )}
    </DialogTrigger>
  );
}

// Rendered inside the table's bottom menu (see `TablePopover` in
// `popovers/index.tsx`) rather than inside the cell itself, so it doesn't
// overlap cell content. `node` is the enclosing `table` node, needed to
// show the header-row toggle's current state. Each action used to live
// behind a single "cell options" dropdown menu - broken out into individual
// icon buttons (plus two small insert-side popovers) so every action is
// reachable in one click/tap instead of two.
export function TableCellActions(props: { node: Node }) {
  const state = useEditorState();
  const schema = getEditorSchema(state.schema);
  const showHeaderRowToggle = schema.format === "markdoc";
  return (
    <Flex gap="regular" alignItems="center">
      {showHeaderRowToggle && <HeaderToggleButton node={props.node} />}
      <TableActionButton
        command={deleteRow}
        icon={tableDeleteRowIcon}
        labelKey="tableDeleteRow"
        tone="critical"
      />
      <TableActionButton
        command={deleteColumn}
        icon={tableDeleteColumnIcon}
        labelKey="tableDeleteColumn"
        tone="critical"
      />
      <InsertColumnButton />
      <InsertRowButton />
      <TableActionButton
        command={mergeCellsKeepFirst}
        icon={tableMergeCellsIcon}
        labelKey="tableMergeCells"
      />
      <TableActionButton
        command={unmergeCell}
        icon={tableUnmergeCellIcon}
        labelKey="tableUnmergeCell"
      />
    </Flex>
  );
}

function findCellPosAbove($pos: ResolvedPos) {
  for (let d = $pos.depth; d > 0; d--) {
    const node = $pos.node(d);
    const role = node.type.spec.tableRole;
    if (role === "cell" || role === "header_cell") {
      return $pos.before(d);
    }
  }
}

// True for a plain cursor/selection inside a single cell as well as a
// multi-cell `CellSelection` - the two cases in which the table's bottom
// menu should offer cell-scoped actions (as opposed to a `NodeSelection` of
// the table itself, where there's no specific cell in play).
export function isSelectionInTableCell(state: EditorState) {
  return (
    state.selection instanceof CellSelection ||
    findCellPosAbove(state.selection.$from) !== undefined
  );
}

// `CellSelection` already gets the `.selectedCell` treatment for free from
// prosemirror-tables' own `tableEditing()` plugin. A plain cursor placed in
// a single cell (no drag) doesn't produce a `CellSelection`, so it wouldn't
// otherwise be highlighted - this plugin covers that case, reusing the same
// `selectedCell` class (styled in `schema.tsx`) so both cases look
// identical. The two never overlap since a selection is always exactly one
// of `TextSelection` / `CellSelection` / `NodeSelection`.
export function tableCellFocusHighlight() {
  return new Plugin({
    props: {
      decorations(state) {
        if (!(state.selection instanceof TextSelection)) return null;
        const cellPos = findCellPosAbove(state.selection.$from);
        if (cellPos === undefined) return null;
        const cellNode = state.doc.nodeAt(cellPos);
        if (!cellNode) return null;
        return DecorationSet.create(state.doc, [
          Decoration.node(cellPos, cellPos + cellNode.nodeSize, {
            class: "selectedCell",
          }),
        ]);
      },
    },
  });
}
