import type { LocalizedStringFormatter } from '@react-aria/i18n';

import type { AiConfigErrorReason } from '../../api/ai/env';

// Keeps the admin UI's language in sync with the rest of the shell instead of
// echoing the server's Vietnamese-only `message` verbatim - `reason` is the
// stable part of the payload, `message`/`params` only fill in the blanks.
const REASON_KEYS: Record<AiConfigErrorReason, string> = {
  'missing-provider': 'aiMissingProvider',
  'unknown-provider': 'aiUnknownProvider',
  'missing-key': 'aiMissingKey',
  'missing-model': 'aiMissingModel',
  'missing-base-url': 'aiMissingBaseUrl',
};

export function localizeAiConfigError(
  stringFormatter: LocalizedStringFormatter,
  status: {
    reason?: string;
    message?: string;
    params?: Record<string, string>;
  } | undefined
): string {
  const key = status?.reason && REASON_KEYS[status.reason as AiConfigErrorReason];
  if (key) return stringFormatter.format(key, status?.params);
  return status?.message ?? stringFormatter.format('aiConfigMissing');
}
