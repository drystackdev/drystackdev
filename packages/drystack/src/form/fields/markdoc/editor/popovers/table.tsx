import { ActionButton } from "@keystar/ui/button";
import { Icon } from "@keystar/ui/icon";
import { settingsIcon } from "@keystar/ui/icon/icons/settingsIcon";
import { MenuTrigger, Menu, Section } from "@keystar/ui/menu";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";
import { Item } from "@react-stately/collections";
import { Node, ResolvedPos } from "prosemirror-model";
import { Command, EditorState, Plugin, TextSelection } from "prosemirror-state";
import {
  CellSelection,
  addRowAfter,
  deleteColumn,
  deleteRow,
  toggleHeader,
} from "prosemirror-tables";
import {
  addColumnAfterWithRebalance,
  mergeCellsKeepFirst,
  unmergeCell,
} from "../commands/table";
import { useEditorDispatchCommand, useEditorState } from "../editor-view";
import { Decoration, DecorationSet } from "prosemirror-view";
import { getEditorSchema } from "../schema";

const cellActions: Record<string, { label: string; command: Command }> = {
  deleteRow: { label: "Delete row", command: deleteRow },
  deleteColumn: { label: "Delete column", command: deleteColumn },
  insertRowBelow: { label: "Insert row below", command: addRowAfter },
  insertColumnRight: {
    label: "Insert column right",
    command: addColumnAfterWithRebalance,
  },
  mergeCells: { label: "Merge cells", command: mergeCellsKeepFirst },
  unmergeCell: { label: "Unmerge cell", command: unmergeCell },
};

const toggleHeaderRowKey = "toggleHeaderRow";

// Rendered inside the table's bottom menu (see `TablePopover` in
// `popovers/index.tsx`) rather than inside the cell itself, so it doesn't
// overlap cell content. `node` is the enclosing `table` node, needed to
// show the header-row toggle's current state.
export function CellOptionsMenu(props: { node: Node }) {
  const state = useEditorState();
  const runCommand = useEditorDispatchCommand();
  const schema = getEditorSchema(state.schema);
  const disabledKeys = Object.entries(cellActions)
    .filter(([, action]) => !action.command(state))
    .map(([key]) => key);
  const showHeaderRowToggle = schema.format === "markdoc";
  const isHeaderRow =
    props.node.firstChild?.firstChild?.type === schema.nodes.table_header;
  return (
    <TooltipTrigger>
      <MenuTrigger align="end">
        <ActionButton prominence="low" aria-label="Cell options">
          <Icon src={settingsIcon} />
        </ActionButton>
        <Menu
          disabledKeys={disabledKeys}
          onAction={(key) => {
            if (key === toggleHeaderRowKey) {
              runCommand(toggleHeader("row"));
            } else if (key in cellActions) {
              runCommand(cellActions[key].command);
            }
          }}
        >
          {showHeaderRowToggle ? (
            <Section key="header">
              <Item key={toggleHeaderRowKey}>
                {isHeaderRow ? "Remove header row" : "Make header row"}
              </Item>
            </Section>
          ) : null}
          <Section key="cell-actions">
            {Object.entries(cellActions).map(([key, item]) => (
              <Item key={key}>{item.label}</Item>
            ))}
          </Section>
        </Menu>
      </MenuTrigger>
      <Tooltip>Cell options</Tooltip>
    </TooltipTrigger>
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
