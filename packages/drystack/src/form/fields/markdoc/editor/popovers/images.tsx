import { ButtonGroup, Button, ActionButton } from "@keystar/ui/button";
import {
  useDialogContainer,
  Dialog,
  DialogContainer,
} from "@keystar/ui/dialog";
import { Divider, Flex } from "@keystar/ui/layout";
import { NumberField } from "@keystar/ui/number-field";
import { Content } from "@keystar/ui/slots";
import { TextField } from "@keystar/ui/text-field";
import { Heading, Text } from "@keystar/ui/typography";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { useCallback, useMemo, useRef, useState } from "react";
import { clientSideValidateProp } from "../../../../errors";
import { FormValueContentFromPreviewProps } from "../../../../form-from-preview";
import { createGetPreviewProps } from "../../../../preview-props";
import l10nMessages from "../../../../../app/l10n";
import { Icon } from "@keystar/ui/icon";
import { alignCenterIcon } from "@keystar/ui/icon/icons/alignCenterIcon";
import { alignLeftIcon } from "@keystar/ui/icon/icons/alignLeftIcon";
import { alignRightIcon } from "@keystar/ui/icon/icons/alignRightIcon";
import { editIcon } from "@keystar/ui/icon/icons/editIcon";
import { fileUpIcon } from "#icons/fileUpIcon";
import { link2Icon } from "@keystar/ui/icon/icons/link2Icon";
import { link2OffIcon } from "@keystar/ui/icon/icons/link2OffIcon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";
import { ToggleButton } from "@keystar/ui/button";
import { openMediaLibrary } from "../../../../../app/media-library/bridge";
import { EditorState, NodeSelection } from "prosemirror-state";
import { useEditorDispatchCommand, useEditorSchema } from "../editor-view";
import { Node } from "prosemirror-model";
import { imageAttrsForPick, naturalRatioForPick } from "../image-pick";
import { ImageAlign } from "../image-layout";
import { useImageObjectUrl } from "../image-node-view";
import { useMediaScope } from "../media-scope";
import { CaptionButton } from "../figcaption";

const MIN_SIZE = 24;

