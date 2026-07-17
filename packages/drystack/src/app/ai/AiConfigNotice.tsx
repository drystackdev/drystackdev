import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { Box } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { localizeAiConfigError } from './ai-config-error-message';
import { useAiStatus } from './useAiStatus';

/**
 * Warns, on every admin page, that `ai` is configured but unusable.
 *
 * This is a config mistake the user can only see from here: the Magic write
 * button is disabled with a tooltip, but nothing else would say why, and the
 * key lives in the environment rather than in a file they'd think to check.
 */
export function AiConfigNotice() {
  const status = useAiStatus();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  // undefined = still checking, or no `ai` block at all. Neither is worth
  // interrupting anyone over.
  if (!status || status.configured) return null;

  const reasonText = localizeAiConfigError(stringFormatter, status);

  return (
    <Box padding="regular">
      <Notice tone="caution">
        <Text>
          {stringFormatter.format('aiConfigNoticePrefix')}{' '}
          <code>drystack.config.ts</code>{' '}
          {stringFormatter.format('aiConfigNoticeSuffix', {
            reason: reasonText,
          })}
        </Text>
      </Notice>
    </Box>
  );
}
