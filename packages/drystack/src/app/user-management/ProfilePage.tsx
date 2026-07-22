import { useCallback, useMemo, useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { Avatar } from '@keystar/ui/avatar';
import { Button } from '@keystar/ui/button';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { ProgressCircle } from '@keystar/ui/progress';
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
import { SyncedPasswordField } from '../components/SyncedPasswordField';
import { EmptyState } from '../shell/empty-state';
import { useRefreshNativeUser } from '../native-user';
import { ApiError, PublicUser, fileToBase64, makeUserManagementApi } from './api';
import { avatarUrl } from './format';

const MAX_AVATAR_BYTES = 2 * 1024 * 1024;
const ALLOWED_AVATAR_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);

export function ProfilePage() {
  const config = useConfig();
  if (!isR2Config(config)) notFound();
  const router = useRouter();
  const api = useMemo(() => makeUserManagementApi(router.basePath), [router.basePath]);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const refreshNativeUser = useRefreshNativeUser();

  const [reloadKey, setReloadKey] = useState(0);
  const profileState = useData(useCallback(() => api.getProfile(), [api, reloadKey]));

  if (profileState.kind === 'loading') {
    return (
      <PageRoot containerWidth="small">
        <PageBody>
          <EmptyState>
            <ProgressCircle isIndeterminate aria-label={stringFormatter.format('loadingEntriesAriaLabel')} />
          </EmptyState>
        </PageBody>
      </PageRoot>
    );
  }
  if (profileState.kind === 'error') {
    return (
      <PageRoot containerWidth="small">
        <PageBody>
          <EmptyState title={stringFormatter.format('genericErrorToast')} />
        </PageBody>
      </PageRoot>
    );
  }

  return (
    <PageRoot containerWidth="small">
      <PageHeader>
        <Heading elementType="h1" size="small">
          {stringFormatter.format('profilePageTitle')}
        </Heading>
      </PageHeader>
      <PageBody>
        <Flex direction="column" gap="xlarge" marginTop="large">
          <AvatarSection
            user={profileState.data}
            api={api}
            basePath={router.basePath}
            onUploaded={() => setReloadKey(k => k + 1)}
          />
          <ProfileFieldsSection
            user={profileState.data}
            api={api}
            onSaved={() => {
              setReloadKey(k => k + 1);
              refreshNativeUser();
            }}
          />
          <ChangePasswordSection api={api} />
        </Flex>
      </PageBody>
    </PageRoot>
  );
}

function AvatarSection(props: {
  user: PublicUser;
  api: ReturnType<typeof makeUserManagementApi>;
  basePath: string;
  onUploaded: () => void;
}) {
  const { user, api } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [isUploading, setUploading] = useState(false);

  const onPick = useCallback(
    async (file: File) => {
      if (!ALLOWED_AVATAR_TYPES.has(file.type)) {
        toastQueue.critical(stringFormatter.format('avatarInvalidTypeError'));
        return;
      }
      if (file.size > MAX_AVATAR_BYTES) {
        toastQueue.critical(stringFormatter.format('avatarTooLargeError'));
        return;
      }
      setUploading(true);
      try {
        const contents = await fileToBase64(file);
        await api.uploadAvatar(contents, file.type);
        toastQueue.positive(stringFormatter.format('avatarUpdatedToast'));
        props.onUploaded();
      } catch {
        toastQueue.critical(stringFormatter.format('genericErrorToast'));
      } finally {
        setUploading(false);
      }
    },
    [api, props, stringFormatter]
  );

  return (
    <Flex alignItems="center" gap="large">
      <label style={{ cursor: 'pointer' }}>
        {user.avatar ? (
          <Avatar src={avatarUrl(props.basePath, user.avatar)} alt={user.name} size="xlarge" />
        ) : (
          <Avatar name={user.name} alt={user.name} size="xlarge" />
        )}
        <input
          type="file"
          accept={[...ALLOWED_AVATAR_TYPES].join(',')}
          style={{ display: 'none' }}
          disabled={isUploading}
          onChange={event => {
            const file = event.target.files?.[0];
            if (file) onPick(file);
            event.target.value = '';
          }}
        />
      </label>
      <Flex direction="column">
        <Text weight="bold">{user.name}</Text>
        <Text color="neutralSecondary">{user.email}</Text>
        {isUploading && <Text size="small">{stringFormatter.format('loading')}</Text>}
      </Flex>
    </Flex>
  );
}

