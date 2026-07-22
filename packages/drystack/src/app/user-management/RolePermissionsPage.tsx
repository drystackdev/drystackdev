import { useCallback, useMemo, useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { Button } from '@keystar/ui/button';
import { Checkbox } from '@keystar/ui/checkbox';
import { Flex } from '@keystar/ui/layout';
import { ProgressCircle } from '@keystar/ui/progress';
import { toastQueue } from '@keystar/ui/toast';
import { Heading, Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { PageBody, PageHeader, PageRoot } from '../shell/page';
import { useRouter } from '../router';
import { notFound } from '../not-found';
import { useConfig } from '../shell/context';
import { isR2Config } from '../storage-mode';
import { useData } from '../useData';
import { EmptyState } from '../shell/empty-state';
import {
  PermissionAction,
  collectionPermission,
  singletonPermission,
} from '../../api/permissions';
import { makeUserManagementApi, PublicRole } from './api';

const ACTIONS: PermissionAction[] = ['view', 'created', 'updated', 'magicWriter', 'deleted'];

export function RolePermissionsPage(props: { roleId: string }) {
  const config = useConfig();
  if (!isR2Config(config)) notFound();
  const router = useRouter();
  const api = useMemo(() => makeUserManagementApi(router.basePath), [router.basePath]);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const roleId = Number(props.roleId);
  const rolesState = useData(useCallback(() => api.listRoles(), [api]));
  const role = rolesState.kind === 'loaded' ? rolesState.data.find(r => r.id === roleId) : undefined;

  if (rolesState.kind === 'loading') {
    return (
      <PageRoot containerWidth="medium">
        <PageBody>
          <EmptyState>
            <ProgressCircle isIndeterminate aria-label={stringFormatter.format('loadingEntriesAriaLabel')} />
          </EmptyState>
        </PageBody>
      </PageRoot>
    );
  }
  if (!role) notFound();
  // SuperAdmin/Admin have hardcoded full access - this page never applies to
  // them (see RolesPage, which doesn't even link here for a locked role).
  if (role.isLocked) notFound();

  // Keyed by role.id so navigating between roles' permission pages remounts
  // this editor with a fresh, correctly-initialized permission set.
  return <RolePermissionsEditor key={role.id} role={role} api={api} />;
}

function RolePermissionsEditor(props: {
  role: PublicRole;
  api: ReturnType<typeof makeUserManagementApi>;
}) {
  const config = useConfig();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const initial = useMemo(
    () => new Set(props.role.permissions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [enabled, setEnabled] = useState(initial);
  const [isSaving, setIsSaving] = useState(false);

  const isDirty = useMemo(() => !setsEqual(enabled, initial), [enabled, initial]);

  const toggle = useCallback((permission: string) => {
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
  }, []);

  const save = async () => {
    setIsSaving(true);
    try {
      await props.api.updateRolePermissions(props.role.id, [...enabled]);
      toastQueue.positive(stringFormatter.format('rolePermissionsSavedToast'));
    } catch {
      toastQueue.critical(stringFormatter.format('genericErrorToast'));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <PageRoot containerWidth="medium">
      <PageHeader>
        <Heading elementType="h1" size="small" flex minWidth={0}>
          {stringFormatter.format('rolePermissionsPageTitle', { role: props.role.name })}
        </Heading>
        <Button
          marginStart="auto"
          prominence="high"
          onPress={save}
          isPending={isSaving}
          isDisabled={!isDirty}
        >
          {stringFormatter.format('save')}
        </Button>
      </PageHeader>
      <PageBody isScrollable>
        <Flex direction="column" gap="xlarge" marginTop="large">
          {Object.keys(config.collections ?? {}).map(key => (
            <PermissionBlock
              key={`collection:${key}`}
              title={stringFormatter.format('permissionBlockCollectionTitle', {
                name: config.collections![key].label,
              })}
              permissionFor={action => collectionPermission(key, action)}
              enabled={enabled}
              onToggle={toggle}
            />
          ))}
          {Object.keys(config.singletons ?? {}).map(key => (
            <PermissionBlock
              key={`singleton:${key}`}
              title={stringFormatter.format('permissionBlockSingletonTitle', {
                name: config.singletons![key].label,
              })}
              permissionFor={action => singletonPermission(key, action)}
              enabled={enabled}
              onToggle={toggle}
            />
          ))}
        </Flex>
      </PageBody>
    </PageRoot>
  );
}

function PermissionBlock(props: {
  title: string;
  permissionFor: (action: PermissionAction) => string;
  enabled: Set<string>;
  onToggle: (permission: string) => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const viewPermission = props.permissionFor('view');
  const hasView = props.enabled.has(viewPermission);

  return (
    <Flex direction="column" gap="regular">
      <Heading size="small">{props.title}</Heading>
      <Flex gap="xlarge" wrap>
        {ACTIONS.map(action => (
          <Checkbox
            key={action}
            isSelected={props.enabled.has(props.permissionFor(action))}
            // view gates the other 4 (plan mục 6) - disabled, but the saved
            // state underneath is untouched, so re-enabling view brings
            // back whatever was chosen before.
            isDisabled={action !== 'view' && !hasView}
            onChange={() => props.onToggle(props.permissionFor(action))}
          >
            <Text>{stringFormatter.format(`permissionAction${capitalize(action)}`)}</Text>
          </Checkbox>
        ))}
      </Flex>
    </Flex>
  );
}

function setsEqual(a: Set<string>, b: Set<string>): boolean {
  if (a.size !== b.size) return false;
  for (const value of a) {
    if (!b.has(value)) return false;
  }
  return true;
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
