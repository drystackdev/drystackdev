import { useState, ReactNode } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';
import l10nMessages from '../l10n';
import { ActionButton } from '@keystar/ui/button';
import { Icon } from '@keystar/ui/icon';
import { copyIcon } from '@keystar/ui/icon/icons/copyIcon';
import { eyeIcon } from '@keystar/ui/icon/icons/eyeIcon';
import { eyeOffIcon } from '@keystar/ui/icon/icons/eyeOffIcon';
import { Flex } from '@keystar/ui/layout';
import { TextField } from '@keystar/ui/text-field';
import { TooltipTrigger, Tooltip } from '@keystar/ui/tooltip';

const MASK = '•'.repeat(20);

export function CopySecretField(props: { label: ReactNode; value: string }) {
  const [revealed, setRevealed] = useState(false);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const revealLabel = stringFormatter.format(revealed ? 'hide' : 'show');
  return (
    <Flex alignItems="end" gap="regular">
      <TextField
        label={props.label}
        width="100%"
        isReadOnly
        value={revealed ? props.value : MASK}
      />
      <TooltipTrigger>
        <ActionButton
          aria-label={revealLabel}
          onPress={() => setRevealed(r => !r)}
        >
          <Icon src={revealed ? eyeOffIcon : eyeIcon} />
        </ActionButton>
        <Tooltip>{revealLabel}</Tooltip>
      </TooltipTrigger>
      <TooltipTrigger>
        <ActionButton
          aria-label={stringFormatter.format('copy')}
          onPress={() => navigator.clipboard.writeText(props.value)}
        >
          <Icon src={copyIcon} />
        </ActionButton>
        <Tooltip>{stringFormatter.format('copy')}</Tooltip>
      </TooltipTrigger>
    </Flex>
  );
}
