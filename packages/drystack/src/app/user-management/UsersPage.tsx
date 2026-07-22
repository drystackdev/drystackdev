import { useCallback, useMemo, useState } from 'react';
import Fuse from 'fuse.js';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { Avatar } from '@keystar/ui/avatar';
import { Badge } from '@keystar/ui/badge';
import { ActionButton, Button } from '@keystar/ui/button';
import { AlertDialog, DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { checkCircle2Icon } from '@keystar/ui/icon/icons/checkCircle2Icon';
import { Flex } from '@keystar/ui/layout';
import { ProgressCircle } from '@keystar/ui/progress';
import { SortDescriptor } from '@keystar/ui/table';
import { Switch } from '@keystar/ui/switch';
import { toastQueue } from '@keystar/ui/toast';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';
import { Heading, Text } from '@keystar/ui/typography';

import type { ComponentSchema } from '../../form/api';
import l10nMessages from '../l10n';
import { sortBy } from '../collection-sort';
import { CollectionToolbar } from '../collection-table/CollectionToolbar';
import { ColumnDescriptor } from '../collection-table/column-model';
import { DataColumn, EntityTableView, FixtureColumn } from '../collection-table/EntityTableView';
import { HighlightedText } from '../collection-table/highlight';
import { useCollectionViewState } from '../collection-table/useCollectionViewState';
import { EmptyState } from '../shell/empty-state';
import { PageBody, PageHeader, PageRoot } from '../shell/page';
import { useRouter } from '../router';
import { useDebouncedValue } from '../CollectionPage';
import { notFound } from '../not-found';
import { useConfig } from '../shell/context';
import { isR2Config } from '../storage-mode';
import { useData } from '../useData';
import { ApiError, PublicUser, makeUserManagementApi } from './api';
import { UserDetailDialog } from './UserDetailDialog';
import { avatarUrl, formatDateTime } from './format';

const VIEW_STATE_KEY = '__drystack-users';

export function UsersPage() {
  const config = useConfig();
  if (!isR2Config(config)) notFound();
  const router = useRouter();
  const api = useMemo(() => makeUserManagementApi(router.basePath), [router.basePath]);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const usersState = useData(
    useCallback(() => api.listUsers(), [api, reloadKey])
  );

  const [searchTerm, setSearchTerm] = useState('');
  const debouncedSearchTerm = useDebouncedValue(searchTerm, 300);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [confirmingActiveChange, setConfirmingActiveChange] = useState<{
    user: PublicUser;
    nextValue: boolean;
  } | null>(null);
  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'updatedAt',
    direction: 'descending',
  });

  const columns = useMemo(
    () => [
      { key: 'email', label: stringFormatter.format('userEmailLabel') },
      { key: 'name', label: stringFormatter.format('userNameLabel') },
      { key: 'phoneNumber', label: stringFormatter.format('userPhoneNumberLabel') },
      { key: 'address', label: stringFormatter.format('userAddressLabel') },
      { key: 'verify', label: stringFormatter.format('userVerifyLabel') },
      { key: 'active', label: stringFormatter.format('userActiveLabel') },
      { key: 'roles', label: stringFormatter.format('userRolesLabel') },
      { key: 'createdAt', label: stringFormatter.format('createdAtLabel') },
      { key: 'updatedAt', label: stringFormatter.format('updatedAtLabel') },
    ],
    [stringFormatter]
  );
  const defaultHiddenColumns = useMemo(
    () => ['phoneNumber', 'address', 'roles', 'createdAt', 'updatedAt'],
    []
  );
  const { hiddenColumns, setHiddenColumns, columnWidths, setColumnWidths } =
    useCollectionViewState(VIEW_STATE_KEY, defaultHiddenColumns);
  const visibleColumns = useMemo(
    () => columns.filter(c => c.key === 'email' || !hiddenColumns.has(c.key)),
    [columns, hiddenColumns]
  );

  const users = usersState.kind === 'loaded' ? usersState.data : [];

  const fuse = useMemo(
    () =>
      new Fuse(users, {
        keys: ['email', 'name', 'phoneNumber', 'address'],
        includeMatches: true,
        threshold: 0.3,
        ignoreLocation: true,
      }),
    [users]
  );

  const { filteredUsers, matchesByUser } = useMemo(() => {
    const term = debouncedSearchTerm.trim();
    if (!term) {
      return { filteredUsers: users, matchesByUser: new Map<number, Map<string, readonly [number, number][]>>() };
    }
    const results = fuse.search(term);
    const matches = new Map<number, Map<string, readonly [number, number][]>>();
    for (const result of results) {
      for (const match of result.matches ?? []) {
        if (!match.key || !match.indices?.length) continue;
        let byKey = matches.get(result.item.id);
        if (!byKey) {
          byKey = new Map();
          matches.set(result.item.id, byKey);
        }
        byKey.set(match.key, [...match.indices]);
      }
    }
    return { filteredUsers: results.map(r => r.item), matchesByUser: matches };
  }, [fuse, debouncedSearchTerm, users]);

  const sortedUsers = useMemo(() => {
    return [...filteredUsers].sort((a, b) => {
      const read = (u: PublicUser) => {
        switch (sortDescriptor.column) {
          case 'verify':
            return u.emailVerifyAt ?? '';
          case 'active':
            return u.active ? 1 : 0;
          case 'roles':
            return u.roles.join(', ');
          default:
            return (u as unknown as Record<string, string>)[sortDescriptor.column as string] ?? '';
        }
      };
      return sortBy(sortDescriptor.direction!, read(a), read(b));
    });
  }, [filteredUsers, sortDescriptor]);

  const withMutation = useCallback(
    async (fn: () => Promise<unknown>, successMessage?: string) => {
      try {
        await fn();
        if (successMessage) toastQueue.positive(successMessage);
        reload();
      } catch (err) {
        toastQueue.critical(
          err instanceof ApiError
            ? stringFormatter.format('genericErrorToast')
            : stringFormatter.format('genericErrorToast')
        );
      }
    },
    [reload, stringFormatter]
  );

  const leadingColumns = useMemo<FixtureColumn<PublicUser>[]>(
    () => [
      {
        key: 'avatar',
        label: '',
        width: 40,
        minWidth: 40,
        hideHeader: true,
        renderCell: user => ({
          textValue: user.name,
          node: user.avatar ? (
            <Avatar src={avatarUrl(router.basePath, user.avatar)} alt={user.name} size="small" />
          ) : (
            <Avatar name={user.name} alt={user.name} size="small" />
          ),
        }),
      },
    ],
    [router.basePath]
  );

  const dataColumns = useMemo<DataColumn<PublicUser>[]>(() => {
    const cols: DataColumn<PublicUser>[] = [];
    for (const raw of visibleColumns) {
      // DataColumn<Item>['descriptor'] is typed as the collection table's own
      // ColumnDescriptor (key/label/displayKind/schema) - EntityTableView
      // itself only ever reads .key/.label off it (see EntityTableView.tsx),
      // but the type still demands the other two. displayKind/schema are
      // meaningless here (this table isn't schema-driven) - 'text'/`{}` are
      // dummy values, never actually consulted since every renderCell below
      // is supplied directly rather than going through the schema-driven
      // cell renderer collection tables use.
      const descriptor: ColumnDescriptor = { ...raw, displayKind: 'text', schema: {} as ComponentSchema };
      if (descriptor.key === 'active') {
        cols.push({
          descriptor,
          renderCell: user => ({
            textValue: user.active
              ? stringFormatter.format('userActiveLabel')
              : stringFormatter.format('userInactiveLabel'),
            node: (
              <Switch
                isSelected={user.active}
                aria-label={stringFormatter.format('userActiveLabel')}
                onChange={isSelected => setConfirmingActiveChange({ user, nextValue: isSelected })}
              />
            ),
          }),
        });
        continue;
      }
      if (descriptor.key === 'verify') {
        cols.push({
          descriptor,
          renderCell: user => ({
            textValue: user.emailVerifyAt
              ? stringFormatter.format('userVerifiedLabel')
              : stringFormatter.format('userResendInviteAction'),
            node: user.emailVerifyAt ? (
              <TooltipTrigger>
                <ActionButton prominence="low" aria-label={stringFormatter.format('userVerifiedLabel')}>
                  <Icon src={checkCircle2Icon} color="positive" />
                  <Text>{stringFormatter.format('userVerifiedLabel')}</Text>
                </ActionButton>
                <Tooltip>
                  {stringFormatter.format('userVerifiedTooltip', {
                    date: formatDateTime(user.emailVerifyAt),
                  })}
                </Tooltip>
              </TooltipTrigger>
            ) : (
              <Button
                onPress={() =>
                  withMutation(
                    () => api.resendInvite(user.id),
                    stringFormatter.format('userInviteResentToast')
                  )
                }
              >
                {stringFormatter.format('userResendInviteAction')}
              </Button>
            ),
          }),
        });
        continue;
      }
      if (descriptor.key === 'roles') {
        cols.push({
          descriptor,
          renderCell: user => ({
            textValue: user.roles.join(', '),
            node: (
              <Flex gap="regular" wrap>
                {user.roles.map(role => (
                  <Badge key={role}>
                    <Text>{role}</Text>
                  </Badge>
                ))}
              </Flex>
            ),
          }),
        });
        continue;
      }
      if (descriptor.key === 'createdAt' || descriptor.key === 'updatedAt') {
        cols.push({
          descriptor,
          renderCell: user => {
            const value = user[descriptor.key as 'createdAt' | 'updatedAt'];
            return { textValue: formatDateTime(value), node: <Text>{formatDateTime(value)}</Text> };
          },
        });
        continue;
      }
      // email / name / phoneNumber / address - plain highlighted text
      cols.push({
        descriptor,
        renderCell: user => {
          const value = (user as unknown as Record<string, string | null>)[descriptor.key] ?? '';
          const indices = matchesByUser.get(user.id)?.get(descriptor.key);
          return {
            textValue: value,
            node: (
              <Text>
                <HighlightedText text={value} indices={indices} />
              </Text>
            ),
          };
        },
      });
    }
    return cols;
  }, [visibleColumns, stringFormatter, withMutation, api, matchesByUser]);

  return (
    <PageRoot containerWidth="none">
      <PageHeader>
        <Heading elementType="h1" id="page-title" size="small" flex minWidth={0}>
          {stringFormatter.format('userManagementNavItem')}
        </Heading>
        <Button marginStart="auto" prominence="high" href={`${router.basePath}/users/add`}>
          {stringFormatter.format('userAddAction')}
        </Button>
      </PageHeader>
      <CollectionToolbar
        searchTerm={searchTerm}
        onSearchTermChange={setSearchTerm}
        columns={columns}
        hiddenColumns={hiddenColumns}
        onHiddenColumnsChange={setHiddenColumns}
      />
      <PageBody isScrollable={false}>
        {usersState.kind === 'loading' ? (
          <EmptyState>
            <ProgressCircle
              aria-label={stringFormatter.format('loadingEntriesAriaLabel')}
              isIndeterminate
              size="large"
            />
          </EmptyState>
        ) : usersState.kind === 'error' ? (
          <EmptyState title={stringFormatter.format('genericErrorToast')} />
        ) : (
          <EntityTableView
            aria-labelledby="page-title"
            leadingColumns={leadingColumns}
            dataColumns={dataColumns}
            items={sortedUsers}
            getItemKey={user => String(user.id)}
            sortDescriptor={sortDescriptor}
            onSortChange={setSortDescriptor}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            onAction={key => setSelectedUserId(Number(key))}
            renderEmptyState={() => (
              <EmptyState
                title={stringFormatter.format('noResultsTitle')}
                message={stringFormatter.format('noResultsMessage', {
                  term: debouncedSearchTerm,
                })}
              />
            )}
          />
        )}
      </PageBody>
      <DialogContainer onDismiss={() => setSelectedUserId(null)}>
        {selectedUserId != null && (
          <UserDetailDialog
            user={users.find(u => u.id === selectedUserId)!}
            api={api}
            onDismiss={() => setSelectedUserId(null)}
            onDeleted={() => {
              setSelectedUserId(null);
              reload();
            }}
          />
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => setConfirmingActiveChange(null)}>
        {confirmingActiveChange && (
          <AlertDialog
            title={stringFormatter.format('userActiveConfirmTitle')}
            tone={confirmingActiveChange.nextValue ? undefined : 'critical'}
            cancelLabel={stringFormatter.format('cancel')}
            primaryActionLabel={stringFormatter.format(
              confirmingActiveChange.nextValue ? 'userActivateAction' : 'userDeactivateAction'
            )}
            onCancel={() => setConfirmingActiveChange(null)}
            onPrimaryAction={() => {
              const { user, nextValue } = confirmingActiveChange;
              setConfirmingActiveChange(null);
              withMutation(() => api.setUserActive(user.id, nextValue));
            }}
          >
            <Text>
              {stringFormatter.format(
                confirmingActiveChange.nextValue
                  ? 'userActivateConfirmBody'
                  : 'userDeactivateConfirmBody',
                { name: confirmingActiveChange.user.name }
              )}
            </Text>
          </AlertDialog>
        )}
      </DialogContainer>
    </PageRoot>
  );
}
