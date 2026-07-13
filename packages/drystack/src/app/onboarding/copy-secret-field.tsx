import { useState, ReactNode } from 'react';
import { ActionButton } from '@keystar/ui/button';
import { Flex } from '@keystar/ui/layout';
import { TextField } from '@keystar/ui/text-field';

const MASK = '•'.repeat(20);

export function CopySecretField(props: { label: ReactNode; value: string }) {
  const [revealed, setRevealed] = useState(false);
  return (
    <Flex alignItems="end" gap="regular">
      <TextField
        label={props.label}
        width="100%"
        isReadOnly
        value={revealed ? props.value : MASK}
      />
      <ActionButton onPress={() => setRevealed(r => !r)}>
        {revealed ? 'Hide' : 'Show'}
      </ActionButton>
      <ActionButton onPress={() => navigator.clipboard.writeText(props.value)}>
        Copy
      </ActionButton>
    </Flex>
  );
}
