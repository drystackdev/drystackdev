import { useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { AlertDialog, Dialog } from '@keystar/ui/dialog';
import { Avatar } from '@keystar/ui/avatar';
import { Badge } from '@keystar/ui/badge';
import { Button, ButtonGroup } from '@keystar/ui/button';
import { Checkbox } from '@keystar/ui/checkbox';
import { Flex } from '@keystar/ui/layout';
import { Content } from '@keystar/ui/slots';
import { TextField } from '@keystar/ui/text-field';
import { toastQueue } from '@keystar/ui/toast';
import { Heading, Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { useNativeUser } from '../native-user';
import { useRouter } from '../router';
import { avatarUrl, formatDateTime } from './format';
import { PublicUser, UserManagementApi } from './api';

export function UserDetailDialog(props: {
  user: PublicUser;
  api: UserManagementApi;
  onDismiss: () => void;
  onDeleted: () => void;
}) {
  const { user, api } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const nativeUser = useNativeUser();
  const router = useRouter();
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [isDeleting, setDeleting] = useState(false);

  const isSelf = nativeUser?.email === user.email;
  // Only SuperAdmin deletes users at all (plan mục 4) - hiding the button
  // for everyone else avoids a click that's guaranteed to 403.
  const canDelete = nativeUser?.isSuperAdmin && !isSelf;

  if (confirmingDelete) {
    return (
      <AlertDialog
        title={stringFormatter.format('userDeleteConfirmTitle')}
        tone="critical"
        cancelLabel={stringFormatter.format('cancel')}
        primaryActionLabel={stringFormatter.format('userDeleteAction')}
        isPrimaryActionDisabled={isDeleting}
        onCancel={() => setConfirmingDelete(false)}
        onPrimaryAction={async () => {
          setDeleting(true);
          try {
            await api.deleteUser(user.id);
            toastQueue.positive(stringFormatter.format('userDeletedToast'));
            props.onDeleted();
          } catch {
            toastQueue.critical(stringFormatter.format('genericErrorToast'));
            setDeleting(false);
          }
        }}
      >
        <Text>
          {stringFormatter.format('userDeleteConfirmBody', { email: user.email })}
        </Text>
      </AlertDialog>
    );
  }

  return (
    <Dialog aria-label={user.name}>
      <Heading>{user.name}</Heading>
      <Content>
        <Flex direction="column" gap="large">
          <Flex alignItems="center" gap="regular">
            {user.avatar ? (
              <Avatar
                src={avatarUrl(router.basePath, user.avatar)}
                alt={user.name}
                size="large"
              />
            ) : (
              <Avatar name={user.name} alt={user.name} size="large" />
            )}
            <Flex direction="column" gap="small">
              <Flex gap="regular" wrap>
                {user.roles.map(role => (
                  <Badge key={role}>
                    <Text>{role}</Text>
                  </Badge>
                ))}
              </Flex>
              <Checkbox isSelected={user.active} isReadOnly>
                {stringFormatter.format('userActiveLabel')}
              </Checkbox>
            </Flex>
          </Flex>
          <TextField
            label={stringFormatter.format('userEmailLabel')}
            value={user.email}
            isReadOnly
            isDisabled
          />
          <TextField
            label={stringFormatter.format('userNameLabel')}
            value={user.name}
            isReadOnly
            isDisabled
          />
          <TextField
            label={stringFormatter.format('userPhoneNumberLabel')}
            value={user.phoneNumber ?? ''}
            isReadOnly
            isDisabled
          />
          <TextField
            label={stringFormatter.format('userAddressLabel')}
            value={user.address ?? ''}
            isReadOnly
            isDisabled
          />
          <Text color="neutralTertiary" size="small">
            {stringFormatter.format('createdAtLabel')}: {formatDateTime(user.createdAt)}
            {' · '}
            {stringFormatter.format('updatedAtLabel')}: {formatDateTime(user.updatedAt)}
          </Text>
        </Flex>
      </Content>
      <ButtonGroup>
        {canDelete && (
          <Button tone="critical" marginEnd="auto" onPress={() => setConfirmingDelete(true)}>
            {stringFormatter.format('userDeleteAction')}
          </Button>
        )}
        <Button onPress={props.onDismiss}>{stringFormatter.format('close')}</Button>
      </ButtonGroup>
    </Dialog>
  );
}
