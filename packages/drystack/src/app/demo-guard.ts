import { toastQueue } from '@keystar/ui/toast';
import {
  LocalizedStringDictionary,
  LocalizedStringFormatter,
} from '@internationalized/string';
import l10nMessages from './l10n';

// Every admin-app write hook (useUpsertItem/useDeleteItem in updating.tsx,
// useMediaLibraryUpload, useTrash, useFileManagerUpload) calls this at its
// own single choke point - before any network/tree work starts - so a demo
// visitor sees the exact same message no matter which action they tried.
// VEI's equivalent lives in editor/save.ts's saveEdits: a separate package
// with its own @keystar/ui/toast import already, so it isn't worth a
// cross-package dependency just to share one string (see that file's
// veiDemoModeNotSaved key, same English text as this one).

const l10nDictionary = new LocalizedStringDictionary(l10nMessages);

// Non-hook fallback - blockWriteInDemo()/blockWriteInDemoWithError() are
// called from inside write hooks' event handlers, not during render, so
// useLocalizedStringFormatter can't be called here directly. Takes a locale
// snapshot rather than reacting to changes, fine for a one-off toast.
function getDefaultFormatter(): { format(key: string): string } {
  const locale =
    (typeof document !== 'undefined' && document.documentElement.lang) ||
    (typeof navigator !== 'undefined' && navigator.language) ||
    'en-US';
  return new LocalizedStringFormatter(locale, l10nDictionary);
}

export function blockWriteInDemo(
  stringFormatter: { format(key: string): string } = getDefaultFormatter(),
): void {
  toastQueue.info(stringFormatter.format('veiDemoModeNotSaved'), {
    timeout: 4000,
  });
}

// For write paths whose contract requires resolving to a value or rejecting
// (e.g. useMediaLibraryUpload's Promise<string>) rather than an
// idle/loading/error state the caller can check - toasts, then rejects, so
// the caller's own catch/loading-state handling still runs correctly instead
// of treating a blocked write as a silent success.
export function blockWriteInDemoWithError(
  stringFormatter: { format(key: string): string } = getDefaultFormatter(),
): never {
  blockWriteInDemo(stringFormatter);
  throw new Error(stringFormatter.format('veiDemoModeNotSaved'));
}
