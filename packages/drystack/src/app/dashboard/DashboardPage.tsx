import { useLocalizedStringFormatter } from '@react-aria/i18n';

import { Flex } from '@keystar/ui/layout';
import { Heading } from '@keystar/ui/typography';

import { Config } from '../../config';

import l10nMessages from '../l10n';
import { PageBody, PageHeader, PageRoot } from '../shell/page';

import { DashboardCards } from './DashboardCards';

export function DashboardPage(props: { config: Config; basePath: string }) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  return (
    <PageRoot containerWidth="large">
      <PageHeader>
        <Heading elementType="h1" id="page-title" size="small">
          {stringFormatter.format('dashboard')}
        </Heading>
      </PageHeader>
      <PageBody isScrollable>
        <Flex direction="column" gap="xxlarge">
          <DashboardCards />
        </Flex>
      </PageBody>
    </PageRoot>
  );
}
