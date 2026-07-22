import { FormEvent, useMemo, useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { Button } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { checkIcon } from '@keystar/ui/icon/icons/checkIcon';
import { copyIcon } from '@keystar/ui/icon/icons/copyIcon';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { TextField } from '@keystar/ui/text-field';
import { toastQueue } from '@keystar/ui/toast';
import { Heading, Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { PageBody, PageHeader, PageRoot } from '../shell/page';
import { useRouter } from '../router';
import { notFound } from '../not-found';
import { useConfig } from '../shell/context';
import { isR2Config } from '../storage-mode';
import { ApiError, makeUserManagementApi } from './api';

export function AddUserPage() {
  const config = useConfig();
  if (!isR2Config(config)) notFound();
  const router = useRouter();
  const api = useMemo(() => makeUserManagementApi(router.basePath), [router.basePath]);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [address, setAddress] = useState('');
  const [isSubmitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ inviteLink: string; emailSent: boolean } | null>(null);
  const [copied, setCopied] = useState(false);

  if (result) {
    return (
      <PageRoot containerWidth="small">
        <PageHeader>
          <Heading elementType="h1" size="small">
            {stringFormatter.format('userAddAction')}
          </Heading>
        </PageHeader>
        <PageBody>
          <Flex direction="column" gap="large" marginTop="large">
            <Notice tone={result.emailSent ? 'positive' : 'caution'}>
              {result.emailSent
                ? stringFormatter.format('userInviteSentNotice')
                : stringFormatter.format('userInviteNotSentNotice')}
            </Notice>
            {!result.emailSent && (
              <Flex gap="regular" alignItems="end">
                <TextField
                  label={stringFormatter.format('userInviteLinkLabel')}
                  value={result.inviteLink}
                  isReadOnly
                  flex
                />
                <Button
                  onPress={() => {
                    navigator.clipboard.writeText(result.inviteLink).then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    });
                  }}
                >
                  <Icon src={copied ? checkIcon : copyIcon} />
                  <Text>{stringFormatter.format(copied ? 'copiedAction' : 'copyAction')}</Text>
                </Button>
              </Flex>
            )}
            <Button prominence="high" href={`${router.basePath}/users`}>
              {stringFormatter.format('backToUsersAction')}
            </Button>
          </Flex>
        </PageBody>
      </PageRoot>
    );
  }

  return (
    <PageRoot containerWidth="small">
      <PageHeader>
        <Heading elementType="h1" size="small">
          {stringFormatter.format('userAddAction')}
        </Heading>
      </PageHeader>
      <PageBody>
        <Flex
          elementType="form"
          direction="column"
          gap="large"
          marginTop="large"
          onSubmit={async (event: FormEvent) => {
            event.preventDefault();
            setError(null);
            if (!email.trim() || !name.trim()) {
              setError(stringFormatter.format('userAddRequiredFieldsError'));
              return;
            }
            setSubmitting(true);
            try {
              const { inviteToken, emailSent } = await api.addUser({
                email: email.trim(),
                name: name.trim(),
                phoneNumber: phoneNumber.trim() || undefined,
                address: address.trim() || undefined,
              });
              toastQueue.positive(stringFormatter.format('userAddedToast'));
              setResult({
                inviteLink: `${location.origin}/password-setting?token=${inviteToken}`,
                emailSent,
              });
            } catch (err) {
              setError(
                err instanceof ApiError && err.code === 'email-already-exists'
                  ? stringFormatter.format('emailAlreadyExistsError')
                  : stringFormatter.format('genericErrorToast')
              );
            } finally {
              setSubmitting(false);
            }
          }}
        >
          {error && <Notice tone="critical">{error}</Notice>}
          <TextField
            label={stringFormatter.format('userEmailLabel')}
            value={email}
            onChange={setEmail}
            type="email"
            isRequired
            autoFocus
          />
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
          <Flex gap="regular">
            <Button type="submit" prominence="high" isPending={isSubmitting}>
              {stringFormatter.format('userAddAction')}
            </Button>
            <Button href={`${router.basePath}/users`}>{stringFormatter.format('cancel')}</Button>
          </Flex>
        </Flex>
      </PageBody>
    </PageRoot>
  );
}
