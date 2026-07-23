import { useCallback, useMemo, useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { AlertDialog, Dialog, DialogContainer } from '@keystar/ui/dialog';
import { ActionButton, Button, ButtonGroup } from '@keystar/ui/button';
import { Badge } from '@keystar/ui/badge';
import { Checkbox } from '@keystar/ui/checkbox';
import { Icon } from '@keystar/ui/icon';
import { pencilIcon } from '@keystar/ui/icon/icons/pencilIcon';
import { trash2Icon } from '@keystar/ui/icon/icons/trash2Icon';
import { Flex } from '@keystar/ui/layout';
import { ProgressCircle } from '@keystar/ui/progress';
import { SearchField } from '@keystar/ui/search-field';
import { Content } from '@keystar/ui/slots';
import { SortDescriptor } from '@keystar/ui/table';
import { TextField } from '@keystar/ui/text-field';
import { toastQueue } from '@keystar/ui/toast';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';
import { Heading, Text } from '@keystar/ui/typography';

import type { ComponentSchema } from '../../form/api';
import l10nMessages from '../l10n';
import { sortBy } from '../collection-sort';
import { ColumnDescriptor } from '../collection-table/column-model';
import { DataColumn, EntityTableView, FixtureColumn } from '../collection-table/EntityTableView';
import { useCollectionViewState } from '../collection-table/useCollectionViewState';
import { PageBody, PageHeader, PageRoot } from '../shell/page';
import { useRouter } from '../router';
import { notFound } from '../not-found';
import { useConfig } from '../shell/context';
import { isR2Config } from '../storage-mode';
import { useData } from '../useData';
import { useNativeUser } from '../native-user';
import { EmptyState } from '../shell/empty-state';
import { ApiError, PublicRole, PublicUser, UserManagementApi, makeUserManagementApi } from './api';

const VIEW_STATE_KEY = '__drystack-roles';

export function RolesPage() {
  const config = useConfig();
  if (!isR2Config(config)) notFound();
  const router = useRouter();
  const api = useMemo(() => makeUserManagementApi(router.basePath), [router.basePath]);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const nativeUser = useNativeUser();
  const canManage = !!nativeUser?.fullAccess;

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const rolesState = useData(useCallback(() => api.listRoles(), [api, reloadKey]));
  const usersState = useData(useCallback(() => api.listUsers(), [api, reloadKey]));

  const [renamingRole, setRenamingRole] = useState<PublicRole | null>(null);
  const [membersRole, setMembersRole] = useState<PublicRole | null>(null);
  const [deletingRole, setDeletingRole] = useState<PublicRole | null>(null);
  const [addingRole, setAddingRole] = useState(false);

  const roles = rolesState.kind === 'loaded' ? rolesState.data : [];
  const users = usersState.kind === 'loaded' ? usersState.data : [];

  const [sortDescriptor, setSortDescriptor] = useState<SortDescriptor>({
    column: 'name',
    direction: 'ascending',
  });
  const { columnWidths, setColumnWidths } = useCollectionViewState(VIEW_STATE_KEY);

  const sortedRoles = useMemo(() => {
    return [...roles].sort((a, b) => {
      const read = (role: PublicRole) => {
        switch (sortDescriptor.column) {
          case 'members':
            return role.userCount;
          case 'permissions':
            return role.isLocked ? Number.POSITIVE_INFINITY : role.permissions.length;
          default:
            return role.name;
        }
      };
      return sortBy(sortDescriptor.direction!, read(a), read(b));
    });
  }, [roles, sortDescriptor]);

  const dataColumns = useMemo<DataColumn<PublicRole>[]>(() => {
    const descriptor = (key: string, label: string): ColumnDescriptor => ({
      key,
      label,
      displayKind: 'text',
      schema: {} as ComponentSchema,
    });
    return [
      {
        descriptor: descriptor('name', stringFormatter.format('roleNameLabel')),
        renderCell: role => ({
          textValue: role.name,
          node: (
            <Flex alignItems="center" gap="small">
              <Text weight="medium">{role.name}</Text>
              {!role.isLocked && canManage && (
                <TooltipTrigger>
                  <ActionButton
                    prominence="low"
                    aria-label={stringFormatter.format('roleRenameAction')}
                    onPress={() => setRenamingRole(role)}
                  >
                    <Icon src={pencilIcon} />
                  </ActionButton>
                  <Tooltip>{stringFormatter.format('roleRenameAction')}</Tooltip>
                </TooltipTrigger>
              )}
            </Flex>
          ),
        }),
      },
      {
        descriptor: descriptor('members', stringFormatter.format('roleMembersColumnLabel')),
        renderCell: role => ({
          textValue: stringFormatter.format('roleUserCountLabel', { count: role.userCount }),
          node: (
            <ActionButton onPress={() => setMembersRole(role)}>
              {stringFormatter.format('roleUserCountLabel', { count: role.userCount })}
            </ActionButton>
          ),
        }),
      },
      {
        descriptor: descriptor('permissions', stringFormatter.format('rolePermissionsColumnLabel')),
        renderCell: role => ({
          textValue: role.isLocked
            ? stringFormatter.format('roleFullAccessLabel')
            : stringFormatter.format('rolePermissionCountLabel', { count: role.permissions.length }),
          node: role.isLocked ? (
            <Badge tone="accent">
              <Text>{stringFormatter.format('roleFullAccessLabel')}</Text>
            </Badge>
          ) : (
            <ActionButton
              onPress={() => router.push(`${router.basePath}/roles/${role.id}/permissions`)}
            >
              {stringFormatter.format('rolePermissionCountLabel', {
                count: role.permissions.length,
              })}
            </ActionButton>
          ),
        }),
      },
    ];
  }, [stringFormatter, canManage, router]);

  const trailingColumns = useMemo<FixtureColumn<PublicRole>[]>(
    () => [
      {
        key: 'actions',
        label: stringFormatter.format('roleDeleteAction'),
        width: 48,
        minWidth: 48,
        hideHeader: true,
        renderCell: role => {
          const isDeleteDisabled = role.isLocked || role.userCount > 0 || !canManage;
          return {
            textValue: stringFormatter.format('roleDeleteAction'),
            node: (
              <TooltipTrigger>
                <ActionButton
                  prominence="low"
                  aria-label={stringFormatter.format('roleDeleteAction')}
                  isDisabled={isDeleteDisabled}
                  onPress={() => setDeletingRole(role)}
                >
                  <Icon src={trash2Icon} color={isDeleteDisabled ? undefined : 'critical'} />
                </ActionButton>
                <Tooltip>{stringFormatter.format('roleDeleteAction')}</Tooltip>
              </TooltipTrigger>
            ),
          };
        },
      },
    ],
    [stringFormatter, canManage]
  );

  return (
    <PageRoot containerWidth="none">
      <PageHeader>
        <Heading elementType="h1" id="page-title" size="small" flex minWidth={0}>
          {stringFormatter.format('roleManagementNavItem')}
        </Heading>
        <Button marginStart="auto" prominence="high" onPress={() => setAddingRole(true)}>
          {stringFormatter.format('roleAddAction')}
        </Button>
      </PageHeader>
      <PageBody isScrollable={false}>
        {rolesState.kind === 'loading' ? (
          <EmptyState>
            <ProgressCircle isIndeterminate aria-label={stringFormatter.format('loadingEntriesAriaLabel')} />
          </EmptyState>
        ) : (
          <EntityTableView
            aria-labelledby="page-title"
            dataColumns={dataColumns}
            trailingColumns={trailingColumns}
            items={sortedRoles}
            getItemKey={role => String(role.id)}
            sortDescriptor={sortDescriptor}
            onSortChange={setSortDescriptor}
            columnWidths={columnWidths}
            onColumnWidthsChange={setColumnWidths}
            disableColumnResizing
            onAction={() => {}}
            renderEmptyState={() => <EmptyState title={stringFormatter.format('roleNoMembersLabel')} />}
          />
        )}
      </PageBody>

      <DialogContainer onDismiss={() => setAddingRole(false)}>
        {addingRole && (
          <AddRoleDialog
            api={api}
            onDismiss={() => setAddingRole(false)}
            onCreated={() => {
              setAddingRole(false);
              reload();
            }}
          />
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => setRenamingRole(null)}>
        {renamingRole && (
          <RenameRoleDialog
            role={renamingRole}
            api={api}
            onDismiss={() => setRenamingRole(null)}
            onRenamed={() => {
              setRenamingRole(null);
              reload();
            }}
          />
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => setMembersRole(null)}>
        {membersRole && (
          <ManageMembersDialog
            role={membersRole}
            users={users}
            api={api}
            onDismiss={() => setMembersRole(null)}
            onChanged={reload}
          />
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => setDeletingRole(null)}>
        {deletingRole && (
          <DeleteRoleDialog
            role={deletingRole}
            api={api}
            onDismiss={() => setDeletingRole(null)}
            onDeleted={() => {
              setDeletingRole(null);
              reload();
            }}
          />
        )}
      </DialogContainer>
    </PageRoot>
  );
}

function AddRoleDialog(props: {
  api: UserManagementApi;
  onDismiss: () => void;
  onCreated: () => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [name, setName] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog aria-label={stringFormatter.format('roleAddAction')}>
      <Heading>{stringFormatter.format('roleAddAction')}</Heading>
      <Content>
        <Flex direction="column" gap="regular">
          {error && <Text color="critical">{error}</Text>}
          <TextField
            label={stringFormatter.format('roleNameLabel')}
            value={name}
            onChange={setName}
            autoFocus
            isRequired
          />
        </Flex>
      </Content>
      <ButtonGroup>
        <Button onPress={props.onDismiss}>{stringFormatter.format('cancel')}</Button>
        <Button
          prominence="high"
          isPending={isSaving}
          isDisabled={!name.trim()}
          onPress={async () => {
            setSaving(true);
            setError(null);
            try {
              await props.api.createRole(name.trim());
              toastQueue.positive(stringFormatter.format('roleCreatedToast'));
              props.onCreated();
            } catch (err) {
              setError(
                err instanceof ApiError && err.code === 'name-already-exists'
                  ? stringFormatter.format('roleNameAlreadyExistsError')
                  : stringFormatter.format('genericErrorToast')
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          {stringFormatter.format('confirm')}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

function RenameRoleDialog(props: {
  role: PublicRole;
  api: UserManagementApi;
  onDismiss: () => void;
  onRenamed: () => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [name, setName] = useState(props.role.name);
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <Dialog aria-label={stringFormatter.format('roleRenameAction')}>
      <Heading>{stringFormatter.format('roleRenameAction')}</Heading>
      <Content>
        <Flex direction="column" gap="regular">
          {error && <Text color="critical">{error}</Text>}
          <TextField
            label={stringFormatter.format('roleNameLabel')}
            value={name}
            onChange={setName}
            autoFocus
            isRequired
          />
        </Flex>
      </Content>
      <ButtonGroup>
        <Button onPress={props.onDismiss}>{stringFormatter.format('cancel')}</Button>
        <Button
          prominence="high"
          isPending={isSaving}
          isDisabled={!name.trim() || name.trim() === props.role.name}
          onPress={async () => {
            setSaving(true);
            setError(null);
            try {
              await props.api.renameRole(props.role.id, name.trim());
              toastQueue.positive(stringFormatter.format('roleRenamedToast'));
              props.onRenamed();
            } catch (err) {
              setError(
                err instanceof ApiError && err.code === 'name-already-exists'
                  ? stringFormatter.format('roleNameAlreadyExistsError')
                  : stringFormatter.format('genericErrorToast')
              );
            } finally {
              setSaving(false);
            }
          }}
        >
          {stringFormatter.format('confirm')}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

function ManageMembersDialog(props: {
  role: PublicRole;
  users: PublicUser[];
  api: UserManagementApi;
  onDismiss: () => void;
  onChanged: () => void;
}) {
  const { role, api } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [search, setSearch] = useState('');
  const [pendingUserId, setPendingUserId] = useState<number | null>(null);

  const visibleUsers = props.users.filter(
    u =>
      !search.trim() ||
      u.email.toLowerCase().includes(search.trim().toLowerCase()) ||
      u.name.toLowerCase().includes(search.trim().toLowerCase())
  );

  const toggleMember = async (user: PublicUser, isMember: boolean) => {
    setPendingUserId(user.id);
    try {
      await (isMember ? api.assignRole(user.id, role.id) : api.unassignRole(user.id, role.id));
      props.onChanged();
    } catch {
      toastQueue.critical(stringFormatter.format('genericErrorToast'));
    } finally {
      setPendingUserId(null);
    }
  };

  return (
    <Dialog aria-label={stringFormatter.format('roleMembersTitle', { role: role.name })}>
      <Heading>{stringFormatter.format('roleMembersTitle', { role: role.name })}</Heading>
      <Content>
        <Flex direction="column" gap="regular">
          <SearchField
            aria-label={stringFormatter.format('search')}
            placeholder={stringFormatter.format('roleAddMemberSearchPlaceholder')}
            value={search}
            onChange={setSearch}
          />
          {visibleUsers.length === 0 ? (
            <Text color="neutralTertiary">{stringFormatter.format('roleNoMembersLabel')}</Text>
          ) : (
            <Flex direction="column" gap="regular">
              {visibleUsers.map(user => {
                const isMember = user.roles.includes(role.name);
                return (
                  <Checkbox
                    key={user.id}
                    isSelected={isMember}
                    isDisabled={pendingUserId === user.id}
                    onChange={isSelected => toggleMember(user, isSelected)}
                  >
                    {`${user.name} (${user.email})`}
                  </Checkbox>
                );
              })}
            </Flex>
          )}
        </Flex>
      </Content>
      <ButtonGroup>
        <Button prominence="high" onPress={props.onDismiss}>
          {stringFormatter.format('close')}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

function DeleteRoleDialog(props: {
  role: PublicRole;
  api: UserManagementApi;
  onDismiss: () => void;
  onDeleted: () => void;
}) {
  const { role, api } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [confirmName, setConfirmName] = useState('');
  const [isDeleting, setDeleting] = useState(false);

  return (
    <AlertDialog
      title={stringFormatter.format('roleDeleteConfirmTitle')}
      tone="critical"
      cancelLabel={stringFormatter.format('cancel')}
      primaryActionLabel={stringFormatter.format('roleDeleteAction')}
      isPrimaryActionDisabled={confirmName.trim() !== role.name || isDeleting}
      onCancel={props.onDismiss}
      onPrimaryAction={async () => {
        setDeleting(true);
        try {
          await api.deleteRole(role.id);
          toastQueue.positive(stringFormatter.format('roleDeletedToast'));
          props.onDeleted();
        } catch {
          toastQueue.critical(stringFormatter.format('genericErrorToast'));
          setDeleting(false);
        }
      }}
    >
      <Flex direction="column" gap="regular">
        <Text>
          {stringFormatter.format('roleDeleteConfirmBody', { role: role.name })}
        </Text>
        <TextField
          label={stringFormatter.format('roleDeleteConfirmInputLabel')}
          value={confirmName}
          onChange={setConfirmName}
          autoFocus
        />
      </Flex>
    </AlertDialog>
  );
}
