import { ButtonGroup, ActionButton } from "@keystar/ui/button";
import { FieldDescription, FieldLabel, FieldMessage } from "@keystar/ui/field";
import { Flex, Box } from "@keystar/ui/layout";
import { tokenSchema } from "@keystar/ui/style";

import { useState, useEffect, useReducer, useId } from "react";
import { FormFieldInputProps } from "../../api";
import { openMediaLibrary } from "../../../app/media-library/bridge";
import { useMediaLibraryPreviewURL } from "../../../app/media-library/useMediaLibraryPreviewURL";
import { useEntryDirectoryContext } from "../../../app/entry-form";

export function getUploadedFileObject(
  accept: string,
): Promise<File | undefined> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.style.display = "none";
    input.accept = accept;
    input.onchange = () => {
      const file = input.files?.[0];
      if (file) {
        resolve(file);
      }
    };
    document.body.appendChild(input);
    input.click();
  });
}

export async function getUploadedFile(
  accept: string,
): Promise<{ content: Uint8Array; filename: string } | undefined> {
  const file = await getUploadedFileObject(accept);
  if (!file) return undefined;
  return {
    content: new Uint8Array(await file.arrayBuffer()),
    filename: file.name,
  };
}

export function getUploadedImage(): Promise<
  { content: Uint8Array; filename: string } | undefined
> {
  return getUploadedFile("image/*");
}

export function useObjectURL(
  data: Uint8Array | null,
  contentType: string | undefined,
) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (data) {
      const url = URL.createObjectURL(
        new Blob([data as Uint8Array<ArrayBuffer>], { type: contentType }),
      );
      setUrl(url);
      return () => URL.revokeObjectURL(url);
    } else {
      setUrl(null);
    }
  }, [contentType, data]);
  return url;
}

// TODO: button labels ("Choose from library", "Remove") need i18n support
export function ImageFieldInput(
  props: FormFieldInputProps<string | null> & {
    label: string;
    description: string | undefined;
    validation: { isRequired?: boolean } | undefined;
  },
) {
  const { value } = props;
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
            try {
              const picked = await openMediaLibrary({
                accept: "image",
                local: entryDirectory
                  ? {
                      directory: `${entryDirectory}/assets`,
                      label: "This entry",
                    }
                  : undefined,
              });
              onBlur();
              if (picked) {
                setFreshUpload({ path: picked.path, content: picked.content });
                props.onChange(picked.path);
              }
            } catch (err) {
              console.error("Failed to pick image:", err);
              onBlur();
            }
          }}
        >
          Choose from library
        </ActionButton>
        {value !== null && (
          <ActionButton
            prominence="low"
            onPress={() => {
              setFreshUpload(null);
              props.onChange(null);
              onBlur();
            }}
          >
            Remove
          </ActionButton>
        )}
      </ButtonGroup>
      {objectUrl && (
        <Box
          alignSelf="start"
          backgroundColor="canvas"
          borderRadius="regular"
          border="neutral"
          padding="regular"
        >
          <img
            src={objectUrl}
            alt=""
            style={{
              display: "block",
              maxHeight: tokenSchema.size.alias.singleLineWidth,
              maxWidth: "100%",
            }}
          />
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
