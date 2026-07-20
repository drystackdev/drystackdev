import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ActionButton, ButtonGroup } from "@keystar/ui/button";
import { FieldDescription, FieldLabel, FieldMessage } from "@keystar/ui/field";
import { Icon } from "@keystar/ui/icon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { Box, Flex } from "@keystar/ui/layout";
import { tokenSchema } from "@keystar/ui/style";

import { useId, useReducer, useState } from "react";
import { FormFieldInputProps } from "../../api";
import { openMediaLibraryMulti } from "../../../app/media-library/bridge";
import { useMediaLibraryPreviewURL } from "../../../app/media-library/useMediaLibraryPreviewURL";
import { useInView } from "../../../app/file-manager/useInView";
import { useObjectURL } from "../image/ui";
import l10nMessages from "../../../app/l10n";

function ImageThumbnail(props: {
  path: string;
  freshContent: Uint8Array | undefined;
  onRemove: () => void;
}) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const freshObjectUrl = useObjectURL(props.freshContent ?? null, undefined);
  const treeObjectUrl = useMediaLibraryPreviewURL(
    props.path,
    undefined,
    inView,
  );
  const objectUrl = freshObjectUrl ?? treeObjectUrl;
  return (
    <Flex
      ref={ref}
      direction="column"
      gap="small"
      backgroundColor="canvas"
      borderRadius="regular"
      border="neutral"
      padding="regular"
      UNSAFE_style={{ width: 120 }}
    >
      <Box
        alignSelf="center"
        UNSAFE_style={{
          width: 96,
          height: 96,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {objectUrl && (
          <img
            src={objectUrl}
            alt=""
            style={{ display: "block", maxWidth: "100%", maxHeight: "100%" }}
          />
        )}
      </Box>
      <ActionButton prominence="low" onPress={props.onRemove}>
        <Icon src={trash2Icon} />
      </ActionButton>
    </Flex>
  );
}

export function ImagesFieldInput(
  props: FormFieldInputProps<string[]> & {
    label: string;
    description: string | undefined;
    validation: { isRequired?: boolean } | undefined;
  },
) {
  const { value } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [blurred, onBlur] = useReducer(() => true, false);
  // bytes for paths picked/uploaded this session, since a brand new pick
  // isn't in the tree yet - see useMediaLibraryPreviewURL's tree-sha lookup
  const [freshContent, setFreshContent] = useState<Map<string, Uint8Array>>(
    new Map(),
  );
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
        <Flex wrap gap="regular">
          {value.map((path, index) => (
            <ImageThumbnail
              key={`${index}-${path}`}
              path={path}
              freshContent={freshContent.get(path)}
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
            const picked = await openMediaLibraryMulti({ accept: "image" });
            onBlur();
            if (picked?.length) {
              setFreshContent((prev) => {
                const next = new Map(prev);
                for (const pick of picked) next.set(pick.path, pick.content);
                return next;
              });
              props.onChange([...value, ...picked.map((pick) => pick.path)]);
            }
          }}
        >
          {stringFormatter.format("chooseFromLibraryAction")}
        </ActionButton>
      </ButtonGroup>
      {(props.forceValidation || blurred) &&
        props.validation?.isRequired &&
        value.length === 0 && (
          <FieldMessage>
            {stringFormatter.format("fieldRequiredMessage", {
              label: props.label,
            })}
          </FieldMessage>
        )}
    </Flex>
  );
}