export function ImagePopover(props: {
  node: Node;
  state: EditorState;
  pos: number;
}) {
  let stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const runCommand = useEditorDispatchCommand();
  const schema = useEditorSchema();
  const mediaScope = useMediaScope();
  const [dialogOpen, setDialogOpen] = useState(false);
  const align: ImageAlign | null = props.node.attrs.align;
  const lockAspectRatio: boolean = props.node.attrs.lockAspectRatio ?? true;
  const toggleAlign = (value: ImageAlign) => {
    runCommand((state, dispatch) => {
      if (dispatch) {
        dispatch(
          state.tr.setNodeAttribute(
            props.pos,
            "align",
            align === value ? null : value,
          ),
        );
      }
      return true;
    });
  };
  return (
    <>
      <Flex gap="regular" padding="regular">
        <Flex gap="small">
          <TooltipTrigger>
            <ToggleButton
              prominence="low"
              isSelected={align === "left"}
              aria-label={stringFormatter.format("imageFloatLeft")}
              onPress={() => toggleAlign("left")}
            >
              <Icon src={alignLeftIcon} />
            </ToggleButton>
            <Tooltip>{stringFormatter.format("imageFloatLeft")}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <ToggleButton
              prominence="low"
              isSelected={align === "center"}
              aria-label={stringFormatter.format("imageCenter")}
              onPress={() => toggleAlign("center")}
            >
              <Icon src={alignCenterIcon} />
            </ToggleButton>
            <Tooltip>{stringFormatter.format("imageCenter")}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <ToggleButton
              prominence="low"
              isSelected={align === "right"}
              aria-label={stringFormatter.format("imageFloatRight")}
              onPress={() => toggleAlign("right")}
            >
              <Icon src={alignRightIcon} />
            </ToggleButton>
            <Tooltip>{stringFormatter.format("imageFloatRight")}</Tooltip>
          </TooltipTrigger>
        </Flex>
        <Divider orientation="vertical" />
        <Flex gap="small">
          {schema.config.htmlLayout && (
            <TooltipTrigger>
              <ToggleButton
                prominence="low"
                isSelected={lockAspectRatio}
                aria-label={stringFormatter.format("imageLockAspectRatio")}
                onPress={() => {
                  runCommand((state, dispatch) => {
                    if (dispatch) {
                      dispatch(
                        state.tr.setNodeAttribute(
                          props.pos,
                          "lockAspectRatio",
                          !lockAspectRatio,
                        ),
                      );
                    }
                    return true;
                  });
                }}
              >
                <Icon src={lockAspectRatio ? link2Icon : link2OffIcon} />
              </ToggleButton>
              <Tooltip>{stringFormatter.format("imageLockAspectRatio")}</Tooltip>
            </TooltipTrigger>
          )}
          <TooltipTrigger>
            <ActionButton prominence="low" onPress={() => setDialogOpen(true)}>
              <Icon src={editIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("edit")}</Tooltip>
          </TooltipTrigger>
          <TooltipTrigger>
            <ActionButton
              prominence="low"
              onPress={async () => {
                const picked = await openMediaLibrary({
                  accept: "image",
                  local: mediaScope ?? undefined,
                });
                if (!picked || !schema.config.image) return;
                const { src, filename } = imageAttrsForPick(
                  picked,
                  schema.config.image.transformFilename,
                  schema.config.supportsMediaLibraryReferences,
                );
                // The node keeps the width/height it was given for the *old*
                // image, so a replacement with a different aspect ratio would
                // be squeezed into the previous one's box. With the ratio
                // locked, re-derive the height from the width that's staying
                // put - same rule the dialog's lock toggle applies
                // (`onLockToggle`). Only matters once an explicit width exists:
                // with none, the image lays out at its own size and there's
                // nothing to distort it.
                const width: number | null = props.node.attrs.width;
                let nextHeight: number | null = null;
                if (lockAspectRatio && width != null) {
                  const ratio = await naturalRatioForPick(picked);
                  if (ratio) nextHeight = Math.round(width / ratio);
                }
                runCommand((state, dispatch) => {
                  if (dispatch) {
                    const { tr } = state;
                    tr.setNodeAttribute(props.pos, "src", src);
                    tr.setNodeAttribute(props.pos, "filename", filename);
                    // The old image's URL, which is what `srcUrl` still holds,
                    // is now wrong for this node - and for a library reference
                    // (no bytes) it would be the only src the serializer sees.
                    tr.setNodeAttribute(props.pos, "srcUrl", "");
                    if (nextHeight != null) {
                      tr.setNodeAttribute(props.pos, "height", nextHeight);
                    }
                    const newState = state.apply(tr);
                    tr.setSelection(
                      NodeSelection.create(newState.doc, props.pos),
                    );
                    dispatch(tr);
                  }
                  return true;
                });
              }}
            >
              <Icon src={fileUpIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("imageChooseFromLibrary")}</Tooltip>
          </TooltipTrigger>
          <CaptionButton
            caption={props.node.attrs.caption}
            subject={stringFormatter.format("captionImage")}
            onSubmit={(caption) => {
              runCommand((state, dispatch) => {
                if (dispatch) {
                  dispatch(state.tr.setNodeAttribute(props.pos, "caption", caption));
                }
                return true;
              });
            }}
          />
        </Flex>
        <Divider orientation="vertical" />
        <TooltipTrigger>
          <ActionButton
            prominence="low"
            onPress={() => {
              runCommand((state, dispatch) => {
                if (dispatch) {
                  dispatch(
                    state.tr.delete(props.pos, props.pos + props.node.nodeSize),
                  );
                }
                return true;
              });
            }}
          >
            <Icon src={trash2Icon} />
          </ActionButton>
          <Tooltip tone="critical">{stringFormatter.format("remove")}</Tooltip>
        </TooltipTrigger>
      </Flex>
      <DialogContainer
        onDismiss={() => {
          setDialogOpen(false);
        }}
      >
        {dialogOpen && (
          <ImageDialog
            node={props.node}
            alt={props.node.attrs.alt}
            title={props.node.attrs.title}
            filename={props.node.attrs.filename}
            width={props.node.attrs.width}
            height={props.node.attrs.height}
            lockAspectRatio={lockAspectRatio}
            showLayoutFields={schema.config.htmlLayout}
            onSubmit={(value) => {
              runCommand((state, dispatch) => {
                if (dispatch) {
                  const { tr } = state;
                  tr.setNodeMarkup(props.pos, undefined, {
                    ...props.node.attrs,
                    ...value,
                  });
                  const newState = state.apply(tr);
                  tr.setSelection(
                    NodeSelection.create(newState.doc, props.pos),
                  );
                  dispatch(tr);
                }
                return true;
              });
              setDialogOpen(false);
            }}
          />
        )}
      </DialogContainer>
    </>
  );
}

