import { Key } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';
import l10nMessages from '../l10n';
import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { tablePropertiesIcon } from '@keystar/ui/icon/icons/tablePropertiesIcon';
import { Item, Menu, MenuTrigger } from '@keystar/ui/menu';
import { Text } from '@keystar/ui/typography';

export function ColumnsMenu(props: {
  columns: { key: string; label: string }[];
  hiddenColumns: ReadonlySet<string>;
  onHiddenColumnsChange: (hidden: Set<string>) => void;
}) {
  const { columns, hiddenColumns, onHiddenColumnsChange } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const selectedKeys = columns
    .filter(c => !hiddenColumns.has(c.key))
    .map(c => c.key);

  return (
    <MenuTrigger>
      <ActionButton aria-label={stringFormatter.format('chooseColumnsAriaLabel')}>
        <Icon src={tablePropertiesIcon} />
        <Text>{stringFormatter.format('columnsLabel')}</Text>
      </ActionButton>
      <Menu
        items={columns}
        selectionMode="multiple"
        disallowEmptySelection={false}
        selectedKeys={selectedKeys}
        onSelectionChange={keys => {
          const visible: Set<Key> =
            keys === 'all' ? new Set(columns.map(c => c.key)) : keys;
          onHiddenColumnsChange(
            new Set(
              columns.filter(c => !visible.has(c.key)).map(c => c.key)
            )
          );
        }}
      >
        {(item: { key: string; label: string }) => (
          <Item key={item.key} textValue={item.label}>
            <Text>{item.label}</Text>
          </Item>
        )}
      </Menu>
    </MenuTrigger>
  );
}
