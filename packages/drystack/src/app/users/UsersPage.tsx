import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { useCallback, useEffect, useMemo, useState } from 'react';
import Fuse from 'fuse.js';

import { Avatar } from '@keystar/ui/avatar';
import { ActionButton, Button } from '@keystar/ui/button';
import { AlertDialog, DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { trash2Icon } from '@keystar/ui/icon/icons/trash2Icon';
import { usersIcon } from '@keystar/ui/icon/icons/usersIcon';
import { Flex } from '@keystar/ui/layout';
import { SearchField } from '@keystar/ui/search-field';
import { breakpointQueries, css, tokenSchema } from '@keystar/ui/style';
import {
  Cell,
  Column,
  Row,
  SortDescriptor,
  TableBody,
  TableHeader,
  TableView,
} from '@keystar/ui/table';
import { toastQueue } from '@keystar/ui/toast';
import { Heading, Text } from '@keystar/ui/typography';

import { sortBy } from '../collection-sort';
import {
  DefaultCell,
  ListCell,
  NumberCell,
  SelectCell,
} from '../collection-table/cells';
import { ColumnDescriptor, getDisplayKind } from '../collection-table/column-model';
import { ColumnsMenu } from '../collection-table/ColumnsMenu';
import { useCollectionViewState } from '../collection-table/useCollectionViewState';
import l10nMessages from '../l10n';
import { useNativeUser } from '../native-user';
import { useRouter } from '../router';
import { EmptyState } from '../shell/empty-state';
import { PageHeader, PageRoot } from '../shell/page';
import { useUserSchema } from './UserDetailForm';

// Not a real collection key - reserved so this list's column-visibility/width
// prefs (persisted via useCollectionViewState, same as every collection
// table) can never collide with an actual `config.collections` key, mirroring
// how REDIRECTS_SINGLETON_KEY reserves `__redirects` in config.tsx.
const USERS_VIEW_STATE_KEY = '__users';

type UserRow = {
  email: string;
  profile: Record<string, unknown>;
  createdAt: string | null;
  hasAvatar: boolean;
  pending: boolean;
};

// Same breakpoint-aware horizontal rhythm CollectionToolbar/CollectionPage's
// TableView use (see CollectionPage.tsx's CollectionToolbar/TableView) -
// reused as-is so this page's toolbar/table sit at the same margins as every
// collection list, instead of introducing a second layout language.
const toolbarMarginStyle = css({
  marginInline: tokenSchema.size.space.small,
  [breakpointQueries.above.mobile]: {
    marginInline: `calc(${tokenSchema.size.space.xlarge} - ${tokenSchema.size.space.medium})`,
  },
  [breakpointQueries.above.tablet]: {
    marginInline: `calc(${tokenSchema.size.space.xxlarge} - ${tokenSchema.size.space.medium})`,
  },
});
const tableMarginStyle = css({
  minWidth: 0,
  marginInline: tokenSchema.size.space.regular,
  [breakpointQueries.above.mobile]: {
    marginInline: `calc(${tokenSchema.size.space.xlarge} - ${tokenSchema.size.space.medium})`,
  },
  [breakpointQueries.above.tablet]: {
    marginInline: `calc(${tokenSchema.size.space.xxlarge} - ${tokenSchema.size.space.medium})`,
  },
  '[role=gridcell], [role=rowheader]': {
    display: 'flex',
    alignItems: 'center',
  },
});

// A user's schema-declared fields are always JSON-plain (text/select/checkbox/
// number, ...) - never image/file/content, see UserConfig's doc comment - so a
// small, read-only subset of the collection table's cell renderers covers
// every case. Unlike CollectionPage's `renderColumnCell`, the checkbox case is
// deliberately non-interactive (DefaultCell's true/false text): there's no
// per-cell quick-edit write path for users, editing always goes through the
// full detail form.
function renderUserFieldCell(descriptor: ColumnDescriptor, value: unknown) {
  switch (descriptor.displayKind) {
    case 'select':
      return (
        <SelectCell
          value={typeof value === 'string' ? value : null}
          schema={descriptor.schema}
        />
      );
    case 'multiselect':
      return (
        <ListCell
          values={Array.isArray(value) ? value : []}
          schema={descriptor.schema}
        />
      );
    case 'number':
      return <NumberCell value={typeof value === 'number' ? value : null} />;
    default:
      return <DefaultCell value={value} />;
  }
}

// A table with a variable number of columns goes through TableView's dynamic
// `columns` prop + render-function API for its TableHeader (same as
// CollectionPage.tsx) - one unified column list drives both the header and
// every row's cells so the two can never disagree on count/order.
type TableColumn =
  | { kind: 'avatar'; key: 'avatar'; label: string }
  | {
      kind: 'schema';
      key: string;
      label: string;
      isRowHeader: boolean;
      descriptor: ColumnDescriptor;
    }
  | { kind: 'email'; key: 'email'; label: string }
  | { kind: 'createdAt'; key: 'createdAt'; label: string }
  | { kind: 'actions'; key: 'actions'; label: string };

export function UsersPage() {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { basePath, push } = useRouter();
  const nativeUser = useNativeUser();
  const apiBase = `/api${basePath}/auth`;
  const userSchema = useUserSchema();

  const [users, setUsers] = useState<UserRow[] | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [isDeleting, setDeleting] = useState(false);
  const { hiddenColumns, setHiddenColumns } = useCollectionViewState(
    USERS_VIEW_STATE_KEY
  );

  const load = useCallback(() => {
    fetch(`${apiBase}/users`)
      .then(res => (res.ok ? res.json() : Promise.reject()))
      .then(data => setUsers(data.users))
      .catch(() =>
        toastQueue.critical(stringFormatter.format('genericErrorToast'))
      );
  }, [apiBase, stringFormatter]);

  useEffect(() => {
    load();
  }, [load]);

  // Schema-driven columns: `name` (the conventional profile field, if the
  // site declares one) leads, then every other field in declaration order.
  // Never includes a password column - that field doesn't exist in
  // `config.user.schema` at all (see UserConfig).
  const columnDescriptors = useMemo<ColumnDescriptor[]>(() => {
    const keys = Object.keys(userSchema.fields);
    const ordered = keys.includes('name')
      ? ['name', ...keys.filter(key => key !== 'name')]
      : keys;
    return ordered.map(key => {
      const schema = userSchema.fields[key];
      const label = ('label' in schema && schema.label) || key;
      return { key, label, displayKind: getDisplayKind(schema, key, ''), schema };
    });
  }, [userSchema]);
  const rowHeaderKey = columnDescriptors[0]?.key;
  // Sorts by the pinned name-like column first, same default a collection's
  // table opens with (sorted by its slug field) - falls back to email only if
  // a site somehow declares an empty user schema.
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: rowHeaderKey ?? 'email',
    direction: 'ascending',
  });

  const tableColumns = useMemo<TableColumn[]>(
    () => [
      { kind: 'avatar', key: 'avatar', label: stringFormatter.format('userNameColumn') },
      ...columnDescriptors.map((descriptor, i) => ({
        kind: 'schema' as const,
        key: descriptor.key,
        label: descriptor.label,
        isRowHeader: i === 0,
        descriptor,
      })),
      { kind: 'email', key: 'email', label: stringFormatter.format('userEmailColumn') },
      {
        kind: 'createdAt',
        key: 'createdAt',
        label: stringFormatter.format('userCreatedColumn'),
      },
      { kind: 'actions', key: 'actions', label: stringFormatter.format('deleteAction') },
    ],
    [columnDescriptors, stringFormatter]
  );

  // Built-ins (avatar/actions) are structural, not data, so they're never
  // offered here - same reasoning collections use to leave image-preview
  // columns' *presence* non-optional while still letting you hide other
  // fields. The pinned name-like column is excluded too (it can't actually be
  // hidden - see visibleTableColumns below - so a toggle for it would just be
  // inert).
  const columnsMenuItems = useMemo(
    () =>
      tableColumns
        .filter(
          (col): col is Extract<TableColumn, { kind: 'schema' | 'email' | 'createdAt' }> =>
            (col.kind === 'schema' && !col.isRowHeader) ||
            col.kind === 'email' ||
            col.kind === 'createdAt'
        )
        .map(col => ({ key: col.key, label: col.label })),
    [tableColumns]
  );

  // The pinned column mirrors a collection's slug/name column, which stays
  // visible even if somehow present in `hiddenColumns` (see CollectionPage's
  // visibleColumnDescriptors) - built-ins (avatar/actions) aren't governed by
  // the hidden set at all.
  const visibleTableColumns = useMemo(
    () =>
      tableColumns.filter(col => {
        if (col.kind === 'avatar' || col.kind === 'actions') return true;
        if (col.kind === 'schema' && col.isRowHeader) return true;
        return !hiddenColumns.has(col.key);
      }),
    [tableColumns, hiddenColumns]
  );

  const fuse = useMemo(() => {
    const withSearchText = (users ?? []).map(user => ({
      ...user,
      searchText: Object.values(user.profile)
        .filter((value): value is string => typeof value === 'string')
        .join(' '),
    }));
    return new Fuse(withSearchText, {
      keys: ['email', 'searchText'],
      threshold: 0.3,
      ignoreLocation: true,
    });
  }, [users]);
  const filteredUsers = useMemo(() => {
    if (!users) return [];
    if (!searchTerm.trim()) return users;
    return fuse.search(searchTerm).map(result => result.item);
  }, [users, fuse, searchTerm]);

  // Same sort-by-clicked-column behavior a collection's table gives you,
  // reusing its exact comparator (locale-aware strings, nulls last).
  const sortedUsers = useMemo(() => {
    const readSortValue = (row: UserRow): unknown => {
      if (sortDescriptor.column === 'email') return row.email;
      if (sortDescriptor.column === 'createdAt') return row.createdAt;
      return row.profile[sortDescriptor.column as string];
    };
    return [...filteredUsers].sort((a, b) =>
      sortBy(sortDescriptor.direction ?? 'ascending', readSortValue(a), readSortValue(b))
    );
  }, [filteredUsers, sortDescriptor]);

  // Only active users count toward "can't delete the last remaining
  // account" - mirrors the server-side guard in api-r2.ts, checked again
  // here just to disable the button up front rather than round-trip an
  // error for an action that can never succeed.
  const activeCount = users?.filter(u => !u.pending).length ?? 0;

  async function handleDelete(target: UserRow) {
    setDeleting(true);
    try {
      const res = await fetch(`${apiBase}/users/delete`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: target.email }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toastQueue.critical(
          body?.error === 'cannot-delete-self'
            ? stringFormatter.format('cannotDeleteSelfError')
            : body?.error === 'cannot-delete-last-user'
              ? stringFormatter.format('cannotDeleteLastUserError')
              : stringFormatter.format('genericErrorToast')
        );
        return;
      }
      toastQueue.positive(stringFormatter.format('userDeletedToast'));
      setDeleteTarget(null);
      load();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <PageRoot containerWidth="none">
      <PageHeader>
        <Heading elementType="h1" id="page-title" size="small" flex minWidth={0}>
          {stringFormatter.format('userManagement')}
        </Heading>
        <Button marginStart="auto" prominence="high" href={`${basePath}/users/create`}>
          {stringFormatter.format('addUserAction')}
        </Button>
      </PageHeader>

      <Flex
        alignItems="center"
        justifyContent="flex-end"
        gap="regular"
        paddingTop={{ tablet: 'large' }}
        UNSAFE_className={toolbarMarginStyle}
      >
        <Flex role="search" alignItems="center" gap="regular">
          <SearchField
            aria-label={stringFormatter.format('search')}
            placeholder={stringFormatter.format('search')}
            value={searchTerm}
            onChange={setSearchTerm}
            onClear={() => setSearchTerm('')}
            width="scale.2400"
          />
        </Flex>
        <ColumnsMenu
          columns={columnsMenuItems}
          hiddenColumns={hiddenColumns}
          onHiddenColumnsChange={setHiddenColumns}
        />
      </Flex>

      <TableView
        aria-labelledby="page-title"
        selectionMode="none"
        density="spacious"
        overflowMode="wrap"
        prominence="low"
        flex
        sortDescriptor={sortDescriptor}
        onSortChange={setSortDescriptor}
        marginTop={{ tablet: 'large' }}
        marginBottom={{ mobile: 'regular', tablet: 'xlarge' }}
        UNSAFE_className={tableMarginStyle}
        onAction={key =>
          push(`${basePath}/users/item/${encodeURIComponent(String(key))}`)
        }
        renderEmptyState={() => (
          <EmptyState
            icon={usersIcon}
            title={stringFormatter.format('emptyListTitle')}
            message={stringFormatter.format('emptyListDescription')}
          />
        )}
      >
        <TableHeader columns={visibleTableColumns}>
          {col => (
            <Column
              key={col.key}
              width={
                col.kind === 'avatar'
                  ? 56
                  : col.kind === 'createdAt'
                    ? 160
                    : col.kind === 'actions'
                      ? 64
                      : undefined
              }
              hideHeader={col.kind === 'avatar' || col.kind === 'actions'}
              isRowHeader={col.kind === 'schema' && col.isRowHeader}
              allowsSorting={col.kind !== 'avatar' && col.kind !== 'actions'}
            >
              {col.label}
            </Column>
          )}
        </TableHeader>
        <TableBody items={sortedUsers}>
          {row => (
            <Row key={row.email}>
              {visibleTableColumns.map(col => {
                // Cell keys must be unique across the WHOLE table, not just
                // within a row - react-stately's Table collection (unlike a
                // plain React list) uses these keys to index its virtualizer's
                // view-reuse pool. A bare `col.key` repeats identically on
                // every row and corrupts that pool, surfacing as a
                // `getReusableView` crash on the very first paint (caught via
                // real browser verification) - see CollectionPage.tsx's Row,
                // which avoids this the same way (`descriptor.key + item.name`).
                const cellKey = col.key + row.email;
                if (col.kind === 'avatar') {
                  return (
                    <Cell key={cellKey} textValue={row.email}>
                      <Avatar
                        src={
                          row.hasAvatar
                            ? `${apiBase}/avatar/${encodeURIComponent(row.email)}`
                            : undefined
                        }
                        name={
                          typeof row.profile[rowHeaderKey ?? ''] === 'string'
                            ? (row.profile[rowHeaderKey ?? ''] as string)
                            : row.email
                        }
                        size="small"
                      />
                    </Cell>
                  );
                }
                if (col.kind === 'schema') {
                  return (
                    <Cell key={cellKey}>
                      {col.isRowHeader ? (
                        <Flex direction="column">
                          {renderUserFieldCell(col.descriptor, row.profile[col.key])}
                          {row.pending && (
                            <Text size="small" color="neutralTertiary">
                              {stringFormatter.format('pendingInviteLabel')}
                            </Text>
                          )}
                        </Flex>
                      ) : (
                        renderUserFieldCell(col.descriptor, row.profile[col.key])
                      )}
                    </Cell>
                  );
                }
                if (col.kind === 'email') {
                  return (
                    <Cell key={cellKey}>
                      <Text>{row.email}</Text>
                    </Cell>
                  );
                }
                if (col.kind === 'createdAt') {
                  return (
                    <Cell key={cellKey}>
                      <Text>
                        {row.createdAt
                          ? new Date(row.createdAt).toLocaleDateString()
                          : '—'}
                      </Text>
                    </Cell>
                  );
                }
                return (
                  <Cell key={cellKey} textValue={stringFormatter.format('deleteAction')}>
                    {/* stopPropagation so pressing delete doesn't also fire
                        the row's onAction navigation - same guard cells with
                        their own interactive content use elsewhere (see
                        UrlCell, ContentSizeCell in collection-table/cells.tsx). */}
                    <Flex onClick={e => e.stopPropagation()}>
                      <ActionButton
                        aria-label={stringFormatter.format('deleteAction')}
                        isDisabled={
                          nativeUser?.email === row.email ||
                          (!row.pending && activeCount <= 1)
                        }
                        onPress={() => setDeleteTarget(row)}
                      >
                        <Icon src={trash2Icon} />
                      </ActionButton>
                    </Flex>
                  </Cell>
                );
              })}
            </Row>
          )}
        </TableBody>
      </TableView>

      <DialogContainer
        onDismiss={() => {
          if (!isDeleting) setDeleteTarget(null);
        }}
      >
        {deleteTarget && (
          <AlertDialog
            title={stringFormatter.format('deleteUserConfirmTitle')}
            tone="critical"
            cancelLabel={stringFormatter.format('cancel')}
            primaryActionLabel={stringFormatter.format('yesDeleteAction')}
            autoFocusButton="cancel"
            onPrimaryAction={() => handleDelete(deleteTarget)}
          >
            {stringFormatter.format('deleteUserConfirmBody', {
              email: deleteTarget.email,
            })}
          </AlertDialog>
        )}
      </DialogContainer>
    </PageRoot>
  );
}
