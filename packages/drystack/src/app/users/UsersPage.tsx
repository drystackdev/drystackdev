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
import { SortDescriptor } from '@keystar/ui/table';
import { toastQueue } from '@keystar/ui/toast';
import { Heading, Text } from '@keystar/ui/typography';

import * as fields from '../../form/fields';
import { sortBy } from '../collection-sort';
import {
  DefaultCell,
  ListCell,
  NumberCell,
  SelectCell,
} from '../collection-table/cells';
import { ColumnDescriptor, getDisplayKind } from '../collection-table/column-model';
import { CollectionToolbar } from '../collection-table/CollectionToolbar';
import {
  DataColumn,
  EntityTableView,
  FixtureColumn,
} from '../collection-table/EntityTableView';
import { useCollectionViewState } from '../collection-table/useCollectionViewState';
import { useDebouncedValue } from '../CollectionPage';
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

// The plain string a user field contributes to a cell's accessible/typeahead
// value (react-aria wants a string per cell). Mirrors the small read-only
// subset above - anything non-scalar just stringifies loosely.
function userFieldTextValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) return value.join(', ');
  return '';
}

export function UsersPage() {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const router = useRouter();
  const { basePath, push } = router;
  const nativeUser = useNativeUser();
  const apiBase = `/api${basePath}/auth`;
  const userSchema = useUserSchema();

  const [users, setUsers] = useState<UserRow[] | undefined>(undefined);
  const [searchTerm, setSearchTerm] = useState(
    new URLSearchParams(router.search).get('search') ?? ''
  );
  const [deleteTarget, setDeleteTarget] = useState<UserRow | null>(null);
  const [isDeleting, setDeleting] = useState(false);
  const { hiddenColumns, setHiddenColumns, columnWidths, setColumnWidths } =
    useCollectionViewState(USERS_VIEW_STATE_KEY);

  // search term is mirrored into the URL (?search=) and debounced before it
  // drives filtering - same behavior as the collection list (see CollectionPage)
  const setSearchTermFromForm = useCallback(
    (value: string) => {
      setSearchTerm(value);
      const params = new URLSearchParams(router.search);
      if (value) {
        params.set('search', value);
      } else {
        params.delete('search');
      }
      router.replace(router.pathname + '?' + params.toString());
    },
    [router]
  );
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);

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

  // Schema-driven data columns: `name` (the conventional profile field, if the
  // site declares one) leads, then every other declared field, then the
  // built-in `email` and `createdAt` columns. These built-ins are modeled as
  // synthetic ColumnDescriptors so they sort / hide / resize exactly like a
  // schema field does (they're rendered with their own custom cell below, so
  // their `displayKind`/`schema` are only placeholders). Password/avatar are
  // never columns - they don't live in `config.user.schema` (see UserConfig).
  const dataDescriptors = useMemo<ColumnDescriptor[]>(() => {
    const keys = Object.keys(userSchema.fields);
    const ordered = keys.includes('name')
      ? ['name', ...keys.filter(key => key !== 'name')]
      : keys;
    const profile = ordered.map(key => {
      const schema = userSchema.fields[key];
      const label = ('label' in schema && schema.label) || key;
      return { key, label, displayKind: getDisplayKind(schema, key, ''), schema };
    });
    return [
      ...profile,
      {
        key: 'email',
        label: stringFormatter.format('userEmailColumn'),
        displayKind: 'text' as const,
        schema: fields.text({ label: 'email' }),
      },
      {
        key: 'createdAt',
        label: stringFormatter.format('userCreatedColumn'),
        displayKind: 'date' as const,
        schema: fields.text({ label: 'createdAt' }),
      },
    ];
  }, [userSchema, stringFormatter]);

  // The pinned name-like column mirrors a collection's slug column - it always
  // stays visible (its toggle would be inert) and shows the "pending invite"
  // note beneath. Everything after it is offered in the columns menu.
  const rowHeaderKey = dataDescriptors[0]?.key;
  const columnsMenuItems = useMemo(
    () => dataDescriptors.slice(1).map(d => ({ key: d.key, label: d.label })),
    [dataDescriptors]
  );
  const visibleDataDescriptors = useMemo(
    () =>
      dataDescriptors.filter(
        (d, i) => i === 0 || !hiddenColumns.has(d.key)
      ),
    [dataDescriptors, hiddenColumns]
  );

  // Sorts by the pinned name-like column first, same default a collection's
  // table opens with (sorted by its slug field) - falls back to email only if
  // a site somehow declares an empty user schema.
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: rowHeaderKey ?? 'email',
    direction: 'ascending',
  });

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
    if (!debouncedSearchTerm.trim()) return users;
    return fuse.search(debouncedSearchTerm).map(result => result.item);
  }, [users, fuse, debouncedSearchTerm]);

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

  const leadingColumns = useMemo<FixtureColumn<UserRow>[]>(
    () => [
      {
        key: 'avatar',
        label: stringFormatter.format('userNameColumn'),
        width: 56,
        hideHeader: true,
        renderCell: row => ({
          textValue: row.email,
          node: (
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
          ),
        }),
      },
    ],
    [apiBase, rowHeaderKey, stringFormatter]
  );

  const dataColumns = useMemo<DataColumn<UserRow>[]>(
    () =>
      visibleDataDescriptors.map(descriptor => ({
        descriptor,
        renderCell: row => {
          if (descriptor.key === 'email') {
            return { textValue: row.email, node: <Text>{row.email}</Text> };
          }
          if (descriptor.key === 'createdAt') {
            return {
              textValue: row.createdAt ?? '',
              node: (
                <Text>
                  {row.createdAt
                    ? new Date(row.createdAt).toLocaleDateString()
                    : '—'}
                </Text>
              ),
            };
          }
          const value = row.profile[descriptor.key];
          const cell = renderUserFieldCell(descriptor, value);
          const isPinned = descriptor.key === rowHeaderKey;
          return {
            textValue: userFieldTextValue(value),
            node:
              isPinned && row.pending ? (
                <Flex direction="column">
                  {cell}
                  <Text size="small" color="neutralTertiary">
                    {stringFormatter.format('pendingInviteLabel')}
                  </Text>
                </Flex>
              ) : (
                cell
              ),
          };
        },
      })),
    [visibleDataDescriptors, rowHeaderKey, stringFormatter]
  );

  const trailingColumns = useMemo<FixtureColumn<UserRow>[]>(
    () => [
      {
        key: 'actions',
        label: stringFormatter.format('deleteAction'),
        width: 64,
        hideHeader: true,
        renderCell: row => ({
          textValue: stringFormatter.format('deleteAction'),
          node: (
            // stopPropagation so pressing delete doesn't also fire the row's
            // onAction navigation - same guard cells with their own
            // interactive content use elsewhere (see UrlCell, ContentSizeCell
            // in collection-table/cells.tsx).
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
          ),
        }),
      },
    ],
    [stringFormatter, nativeUser, activeCount]
  );

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

      <CollectionToolbar
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTermFromForm}
        columns={columnsMenuItems}
        hiddenColumns={hiddenColumns}
        onHiddenColumnsChange={setHiddenColumns}
      />

      <EntityTableView
        aria-labelledby="page-title"
        leadingColumns={leadingColumns}
        dataColumns={dataColumns}
        trailingColumns={trailingColumns}
        items={sortedUsers}
        getItemKey={row => row.email}
        sortDescriptor={sortDescriptor}
        onSortChange={setSortDescriptor}
        columnWidths={columnWidths}
        onColumnWidthsChange={setColumnWidths}
        onAction={key =>
          push(`${basePath}/users/item/${encodeURIComponent(key)}`)
        }
        renderEmptyState={() => (
          <EmptyState
            icon={usersIcon}
            title={stringFormatter.format('emptyListTitle')}
            message={stringFormatter.format('emptyListDescription')}
          />
        )}
      />

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
