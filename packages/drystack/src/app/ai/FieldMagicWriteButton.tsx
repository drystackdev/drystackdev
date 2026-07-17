import { useContext, useState } from 'react';

import { ActionButton } from '@keystar/ui/button';
import { DialogContainer } from '@keystar/ui/dialog';
import { Icon } from '@keystar/ui/icon';
import { Tooltip, TooltipTrigger } from '@keystar/ui/tooltip';

import { PathContext } from '../../form/fields/text/path-slug-context';
import { describeField } from '../../api/ai/schema-to-yaml';
import { magicWriteIcon } from '../icons/magicWriteIcon';
import { MagicWriteDialog } from './MagicWriteDialog';
import { useAiStatus } from './useAiStatus';
import { useFieldMagicWrite } from './field-magic-write-context';

/**
 * Per-field "write just this one" button, rendered next to a field's own
 * label. Everything else in the entry becomes context, so the model writes
 * something that fits what's already there.
 *
 * Only appears on top-level fields: the lock and the stream both key off the
 * top-level name, and a button on a nested item would suggest a granularity
 * the rest of the pipeline doesn't have.
 */
export function FieldMagicWriteButton() {
  const ctx = useFieldMagicWrite();
  const path = useContext(PathContext);
  const status = useAiStatus();
  const [isOpen, setOpen] = useState(false);

  if (!ctx) return null;
  if (path.length !== 1) return null;
  const key = path[0];
  if (typeof key !== 'string') return null;

  const schema = ctx.schema[key];
  if (!schema) return null;
  // Unsupported kinds (image, file, relationship) have no spec at all — no
  // button rather than one that would fail.
  if (!describeField(key, schema)) return null;
  if (status?.configured === false) return null;
  // Mid-stream the field is inert; offering to restart it would race the
  // write already in flight.
  if (ctx.magicWrite.status === 'streaming') return null;

  return (
    <>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label="Magic write cho trường này"
          onPress={() => setOpen(true)}
        >
          <Icon src={magicWriteIcon} />
        </ActionButton>
        <Tooltip>Để AI viết riêng trường này</Tooltip>
      </TooltipTrigger>
      <DialogContainer onDismiss={() => setOpen(false)}>
        {isOpen && (
          <MagicWriteDialog
            entryLabel={ctx.entryLabel}
            schema={ctx.schema}
            state={ctx.state}
            singleFieldKey={key}
            onDismiss={() => setOpen(false)}
            onGenerate={request => {
              setOpen(false);
              ctx.magicWrite.start(request);
            }}
          />
        )}
      </DialogContainer>
    </>
  );
}
