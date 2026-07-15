import { ButtonGroup, ActionButton, Button } from '@keystar/ui/button';
import { FieldDescription, FieldLabel, FieldMessage } from '@keystar/ui/field';
import { Icon } from '@keystar/ui/icon';
import { fileCodeIcon } from '@keystar/ui/icon/icons/fileCodeIcon';
import { Flex, Box } from '@keystar/ui/layout';
import { Text } from '@keystar/ui/typography';

import { useId, useReducer } from 'react';
import { FormFieldInputProps } from '../../api';
import { openMediaLibrary } from '../../../app/media-library/bridge';
import { useMediaLibraryPreviewURL } from '../../../app/media-library/useMediaLibraryPreviewURL';
import { useEntryDirectoryContext } from '../../../app/entry-form';

// TODO: button labels ("Choose from library", "Remove", "Download") need i18n support
export function FileFieldInput(
  props: FormFieldInputProps<string | null> & {
    label: string;
    description: string | undefined;
    validation: { isRequired?: boolean } | undefined;
  }
) {
  const { value } = props;
  const [blurred, onBlur] = useReducer(() => true, false);
  const objectUrl = useMediaLibraryPreviewURL(value);
  const entryDirectory = useEntryDirectoryContext();
  const labelId = useId();
  const descriptionId = useId();
  return (
    <Flex
      aria-describedby={props.description ? descriptionId : undefined}
      aria-labelledby={labelId}
      direction="column"
      gap="medium"
      role="group"
    >
      <FieldLabel
        id={labelId}
        elementType="span"
        isRequired={props.validation?.isRequired}
      >
        {props.label}
      </FieldLabel>
      {props.description && (
        <FieldDescription id={descriptionId}>
          {props.description}
        </FieldDescription>
      )}
      <ButtonGroup>
        <ActionButton
          onPress={async () => {
            const picked = await openMediaLibrary({
              accept: 'any',
              local: entryDirectory
                ? { directory: `${entryDirectory}/assets`, label: 'This entry' }
                : undefined,
            });
            onBlur();
            if (picked) {
              props.onChange(picked.path);
            }
          }}
        >
          Choose from library
        </ActionButton>
        {value !== null && (
          <>
            <ActionButton
              prominence="low"
              onPress={() => {
                props.onChange(null);
                onBlur();
              }}
            >
              Remove
            </ActionButton>
            {objectUrl && (
              <Button
                href={objectUrl}
                download={value.split('/').pop()}
                prominence="low"
              >
                Download
              </Button>
            )}
          </>
        )}
      </ButtonGroup>
      {value !== null && (
        <Box
          alignSelf="start"
          backgroundColor="canvas"
          borderRadius="regular"
          border="neutral"
          padding="regular"
        >
          <Flex alignItems="center" gap="regular">
            <Icon src={fileCodeIcon} />
            <Text UNSAFE_style={{ wordBreak: 'break-all' }}>
              {value.split('/').pop()}
            </Text>
          </Flex>
        </Box>
      )}
      {(props.forceValidation || blurred) &&
        props.validation?.isRequired &&
        value === null && (
          <FieldMessage>{props.label} is required</FieldMessage>
        )}
    </Flex>
  );
}
