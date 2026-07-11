import { ActionButton, Button, ButtonGroup } from '@keystar/ui/button';
import { FieldDescription, FieldLabel, FieldMessage } from '@keystar/ui/field';
import { Icon } from '@keystar/ui/icon';
import { fileCodeIcon } from '@keystar/ui/icon/icons/fileCodeIcon';
import { trash2Icon } from '@keystar/ui/icon/icons/trash2Icon';
import { Flex } from '@keystar/ui/layout';
import { Text } from '@keystar/ui/typography';

import { useId, useReducer } from 'react';
import { FormFieldInputProps } from '../../api';
import { openMediaLibraryMulti } from '../../../app/media-library/bridge';
import { useMediaLibraryPreviewURL } from '../../../app/media-library/useMediaLibraryPreviewURL';
import { useInView } from '../../../app/file-manager/useInView';

function FileRow(props: { path: string; onRemove: () => void }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const objectUrl = useMediaLibraryPreviewURL(props.path, undefined, inView);
  const filename = props.path.split('/').pop()!;
  return (
    <Flex ref={ref} alignItems="center" gap="regular">
      <Icon src={fileCodeIcon} />
      <Text UNSAFE_style={{ flex: 1 }}>{filename}</Text>
      {objectUrl && (
        <Button href={objectUrl} download={filename} prominence="low">
          Download
        </Button>
      )}
      <ActionButton prominence="low" onPress={props.onRemove}>
        <Icon src={trash2Icon} />
      </ActionButton>
    </Flex>
  );
}

// TODO: button labels ("Choose from library", "Remove", "Download") need i18n support
export function FilesFieldInput(
  props: FormFieldInputProps<string[]> & {
    label: string;
    description: string | undefined;
    validation: { isRequired?: boolean } | undefined;
  }
) {
  const { value } = props;
  const [blurred, onBlur] = useReducer(() => true, false);
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
      {value.length > 0 && (
        <Flex direction="column" gap="regular">
          {value.map((path, index) => (
            <FileRow
              key={`${index}-${path}`}
              path={path}
              onRemove={() => {
                props.onChange(value.filter((_, i) => i !== index));
                onBlur();
              }}
            />
          ))}
        </Flex>
      )}
      <ButtonGroup>
        <ActionButton
          onPress={async () => {
            const picked = await openMediaLibraryMulti({ accept: 'any' });
            onBlur();
            if (picked?.length) {
              props.onChange([...value, ...picked.map(pick => pick.path)]);
            }
          }}
        >
          Choose from library
        </ActionButton>
      </ButtonGroup>
      {(props.forceValidation || blurred) &&
        props.validation?.isRequired &&
        value.length === 0 && (
          <FieldMessage>{props.label} is required</FieldMessage>
        )}
    </Flex>
  );
}