function ImageDialog(props: {
  node: Node;
  alt: string;
  title: string;
  filename: string;
  width: number | null;
  height: number | null;
  lockAspectRatio: boolean;
  showLayoutFields: boolean;
  onSubmit: (value: {
    alt: string;
    filename: string;
    title: string;
    width?: number | null;
    height?: number | null;
    lockAspectRatio?: boolean;
  }) => void;
}) {
  const schema = useEditorSchema();
  const [state, setState] = useState({ alt: props.alt, title: props.title });
  const imagesSchema = useMemo(
    () => ({ kind: "object" as const, fields: schema.config.image!.schema }),
    [schema.config.image],
  );
  const previewProps = useMemo(
    () => createGetPreviewProps(imagesSchema, setState, () => undefined),
    [imagesSchema],
  )(state);

  const [filenameWithoutExtension, filenameExtension] = splitFilename(
    props.filename,
  );
  const [forceValidation, setForceValidation] = useState(false);
  let [fileName, setFileName] = useState(filenameWithoutExtension);
  let [fileNameTouched, setFileNameTouched] = useState(false);

  const [width, setWidth] = useState(props.width);
  const [height, setHeight] = useState(props.height);
  const [lockAspectRatio, setLockAspectRatio] = useState(props.lockAspectRatio);
  // measures the underlying image's natural size so the width/height fields
  // can keep it locked even before either field has ever been committed
  const objectUrl = useImageObjectUrl(props.node);
  const naturalRatioRef = useRef<number | null>(null);

  const ratioForField = useCallback(
    () => naturalRatioRef.current ?? (width && height ? width / height : null),
    [width, height],
  );

  const syncHeightFromWidth = useCallback(
    (w: number) => {
      const ratio = ratioForField();
      if (ratio) setHeight(Math.round(w / ratio));
    },
    [ratioForField],
  );

  const syncWidthFromHeight = useCallback(
    (h: number) => {
      const ratio = ratioForField();
      if (ratio) setWidth(Math.round(h * ratio));
    },
    [ratioForField],
  );

  const onWidthField = useCallback(
    (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const w = Math.round(value);
      setWidth(w);
      if (lockAspectRatio) syncHeightFromWidth(w);
    },
    [lockAspectRatio, syncHeightFromWidth],
  );

  const onHeightField = useCallback(
    (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const h = Math.round(value);
      setHeight(h);
      if (lockAspectRatio) syncWidthFromHeight(h);
    },
    [lockAspectRatio, syncWidthFromHeight],
  );

  const onLockToggle = useCallback(() => {
    const enabling = !lockAspectRatio;
    setLockAspectRatio(enabling);
    if (enabling && width) {
      syncHeightFromWidth(width);
    }
  }, [lockAspectRatio, width, syncHeightFromWidth]);

  let { dismiss } = useDialogContainer();
  let stringFormatter = useLocalizedStringFormatter(l10nMessages);

  return (
    <Dialog size="small">
      <form
        style={{ display: "contents" }}
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          setForceValidation(true);
          if (
            fileName &&
            clientSideValidateProp(imagesSchema, state, undefined)
          ) {
            dismiss();
            props.onSubmit({
              alt: state.alt,
              title: state.title,
              filename: [fileName, filenameExtension].join("."),
              ...(props.showLayoutFields
                ? { width, height, lockAspectRatio }
                : {}),
            });
          }
        }}
      >
        <Heading>{stringFormatter.format("imageDetailsTitle")}</Heading>
        <Content>
          <Flex gap="large" direction="column">
            <TextField
              label={stringFormatter.format("imageFileNameLabel")}
              onChange={setFileName}
              onBlur={() => setFileNameTouched(true)}
              value={fileName}
              isRequired
              errorMessage={
                (fileNameTouched || forceValidation) && !fileName
                  ? stringFormatter.format("imageFileNameRequired")
                  : undefined
              }
              endElement={
                filenameExtension ? (
                  <Flex
                    alignItems="center"
                    justifyContent="center"
                    paddingEnd="regular"
                  >
                    <Text color="neutralTertiary">.{filenameExtension}</Text>
                  </Flex>
                ) : null
              }
            />
            {props.showLayoutFields && (
              <Flex gap="regular" alignItems="end">
                <NumberField
                  label={stringFormatter.format("imageWidthLabel")}
                  minValue={MIN_SIZE}
                  step={1}
                  hideStepper
                  value={width ?? undefined}
                  onChange={onWidthField}
                />
                <NumberField
                  label={stringFormatter.format("imageHeightLabel")}
                  minValue={MIN_SIZE}
                  step={1}
                  hideStepper
                  value={height ?? undefined}
                  onChange={onHeightField}
                />
                <TooltipTrigger>
                  <ToggleButton
                    prominence="low"
                    isSelected={lockAspectRatio}
                    aria-label={stringFormatter.format("imageLockAspectRatio")}
                    onPress={onLockToggle}
                  >
                    <Icon src={lockAspectRatio ? link2Icon : link2OffIcon} />
                  </ToggleButton>
                  <Tooltip>{stringFormatter.format("imageLockAspectRatio")}</Tooltip>
                </TooltipTrigger>
              </Flex>
            )}
            <FormValueContentFromPreviewProps
              forceValidation={forceValidation}
              autoFocus
              {...previewProps}
            />
          </Flex>
        </Content>
        <ButtonGroup>
          <Button onPress={dismiss}>{stringFormatter.format("cancel")}</Button>
          <Button prominence="high" type="submit">
            {stringFormatter.format("save")}
          </Button>
        </ButtonGroup>
        {objectUrl && (
          <img
            src={objectUrl}
            alt=""
            style={{ display: "none" }}
            onLoad={(event) => {
              const img = event.currentTarget;
              if (img.naturalHeight) {
                naturalRatioRef.current = img.naturalWidth / img.naturalHeight;
              }
            }}
          />
        )}
      </form>
    </Dialog>
  );
}

function splitFilename(filename: string): [string, string] {
  const dotIndex = filename.lastIndexOf(".");
  if (dotIndex === -1) {
    return [filename, ""];
  }
  return [filename.substring(0, dotIndex), filename.substring(dotIndex + 1)];
}
