import { useLocalizedStringFormatter } from '@react-aria/i18n';
import { useEffect } from 'react';
import { toastQueue } from '@keystar/ui/toast';
import { Text } from '@keystar/ui/typography';

import l10nMessages from '../l10n';
import { localizeAiConfigError } from './ai-config-error-message';
import { useAiStatus } from './useAiStatus';

// Module-level so the toast survives remounts of the shell (branch switches,
// strict-mode double effects) and still only fires once per admin page load.
let hasWarned = false;

/**
 * Warns once, on entering the admin, that `ai` is configured but unusable.
 *
 * This is a config mistake the user can only see from here: the Magic write
 * button is disabled with a tooltip, but nothing else would say why, and the
 * key lives in the environment rather than in a file they'd think to check.
 */
export function AiConfigNotice() {
  const status = useAiStatus();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  useEffect(() => {
    // undefined = still checking, or no `ai` block at all. Neither is worth
    // interrupting anyone over.
    if (!status || status.configured || hasWarned) return;
    hasWarned = true;

    const reasonText = localizeAiConfigError(stringFormatter, status);

    // Toast only wraps plain text in <Text> itself; a fragment has to do it.
    toastQueue.critical(
      <Text>
        {stringFormatter.format('aiConfigNoticePrefix')}{' '}
        <code>drystack.config.ts</code>{' '}
        {stringFormatter.format('aiConfigNoticeSuffix', { reason: reasonText })}
      </Text>
    );
  }, [status, stringFormatter]);

  return null;
}
