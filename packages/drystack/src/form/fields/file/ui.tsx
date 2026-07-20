import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ButtonGroup, ActionButton, Button } from "@keystar/ui/button";
import { FieldDescription, FieldLabel, FieldMessage } from "@keystar/ui/field";
import { Icon } from "@keystar/ui/icon";
import { fileCodeIcon } from "@keystar/ui/icon/icons/fileCodeIcon";
import { Flex, Box } from "@keystar/ui/layout";
import { Text } from "@keystar/ui/typography";

import { useId, useReducer, useState } from "react";
import { FormFieldInputProps } from "../../api";
import { openMediaLibrary } from "../../../app/media-library/bridge";
import { useMediaLibraryPreviewURL } from "../../../app/media-library/useMediaLibraryPreviewURL";
import { useEntryDirectoryContext } from "../../../app/entry-form";
import { useObjectURL } from "../image/ui";
import l10nMessages from "../../../app/l10n";

export function FileFieldInput(
  props: FormFieldInputProps<string | null> & {
    label: string;
    description: string | undefined;
    validation: { isRequired?: boolean } | undefined;
  },
) {
  const { value } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [blurred, onBlur] = useReducer(() => true, false);
  // caches the bytes for a file picked/uploaded in this session, since a
  // brand new upload isn't in the tree yet - useMediaLibraryPreviewURL
  // resolves via tree sha and can't find it until the tree next refreshes
  const [freshUpload, setFreshUpload] = useState<{
    path: string;
    content: Uint8Array;
  } | null>(null);
  const freshObjectUrl = useObjectURL(
    freshUpload && freshUpload.path === value ? freshUpload.content : null,
    undefined,
  );
  const treeObjectUrl = useMediaLibraryPreviewURL(value);
  const objectUrl = freshObjectUrl ?? treeObjectUrl;
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
              accept: "any",
              local: entryDirectory
                ? {
                    directory: `${entryDirectory}/assets`,
                    label: stringFormatter.format("thisEntryLabel"),
                  }
                : undefined,
            });
            onBlur();
            if (picked) {
              setFreshUpload({ path: picked.path, content: picked.content });
              props.onChange(picked.path);
            }
          }}
        >
          {stringFormatter.format("chooseFromLibraryAction")}
        </ActionButton>
        {value !== null && (
          <>
            <ActionButton
              prominence="low"
              onPress={() => {
                setFreshUpload(null);
                props.onChange(null);
                onBlur();
              }}
            >
              {stringFormatter.format("remove")}
            </ActionButton>
            {objectUrl && (
              <Button
                href={objectUrl}
                download={value.split("/").pop()}
                prominence="low"
              >
                {stringFormatter.format("downloadAction")}
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
            <Text UNSAFE_style={{ wordBreak: "break-all" }}>
              {value.split("/").pop()}
            </Text>
          </Flex>
        </Box>
      )}
      {(props.forceValidation || blurred) &&
        props.validation?.isRequired &&
        value === null && (
          <FieldMessage>
            {stringFormatter.format("fieldRequiredMessage", {
              label: props.label,
            })}
          </FieldMessage>
        )}
    </Flex>
  );
}
