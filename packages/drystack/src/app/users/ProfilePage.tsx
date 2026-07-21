import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { useState } from 'react';

import { Button, ButtonGroup } from '@keystar/ui/button';
import { Flex } from '@keystar/ui/layout';
import { toastQueue } from '@keystar/ui/toast';
import { Heading } from '@keystar/ui/typography';

import { SyncedPasswordField } from '../components/SyncedPasswordField';
import l10nMessages from '../l10n';
import { useNativeUser } from '../native-user';
import { useRouter } from '../router';
import { PageBody, PageHeader, PageRoot } from '../shell/page';
import { UserFields } from './UserDetailForm';

export function ProfilePage() {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const nativeUser = useNativeUser();
  return (
    <PageRoot>
      <PageHeader>
        <Heading elementType="h1" id="page-title" size="small">
          {stringFormatter.format('profilePageTitle')}
        </Heading>
      </PageHeader>
      <PageBody isScrollable>
        <Flex direction="column" gap="xxlarge" maxWidth="scale.4600">
          {nativeUser && (
            <UserFields
              key={nativeUser.email}
              email={nativeUser.email}
              initialProfile={nativeUser.profile}
              initialHasAvatar={nativeUser.hasAvatar}
              mode="self"
            />
          )}
          <PasswordSection />
        </Flex>
      </PageBody>
    </PageRoot>
  );
}

function PasswordSection() {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const { basePath } = useRouter();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newPasswordConfirm, setNewPasswordConfirm] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);

  async function submit() {
    setError(undefined);
    if (newPassword !== newPasswordConfirm) {
      setError(stringFormatter.format('passwordMismatchError'));
      return;
    }
    if (newPassword.length < 8) {
      setError(stringFormatter.format('passwordTooShortError'));
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api${basePath}/auth/password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          oldPassword,
          newPassword,
          newPasswordConfirm,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setError(
          body?.error === 'invalid-current-password'
            ? stringFormatter.format('invalidCurrentPasswordError')
            : body?.error === 'password-too-short'
              ? stringFormatter.format('passwordTooShortError')
              : body?.error === 'password-mismatch'
                ? stringFormatter.format('passwordMismatchError')
                : stringFormatter.format('genericErrorToast')
        );
        return;
      }
      toastQueue.positive(stringFormatter.format('passwordChangedToast'));
      setOldPassword('');
      setNewPassword('');
      setNewPasswordConfirm('');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Flex direction="column" gap="regular">
      <Heading elementType="h2" size="small">
        {stringFormatter.format('changePasswordTitle')}
      </Heading>
      <form
        onSubmit={event => {
          event.preventDefault();
          submit();
        }}
      >
        <Flex direction="column" gap="regular">
          <SyncedPasswordField
            label={stringFormatter.format('currentPasswordLabel')}
            value={oldPassword}
            onChange={value => {
              setOldPassword(value);
              setError(undefined);
            }}
            autoComplete="current-password"
          />
          <SyncedPasswordField
            label={stringFormatter.format('newPasswordLabel')}
            value={newPassword}
            onChange={value => {
              setNewPassword(value);
              setError(undefined);
            }}
            autoComplete="new-password"
          />
          <SyncedPasswordField
            label={stringFormatter.format('newPasswordConfirmLabel')}
            value={newPasswordConfirm}
            onChange={value => {
              setNewPasswordConfirm(value);
              setError(undefined);
            }}
            autoComplete="new-password"
            errorMessage={error}
          />
          <ButtonGroup>
            <Button
              type="submit"
              prominence="high"
              isPending={isSubmitting}
              isDisabled={!oldPassword || !newPassword || !newPasswordConfirm}
            >
              {stringFormatter.format('save')}
            </Button>
          </ButtonGroup>
        </Flex>
      </form>
    </Flex>
  );
}
