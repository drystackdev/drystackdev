import { useState } from 'react';
import { Button, ButtonGroup, ActionButton } from '@keystar/ui/button';
import { Dialog } from '@keystar/ui/dialog';
import { FileTrigger } from '@keystar/ui/drag-and-drop';
import { Icon } from '@keystar/ui/icon';
import { fileUpIcon } from '#icons/fileUpIcon';
import { Flex } from '@keystar/ui/layout';
import { Content } from '@keystar/ui/slots';
import { Heading, Text } from '@keystar/ui/typography';
import { TextField } from '@keystar/ui/text-field';

function validateName(name: string, existingNames: ReadonlySet<string>) {
  if (!name) return undefined;
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\')) {
    return "That's not a valid folder name.";
  }
  if (existingNames.has(name)) {
    return 'A file or folder with this name already exists here.';
  }
  return undefined;
}

export function NewFolderDialog(props: {
  existingNames: ReadonlySet<string>;
  isCreating: boolean;
  onCancel: () => void;
  onCreate: (name: string, files: File[]) => void;
}) {
  const [name, setName] = useState('');
  // a folder can't exist empty in this app's git-backed storage, so
  // creating one means seeding it with at least one real file
  const [files, setFiles] = useState<File[]>([]);
  const trimmed = name.trim();
  const error = validateName(trimmed, props.existingNames);
  const canCreate = !props.isCreating && !!trimmed && !error && files.length > 0;

  return (
    <Dialog size="small">
      <form
        style={{ display: 'contents' }}
        onSubmit={event => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (!canCreate) return;
          props.onCreate(trimmed, files);
        }}
      >
        <Heading>New folder</Heading>
        <Content>
          <Flex direction="column" gap="regular">
            <TextField
              label="Folder name"
              value={name}
              onChange={setName}
              autoFocus
              errorMessage={error}
            />
            <FileTrigger
              allowsMultiple
              onSelect={selected => setFiles(selected ? Array.from(selected) : [])}
            >
              <ActionButton>
                <Icon src={fileUpIcon} />
                <Text>Choose files…</Text>
              </ActionButton>
            </FileTrigger>
            <Text size="small" color="neutralSecondary">
              {files.length === 0
                ? 'A folder needs at least one file — GitHub can’t store empty folders.'
                : `${files.length} file${files.length === 1 ? '' : 's'} selected: ${files
                    .map(f => f.name)
                    .join(', ')}`}
            </Text>
          </Flex>
        </Content>
        <ButtonGroup>
          <Button onPress={props.onCancel} isDisabled={props.isCreating}>
            Cancel
          </Button>
          <Button
            type="submit"
            prominence="high"
            isDisabled={!canCreate}
            isPending={props.isCreating}
          >
            Create
          </Button>
        </ButtonGroup>
      </form>
    </Dialog>
  );
}
