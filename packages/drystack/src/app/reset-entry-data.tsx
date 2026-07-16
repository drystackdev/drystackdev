import { useMemo, useState } from 'react';

import { AlertDialog, DialogContainer } from '@keystar/ui/dialog';
import { Button } from '@keystar/ui/button';
import { Notice } from '@keystar/ui/notice';
import { Text } from '@keystar/ui/typography';

import { Config } from '../config';
import { ComponentSchema, fields } from '../form/api';
import { getInitialPropsValue } from '../form/initial-values';
import { FormatInfo } from './path-utils';
import { useUpsertItem } from './updating';

// Recovery path for the "Field validation failed: ... is not allowed" class
// of error: the schema changed but the entry's saved data on disk didn't, so
// every load throws before the form can ever mount, and there's no way for
// the user to get back into the entry to fix it by hand. Resetting writes a
// fresh, schema-valid default value over the entry's data file (keeping its
// slug, so it stays at the same URL) — it can't recover the old field
// values, since parsing already failed before any of them could be read, but
// it unblocks the entry instead of leaving it stuck forever.
export function ResetEntryDataButton(props: {
  config: Config;
  schema: Record<string, ComponentSchema>;
  basePath: string;
  format: FormatInfo;
  slug: { field: string; value: string } | undefined;
  onReset: () => void;
}) {
  const { schema, slug } = props;
  const resetState = useMemo(() => {
    const state = getInitialPropsValue(fields.object(schema)) as Record<
      string,
      unknown
    >;
    if (slug) {
      state[slug.field] = { name: slug.value, slug: slug.value };
    }
    return state;
  }, [schema, slug]);

  const [updateResult, update] = useUpsertItem({
    state: resetState,
    initialFiles: undefined,
    config: props.config,
    schema: props.schema,
    basePath: props.basePath,
    format: props.format,
    currentLocalTreeKey: undefined,
    slug: props.slug,
  });

  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <>
      <Button
        tone="critical"
        isPending={updateResult.kind === 'loading'}
        onPress={() => setConfirmOpen(true)}
      >
        Reset entry data
      </Button>
      {updateResult.kind === 'error' && (
        <Notice tone="critical">{updateResult.error.message}</Notice>
      )}
      <DialogContainer onDismiss={() => setConfirmOpen(false)}>
        {confirmOpen && (
          <AlertDialog
            title="Reset entry data"
            tone="critical"
            cancelLabel="Cancel"
            primaryActionLabel="Reset"
            autoFocusButton="cancel"
            onPrimaryAction={async () => {
              setConfirmOpen(false);
              if (await update()) props.onReset();
            }}
          >
            <Text>
              This entry's saved data no longer matches its current schema
              and can't be loaded. Resetting clears every field back to its
              default value so the entry can be opened and edited again — it
              keeps the same URL, but none of what's already saved in it can
              be recovered this way. This can't be undone.
            </Text>
          </AlertDialog>
        )}
      </DialogContainer>
    </>
  );
}