function ProfileFieldsSection(props: {
  user: PublicUser;
  api: ReturnType<typeof makeUserManagementApi>;
  onSaved: () => void;
}) {
  const { user, api } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [name, setName] = useState(user.name);
  const [phoneNumber, setPhoneNumber] = useState(user.phoneNumber ?? '');
  const [address, setAddress] = useState(user.address ?? '');
  const [isSaving, setSaving] = useState(false);

  const hasChanged =
    name !== user.name ||
    phoneNumber !== (user.phoneNumber ?? '') ||
    address !== (user.address ?? '');

  return (
    <Flex direction="column" gap="regular">
      <TextField
        label={stringFormatter.format('userNameLabel')}
        value={name}
        onChange={setName}
        isRequired
      />
      <TextField
        label={stringFormatter.format('userPhoneNumberLabel')}
        value={phoneNumber}
        onChange={setPhoneNumber}
      />
      <TextField
        label={stringFormatter.format('userAddressLabel')}
        value={address}
        onChange={setAddress}
      />
      <Button
        alignSelf="start"
        prominence="high"
        isDisabled={!hasChanged || !name.trim()}
        isPending={isSaving}
        onPress={async () => {
          setSaving(true);
          try {
            await api.updateProfile({ name: name.trim(), phoneNumber, address });
            toastQueue.positive(stringFormatter.format('profileUpdatedToast'));
            props.onSaved();
          } catch {
            toastQueue.critical(stringFormatter.format('genericErrorToast'));
          } finally {
            setSaving(false);
          }
        }}
      >
        {stringFormatter.format('save')}
      </Button>
    </Flex>
  );
}

function ChangePasswordSection(props: { api: ReturnType<typeof makeUserManagementApi> }) {
  const { api } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isSaving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // nullable together: none filled is a no-op section, any one filled
  // requires the other two (plan mục 6).
  const anyFilled = !!(oldPassword || newPassword || confirmPassword);

  return (
    <Flex direction="column" gap="regular">
      <Heading size="small">{stringFormatter.format('changePasswordTitle')}</Heading>
      {error && <Notice tone="critical">{error}</Notice>}
      <SyncedPasswordField
        label={stringFormatter.format('currentPasswordLabel')}
        value={oldPassword}
        onChange={setOldPassword}
        autoComplete="current-password"
      />
      <SyncedPasswordField
        label={stringFormatter.format('newPasswordLabel')}
        value={newPassword}
        onChange={setNewPassword}
        autoComplete="new-password"
      />
      <SyncedPasswordField
        label={stringFormatter.format('newPasswordConfirmLabel')}
        value={confirmPassword}
        onChange={setConfirmPassword}
        autoComplete="new-password"
      />
      <Button
        alignSelf="start"
        prominence="high"
        isDisabled={!anyFilled}
        isPending={isSaving}
        onPress={async () => {
          setError(null);
          if (newPassword !== confirmPassword) {
            setError(stringFormatter.format('passwordMismatchError'));
            return;
          }
          if (newPassword.length < 8) {
            setError(stringFormatter.format('passwordTooShortError'));
            return;
          }
          setSaving(true);
          try {
            await api.changePassword(oldPassword, newPassword);
            toastQueue.positive(stringFormatter.format('passwordChangedToast'));
            setOldPassword('');
            setNewPassword('');
            setConfirmPassword('');
          } catch (err) {
            setError(
              err instanceof ApiError && err.code === 'invalid-current-password'
                ? stringFormatter.format('invalidCurrentPasswordError')
                : stringFormatter.format('genericErrorToast')
            );
          } finally {
            setSaving(false);
          }
        }}
      >
        {stringFormatter.format('save')}
      </Button>
    </Flex>
  );
}
