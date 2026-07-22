import { useCallback, useMemo, useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { AlertDialog, Dialog, DialogContainer } from '@keystar/ui/dialog';
import { ActionButton, Button, ButtonGroup } from '@keystar/ui/button';
import { Badge } from '@keystar/ui/badge';
import { Icon } from '@keystar/ui/icon';
import { xIcon } from '@keystar/ui/icon/icons/xIcon';
import { Flex } from '@keystar/ui/layout';
import { Picker, Item } from '@keystar/ui/picker';
import { ProgressCircle } from '@keystar/ui/progress';
import { SearchField } from '@keystar/ui/search-field';
import { Content } from '@keystar/ui/slots';
import { TextField } from '@keystar/ui/text-field';
import { toastQueue } from '@keystar/ui/toast';
import { Heading, Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { PageBody, PageHeader, PageRoot } from '../shell/page';
import { useRouter } from '../router';
import { notFound } from '../not-found';
import { useConfig } from '../shell/context';
import { isR2Config } from '../storage-mode';
import { useData } from '../useData';
import { useNativeUser } from '../native-user';
import { EmptyState } from '../shell/empty-state';
import { ApiError, PublicRole, PublicUser, UserManagementApi, makeUserManagementApi } from './api';

export function RolesPage() {
  const config = useConfig();
  if (!isR2Config(config)) notFound();
  const router = useRouter();
  const api = useMemo(() => makeUserManagementApi(router.basePath), [router.basePath]);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const nativeUser = useNativeUser();

  const [reloadKey, setReloadKey] = useState(0);
  const reload = useCallback(() => setReloadKey(k => k + 1), []);
  const rolesState = useData(useCallback(() => api.listRoles(), [api, reloadKey]));
  const usersState = useData(useCallback(() => api.listUsers(), [api, reloadKey]));

  const [addingRole, setAddingRole] = useState(false);
  const [renamingRole, setRenamingRole] = useState<PublicRole | null>(null);
  const [membersRole, setMembersRole] = useState<PublicRole | null>(null);
  const [deletingRole, setDeletingRole] = useState<PublicRole | null>(null);

  const roles = rolesState.kind === 'loaded' ? rolesState.data : [];
  const users = usersState.kind === 'loaded' ? usersState.data : [];

  return (
    <PageRoot containerWidth="medium">
      <PageHeader>
        <Heading elementType="h1" size="small" flex minWidth={0}>
          {stringFormatter.format('roleManagementNavItem')}
        </Heading>
        <Button marginStart="auto" prominence="high" onPress={() => setAddingRole(true)}>
          {stringFormatter.format('roleAddAction')}
        </Button>
      </PageHeader>
      <PageBody>
        {rolesState.kind === 'loading' ? (
          <EmptyState>
            <ProgressCircle isIndeterminate aria-label={stringFormatter.format('loadingEntriesAriaLabel')} />
          </EmptyState>
        ) : (
          <Flex direction="column" gap="regular" marginTop="large">
            {roles.map(role => (
              <RoleRow
                key={role.id}
                role={role}
                canManage={!!nativeUser?.fullAccess}
                onRename={() => setRenamingRole(role)}
                onManageMembers={() => setMembersRole(role)}
                onDelete={() => setDeletingRole(role)}
                onOpenPermissions={() =>
                  router.push(`${router.basePath}/roles/${role.id}/permissions`)
                }
              />
            ))}
          </Flex>
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

function RoleRow(props: {
  role: PublicRole;
  canManage: boolean;
  onRename: () => void;
  onManageMembers: () => void;
  onDelete: () => void;
  onOpenPermissions: () => void;
}) {
  const { role } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  return (
    <Flex
      alignItems="center"
      gap="large"
      padding="regular"
      borderBottom="muted"
      wrap
    >
      <Text flex minWidth="scale.2400" weight="medium">
        {role.name}
      </Text>
      <Button isDisabled={role.isLocked || !props.canManage} onPress={props.onRename}>
        {stringFormatter.format('roleRenameAction')}
      </Button>
      <ActionButton onPress={props.onManageMembers}>
        <Badge>
          <Text>
            {stringFormatter.format('roleUserCountLabel', { count: role.userCount })}
          </Text>
        </Badge>
      </ActionButton>
      {role.isLocked ? (
        <Badge tone="accent">
          <Text>{stringFormatter.format('roleFullAccessLabel')}</Text>
        </Badge>
      ) : (
        <ActionButton onPress={props.onOpenPermissions}>
          <Badge>
            <Text>
              {stringFormatter.format('rolePermissionCountLabel', {
                count: role.permissions.length,
              })}
            </Text>
          </Badge>
        </ActionButton>
      )}
      <Button
        marginStart="auto"
        tone="critical"
        isDisabled={role.isLocked || role.userCount > 0 || !props.canManage}
        onPress={props.onDelete}
      >
        {stringFormatter.format('roleDeleteAction')}
      </Button>
    </Flex>
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

  const members = props.users.filter(u => u.roles.includes(role.name));
  const nonMembers = props.users
    .filter(u => !u.roles.includes(role.name))
    .filter(
      u =>
        !search.trim() ||
        u.email.toLowerCase().includes(search.trim().toLowerCase()) ||
        u.name.toLowerCase().includes(search.trim().toLowerCase())
    );

  const runMutation = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      props.onChanged();
    } catch (err) {
      toastQueue.critical(
        err instanceof ApiError
          ? stringFormatter.format('genericErrorToast')
          : stringFormatter.format('genericErrorToast')
      );
    }
  };

  return (
    <Dialog aria-label={stringFormatter.format('roleMembersTitle', { role: role.name })}>
      <Heading>{stringFormatter.format('roleMembersTitle', { role: role.name })}</Heading>
      <Content>
        <Flex direction="column" gap="large">
          <Flex direction="column" gap="regular">
            {members.length === 0 && (
              <Text color="neutralTertiary">{stringFormatter.format('roleNoMembersLabel')}</Text>
            )}
            {members.map(user => (
              <Flex key={user.id} alignItems="center" gap="regular">
                <Text flex>
                  {user.name} ({user.email})
                </Text>
                <ActionButton
                  aria-label={stringFormatter.format('roleRemoveMemberAction')}
                  onPress={() => runMutation(() => api.unassignRole(user.id, role.id))}
                >
                  <Icon src={xIcon} />
                </ActionButton>
              </Flex>
            ))}
          </Flex>
          <Flex direction="column" gap="regular">
            <SearchField
              aria-label={stringFormatter.format('search')}
              placeholder={stringFormatter.format('roleAddMemberSearchPlaceholder')}
              value={search}
              onChange={setSearch}
            />
            {search.trim() && (
              <Picker
                aria-label={stringFormatter.format('roleAddMemberAction')}
                items={nonMembers}
                selectedKey={pendingUserId != null ? String(pendingUserId) : null}
                onSelectionChange={key => {
                  const userId = Number(key);
                  if (!Number.isInteger(userId)) return;
                  setPendingUserId(userId);
                  runMutation(() => api.assignRole(userId, role.id)).finally(() => {
                    setPendingUserId(null);
                    setSearch('');
                  });
                }}
              >
                {user => <Item key={String(user.id)}>{`${user.name} (${user.email})`}</Item>}
              </Picker>
            )}
          </Flex>
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
