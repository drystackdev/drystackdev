import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { Heading } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { PageBody, PageHeader, PageRoot } from '../shell/page';
import { FileManagerRoot } from './FileManagerRoot';

export function FileManagerPage() {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <PageRoot containerWidth="large">
      <PageHeader>
        <Heading elementType="h1" id="page-title" size="small">
          {stringFormatter.format('fileManagement')}
        </Heading>
      </PageHeader>
      <PageBody isScrollable>
        <FileManagerRoot mode={{ kind: 'page' }} />
      </PageBody>
    </PageRoot>
  );
}
