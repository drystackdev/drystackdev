import { useLocalizedStringFormatter } from '@react-aria/i18n';
import l10nMessages from '../l10n';
import { ActionButton, Button } from '@keystar/ui/button';
import { Flex } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { TextField } from '@keystar/ui/text-field';
import { Text } from '@keystar/ui/typography';
import { useRouter } from '../router';
import { GitHubConfig } from '../../config';
import { createContext, useContext } from 'react';
import { parseRepoConfig } from '../repo-config';

export const AppSlugContext = createContext<
  { envName: string; value: string | undefined } | undefined
>(undefined);

export const AppSlugProvider = AppSlugContext.Provider;

export function InstallGitHubApp(props: { config: GitHubConfig }) {
  const router = useRouter();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const appSlugFromContext = useContext(AppSlugContext);
  const appSlug =
    new URL(router.href, 'https://example.com').searchParams.get('slug') ??
    appSlugFromContext?.value;
  const parsedRepo = parseRepoConfig(props.config.storage.repo);
  return (
    <Flex direction="column" gap="regular">
      <Flex alignItems="end" gap="regular">
        <TextField
          label={stringFormatter.format('repoNameLabel')}
          width="100%"
          isReadOnly
          value={parsedRepo.name}
        />
        <ActionButton
          onPress={() => {
            navigator.clipboard.writeText(parsedRepo.name);
          }}
        >
          {stringFormatter.format('copyRepoNameAction')}
        </ActionButton>
      </Flex>
      {appSlug ? (
        <Button
          prominence="high"
          href={`https://github.com/apps/${appSlug}/installations/new`}
        >
          {stringFormatter.format('installGitHubAppAction')}
        </Button>
      ) : (
        <Notice tone="caution">
          {appSlugFromContext ? (
            <Text>
              {stringFormatter.format('envVarMissingNotice', {
                envName: appSlugFromContext.envName,
              })}
            </Text>
          ) : (
            <Text>{stringFormatter.format('findAppOnGithubNotice')}</Text>
          )}
        </Notice>
      )}
    </Flex>
  );
}
