import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { Flex } from '@keystar/ui/layout';
import { TextLink } from '@keystar/ui/link';
import { Heading, Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';

export function EmptyRepo(props: { repo: string }) {
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
          <Heading>{stringFormatter.format('gitRepoNotInitializedTitle')}</Heading>
        </Flex>
        <Text>
          {stringFormatter.format('emptyRepoPrefix')}{' '}
          <TextLink href={`https://github.com/${props.repo}`}>
            {props.repo}
          </TextLink>{' '}
          {stringFormatter.format('emptyRepoSuffix')}
        </Text>
      </Flex>
    </Flex>
  );
}
