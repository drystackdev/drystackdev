import { useEffect, useState } from 'react';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { Heading, Text } from '@keystar/ui/typography';
import { GitHubConfig } from '../..';
import { InstallGitHubApp } from './install-app';
import { serializeRepoConfig } from '../repo-config';
import { useRouter } from '../router';
import { CopySecretField } from './copy-secret-field';

const SECRET_KEYS = [
  'DRYSTACK_GITHUB_CLIENT_ID',
  'DRYSTACK_GITHUB_CLIENT_SECRET',
  'DRYSTACK_SECRET',
] as const;

function readSecretsFromHash(): Record<string, string> | undefined {
  const hash = window.location.hash;
  if (!hash) return undefined;
  const params = new URLSearchParams(hash.slice(1));
  const secrets: Record<string, string> = {};
  for (const key of SECRET_KEYS) {
    const value = params.get(key);
    if (!value) return undefined;
    secrets[key] = value;
  }
  return secrets;
}

export function CreatedGitHubApp(props: { config: GitHubConfig }) {
  const router = useRouter();
  const [secrets, setSecrets] = useState<Record<string, string>>();
  useEffect(() => {
    if (!window.location.hash) return;
    setSecrets(readSecretsFromHash());
    // strip the secrets from the URL/history whether or not they parsed —
    // nothing should linger in the address bar or tab-restore state.
    router.replace(router.href);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Flex alignItems="center" justifyContent="center" margin="xxlarge">
      <Flex
        backgroundColor="surface"
        padding="large"
        border="color.alias.borderIdle"
        borderRadius="medium"
        direction="column"
        justifyContent="center"
        gap="xlarge"
        maxWidth="scale.4600"
      >
        <Heading>You've installed drystack! 🎉</Heading>
        {secrets && (
          <>
            <Notice tone="caution">
              <Text>
                This server couldn't save these to a <code>.env</code> file
                (no writable filesystem here). Copy them now and add them as
                environment variables in your hosting provider — they won't
                be shown again.
              </Text>
            </Notice>
            {SECRET_KEYS.map(key => (
              <CopySecretField
                key={key}
                label={<code>{key}</code>}
                value={secrets[key]}
              />
            ))}
          </>
        )}
        <Text>
          To start using drystack, you need to install the GitHub app you've
          created.
        </Text>
        <Text>
          Make sure to add the App to the{' '}
          <code>{serializeRepoConfig(props.config.storage.repo)}</code>{' '}
          repository.
        </Text>
        <InstallGitHubApp config={props.config} />
      </Flex>
    </Flex>
  );
}
