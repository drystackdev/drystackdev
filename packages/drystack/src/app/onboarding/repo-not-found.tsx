import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { Flex } from '@keystar/ui/layout';
import { Heading, Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { GitHubConfig } from '../..';
import { InstallGitHubApp } from './install-app';
import { serializeRepoConfig } from '../repo-config';

export function RepoNotFound(props: { config: GitHubConfig }) {
  const repo = serializeRepoConfig(props.config.storage.repo);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
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
        <Flex justifyContent="center">
          <Heading>{stringFormatter.format('repoNotFoundTitle')}</Heading>
        </Flex>
        <Text>
          {stringFormatter.format('repoNotFoundPrefix')}{' '}
          <a href={`https://github.com/${repo}`}>{repo}</a>{' '}
          {stringFormatter.format('repoNotFoundSuffix')}
        </Text>
        <InstallGitHubApp config={props.config} />
      </Flex>
    </Flex>
  );
}
