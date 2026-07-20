import { useState } from 'react';
import { useLocalizedStringFormatter } from '@react-aria/i18n';
import l10nMessages from '../l10n';
import { Button, ButtonGroup } from '@keystar/ui/button';
import { Checkbox } from '@keystar/ui/checkbox';
import { Dialog } from '@keystar/ui/dialog';
import { Content } from '@keystar/ui/slots';
import { Flex } from '@keystar/ui/layout';
import { Heading, Text } from '@keystar/ui/typography';
import { ConflictResolution, UploadConflictState } from './useFileManagerUpload';

export function UploadConflictDialog(props: {
  state: UploadConflictState;
  onResolve: (resolution: ConflictResolution, applyToAllRemaining: boolean) => void;
}) {
  const [applyToAll, setApplyToAll] = useState(false);
  const current = props.state.files[props.state.index];
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  return (
    <Dialog size="small">
      <Heading>{stringFormatter.format('fileAlreadyExistsTitle')}</Heading>
      <Content>
        <Flex direction="column" gap="large">
          <Text>
            <strong>{current.targetPath}</strong>{' '}
            {stringFormatter.format('fileAlreadyExistsBody')}
          </Text>
          {props.state.remainingConflicts > 1 && (
            <Checkbox isSelected={applyToAll} onChange={setApplyToAll}>
              {stringFormatter.format('applyToAllRemainingConflicts', {
                count: props.state.remainingConflicts,
              })}
            </Checkbox>
          )}
        </Flex>
      </Content>
      <ButtonGroup>
        <Button onPress={() => props.onResolve('skip', applyToAll)}>
          {stringFormatter.format('cancel')}
        </Button>
        <Button onPress={() => props.onResolve('rename', applyToAll)}>
          {stringFormatter.format('uploadAsCopyAction')}
        </Button>
        <Button
          prominence="high"
          tone="critical"
          onPress={() => props.onResolve('replace', applyToAll)}
        >
          {stringFormatter.format('replaceAction')}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
