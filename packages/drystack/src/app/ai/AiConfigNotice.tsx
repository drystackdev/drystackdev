import { Box } from '@keystar/ui/layout';
import { Notice } from '@keystar/ui/notice';
import { Text } from '@keystar/ui/typography';

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
  // undefined = still checking, or no `ai` block at all. Neither is worth
  // interrupting anyone over.
  if (!status || status.configured) return null;

  return (
    <Box padding="regular">
      <Notice tone="caution">
        <Text>
          Đã bật AI trong <code>drystack.config.ts</code> nhưng chưa dùng được:{' '}
          {status.message ?? 'thiếu cấu hình.'} Nút “Magic write” sẽ không hoạt
          động cho tới khi biến môi trường được đặt đúng.
        </Text>
      </Notice>
    </Box>
  );
}
