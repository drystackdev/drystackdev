import { useState } from 'react';
import { Node } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';

import { ActionButton } from '@keystar/ui/button';
import { AlertDialog, DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { settingsIcon } from '@keystar/ui/icon/icons/settingsIcon';
import { layoutGridIcon } from '@keystar/ui/icon/icons/layoutGridIcon';
import { trash2Icon } from '@keystar/ui/icon/icons/trash2Icon';
import { Divider, Flex } from '@keystar/ui/layout';
import { MenuTrigger, Menu, Section } from '@keystar/ui/menu';
import { TooltipTrigger, Tooltip } from '@keystar/ui/tooltip';
import { Item } from '@react-stately/collections';

import { useEditorDispatchCommand, useEditorState } from '../editor-view';
import {
  addCellAfterFocused,
  appendCellToGrid,
  deleteFocusedCell,
  findGridCell,
  gridHasContent,
  setFocusedCellPlace,
  GridPlace,
} from '../grid';

const cellActions: Record<string, { label: string; command: typeof addCellAfterFocused }> = {
  addColumn: { label: 'Add column', command: addCellAfterFocused },
  addItem: { label: 'Add item', command: appendCellToGrid },
  deleteItem: { label: 'Delete item', command: deleteFocusedCell },
};

// requires a focused cell to make sense (append is grid-scoped, but keeping it
// grouped keeps the menu simple; it stays enabled)
const cellScopedKeys = new Set(['addColumn', 'deleteItem']);

function GridSettingsMenu(props: { state: EditorState }) {
  const runCommand = useEditorDispatchCommand();
  const hasCell = findGridCell(props.state) !== null;
  const disabledKeys = hasCell
    ? []
    : [...cellScopedKeys].filter(key => key in cellActions);
  return (
    <TooltipTrigger>
      <MenuTrigger>
        <ActionButton prominence="low" aria-label="Grid settings">
          <Icon src={settingsIcon} />
        </ActionButton>
        <Menu
          disabledKeys={disabledKeys}
          onAction={key => {
            const action = cellActions[key as string];
            if (action) runCommand(action.command);
          }}
        >
          {Object.entries(cellActions).map(([key, action]) => (
            <Item key={key}>{action.label}</Item>
          ))}
        </Menu>
      </MenuTrigger>
      <Tooltip>Grid settings</Tooltip>
    </TooltipTrigger>
  );
}

// 3×3 flex/grid placement picker — sets the focused cell's `place-content`
const VERTICAL: readonly [string, string][] = [
  ['start', 'Top'],
  ['center', 'Middle'],
  ['end', 'Bottom'],
];
const HORIZONTAL: readonly [string, string][] = [
  ['start', 'left'],
  ['center', 'center'],
  ['end', 'right'],
];

function GridLayoutMenu(props: { state: EditorState }) {
  const runCommand = useEditorDispatchCommand();
  const hasCell = findGridCell(props.state) !== null;
  return (
    <TooltipTrigger>
      <MenuTrigger>
        <ActionButton
          prominence="low"
          isDisabled={!hasCell}
          aria-label="Item layout"
        >
          <Icon src={layoutGridIcon} />
        </ActionButton>
        <Menu
          onAction={key => {
            if (key === 'none') {
              runCommand(setFocusedCellPlace(null));
            } else {
              runCommand(setFocusedCellPlace(key as GridPlace));
            }
          }}
        >
          <Section key="positions">
            {VERTICAL.flatMap(([vValue, vLabel]) =>
              HORIZONTAL.map(([hValue, hLabel]) => (
                <Item key={`${vValue} ${hValue}`}>{`${vLabel} ${hLabel}`}</Item>
              ))
            )}
          </Section>
          <Section key="reset">
            <Item key="none">Reset (top, full width)</Item>
          </Section>
        </Menu>
      </MenuTrigger>
      <Tooltip>Item layout</Tooltip>
    </TooltipTrigger>
  );
}

export function GridPopover(props: { node: Node; state: EditorState; pos: number }) {
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
      <GridSettingsMenu state={state} />
      <GridLayoutMenu state={state} />
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
          <Icon src={trash2Icon} />
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
