import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { Checkbox } from '@keystar/ui/checkbox';
import { Flex } from '@keystar/ui/layout';
import { ProgressCircle } from '@keystar/ui/progress';
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
import { makeUserManagementApi } from './api';

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

  return (
    <PageRoot containerWidth="medium">
      <PageHeader>
        <Heading elementType="h1" size="small">
          {stringFormatter.format('rolePermissionsPageTitle', { role: role.name })}
        </Heading>
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
              roleId={role.id}
              initialPermissions={role.permissions}
              api={api}
            />
          ))}
          {Object.keys(config.singletons ?? {}).map(key => (
            <PermissionBlock
              key={`singleton:${key}`}
              title={stringFormatter.format('permissionBlockSingletonTitle', {
                name: config.singletons![key].label,
              })}
              permissionFor={action => singletonPermission(key, action)}
              roleId={role.id}
              initialPermissions={role.permissions}
              api={api}
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
  roleId: number;
  initialPermissions: string[];
  api: ReturnType<typeof makeUserManagementApi>;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const initial = useMemo(
    () => new Set(props.initialPermissions),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const [enabled, setEnabled] = useState(initial);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestRef = useRef(enabled);
  latestRef.current = enabled;

  // Auto-saves the *entire* role's permission set 1s after the last change,
  // debounced (plan mục 6: "lưu tự động không cần nút save, debounce 1s") -
  // not just this block's actions, since PATCH roles/:id/permissions
  // replaces the whole list.
  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      props.api.updateRolePermissions(props.roleId, [...latestRef.current]).catch(() => {});
    }, 1000);
  }, [props.api, props.roleId]);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  const viewPermission = props.permissionFor('view');
  const hasView = enabled.has(viewPermission);

  const toggle = (action: PermissionAction) => {
    const permission = props.permissionFor(action);
    setEnabled(prev => {
      const next = new Set(prev);
      if (next.has(permission)) next.delete(permission);
      else next.add(permission);
      return next;
    });
    scheduleSave();
  };

  return (
    <Flex direction="column" gap="regular">
      <Heading size="small">{props.title}</Heading>
      <Flex gap="xlarge" wrap>
        {ACTIONS.map(action => (
          <Checkbox
            key={action}
            isSelected={enabled.has(props.permissionFor(action))}
            // view gates the other 4 (plan mục 6) - disabled, but the saved
            // state underneath is untouched, so re-enabling view brings
            // back whatever was chosen before.
            isDisabled={action !== 'view' && !hasView}
            onChange={() => toggle(action)}
          >
            <Text>{stringFormatter.format(`permissionAction${capitalize(action)}`)}</Text>
          </Checkbox>
        ))}
      </Flex>
    </Flex>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
