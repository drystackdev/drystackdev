import { ButtonGroup, Button, ActionButton } from "@keystar/ui/button";
import {
  useDialogContainer,
  Dialog,
  DialogContainer,
} from "@keystar/ui/dialog";
import { Divider, Flex } from "@keystar/ui/layout";
import { NumberField } from "@keystar/ui/number-field";
import { Content } from "@keystar/ui/slots";
import { TextArea } from "@keystar/ui/text-field";
import { Heading } from "@keystar/ui/typography";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { useCallback, useState } from "react";
import l10nMessages from "../../../../../app/l10n";
import { Icon } from "@keystar/ui/icon";
import { alignCenterIcon } from "@keystar/ui/icon/icons/alignCenterIcon";
import { alignLeftIcon } from "@keystar/ui/icon/icons/alignLeftIcon";
import { alignRightIcon } from "@keystar/ui/icon/icons/alignRightIcon";
import { editIcon } from "@keystar/ui/icon/icons/editIcon";
import { link2Icon } from "@keystar/ui/icon/icons/link2Icon";
import { link2OffIcon } from "@keystar/ui/icon/icons/link2OffIcon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { Tooltip } from "@keystar/ui/tooltip";
import { ScrollDismissTooltipTrigger } from "../ScrollDismissTooltipTrigger";
import { ToggleButton } from "@keystar/ui/button";
import { EditorState, NodeSelection } from "prosemirror-state";
import { useEditorDispatchCommand, useEditorSchema } from "../editor-view";
import { Node } from "prosemirror-model";
import { ImageAlign } from "../image-layout";
import { sanitizeSvgMarkup, svgNaturalRatio } from "../svg-markup";
import { MIN_SIZE } from "../resize-handles";
import { CaptionButton } from "../figcaption";

/**
 * The `svg` node's toolbar. Intentionally the image popover minus the two
 * controls that only make sense for bytes (replace-from-library, file name):
  * a drawing is aligned, sized, captioned and removed exactly like a picture,
 * because from the page's point of view it is one.
 */
export function SvgPopover(props: {
  node: Node;
  state: EditorState;
  pos: number;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const runCommand = useEditorDispatchCommand();
  const schema = useEditorSchema();
  const [dialogOpen, setDialogOpen] = useState(false);
  const align: ImageAlign | null = props.node.attrs.align;
  const lockAspectRatio: boolean = props.node.attrs.lockAspectRatio ?? true;

  const setAttribute = useCallback(
    (name: string, value: unknown) => {
      runCommand((state, dispatch) => {
        if (dispatch) {
          dispatch(state.tr.setNodeAttribute(props.pos, name, value));
        }
        return true;
      });
    },
    [runCommand, props.pos],
  );

  const toggleAlign = (value: ImageAlign) => {
    setAttribute("align", align === value ? null : value);
  };

  return (
    <>
      <Flex gap="regular" padding="regular">
        <Flex gap="small">
          <ScrollDismissTooltipTrigger>
            <ToggleButton
              prominence="low"
              isSelected={align === "left"}
              aria-label={stringFormatter.format("imageFloatLeft")}
              onPress={() => toggleAlign("left")}
            >
              <Icon src={alignLeftIcon} />
            </ToggleButton>
            <Tooltip>{stringFormatter.format("imageFloatLeft")}</Tooltip>
          </ScrollDismissTooltipTrigger>
          <ScrollDismissTooltipTrigger>
            <ToggleButton
              prominence="low"
              isSelected={align === "center"}
              aria-label={stringFormatter.format("imageCenter")}
              onPress={() => toggleAlign("center")}
            >
              <Icon src={alignCenterIcon} />
            </ToggleButton>
            <Tooltip>{stringFormatter.format("imageCenter")}</Tooltip>
          </ScrollDismissTooltipTrigger>
          <ScrollDismissTooltipTrigger>
            <ToggleButton
              prominence="low"
              isSelected={align === "right"}
              aria-label={stringFormatter.format("imageFloatRight")}
              onPress={() => toggleAlign("right")}
            >
              <Icon src={alignRightIcon} />
            </ToggleButton>
            <Tooltip>{stringFormatter.format("imageFloatRight")}</Tooltip>
          </ScrollDismissTooltipTrigger>
        </Flex>
        <Divider orientation="vertical" />
        <Flex gap="small">
          {schema.config.htmlLayout && (
            <ScrollDismissTooltipTrigger>
              <ToggleButton
                prominence="low"
                isSelected={lockAspectRatio}
                aria-label={stringFormatter.format("imageLockAspectRatio")}
                onPress={() =>
                  setAttribute("lockAspectRatio", !lockAspectRatio)
                }
              >
                <Icon src={lockAspectRatio ? link2Icon : link2OffIcon} />
              </ToggleButton>
              <Tooltip>
                {stringFormatter.format("imageLockAspectRatio")}
              </Tooltip>
            </ScrollDismissTooltipTrigger>
          )}
          <ScrollDismissTooltipTrigger>
            <ActionButton prominence="low" onPress={() => setDialogOpen(true)}>
              <Icon src={editIcon} />
            </ActionButton>
            <Tooltip>{stringFormatter.format("edit")}</Tooltip>
          </ScrollDismissTooltipTrigger>
          <CaptionButton
            caption={props.node.attrs.caption}
            subject={stringFormatter.format("captionSvg")}
            onSubmit={(caption) => setAttribute("caption", caption)}
          />
        </Flex>
        <Divider orientation="vertical" />
        <ScrollDismissTooltipTrigger>
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
        </ScrollDismissTooltipTrigger>
      </Flex>
      <DialogContainer onDismiss={() => setDialogOpen(false)}>
        {dialogOpen && (
          <SvgDialog
            markup={props.node.attrs.markup}
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

function SvgDialog(props: {
  markup: string;
  width: number | null;
  height: number | null;
  lockAspectRatio: boolean;
  showLayoutFields: boolean;
  onSubmit: (value: {
    markup: string;
    width?: number | null;
    height?: number | null;
    lockAspectRatio?: boolean;
  }) => void;
}) {
  const [markup, setMarkup] = useState(props.markup);
  const [forceValidation, setForceValidation] = useState(false);
  const [width, setWidth] = useState(props.width);
  const [height, setHeight] = useState(props.height);
  const [lockAspectRatio, setLockAspectRatio] = useState(props.lockAspectRatio);

  // Sanitizing on submit rather than on every keystroke: half-typed markup is
  // always invalid, so validating as you type would just mean a permanently
  // red field until the closing tag lands.
  const sanitized = forceValidation ? sanitizeSvgMarkup(markup) : null;

  const ratioForField = useCallback(
    () => svgNaturalRatio(markup) ?? (width && height ? width / height : null),
    [markup, width, height],
  );

  const onWidthField = useCallback(
    (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const w = Math.round(value);
      setWidth(w);
      const ratio = ratioForField();
      if (lockAspectRatio && ratio) setHeight(Math.round(w / ratio));
    },
    [lockAspectRatio, ratioForField],
  );

  const onHeightField = useCallback(
    (value: number) => {
      if (!Number.isFinite(value) || value <= 0) return;
      const h = Math.round(value);
      setHeight(h);
      const ratio = ratioForField();
      if (lockAspectRatio && ratio) setWidth(Math.round(h * ratio));
    },
    [lockAspectRatio, ratioForField],
  );

  const onLockToggle = useCallback(() => {
    const enabling = !lockAspectRatio;
    setLockAspectRatio(enabling);
    const ratio = ratioForField();
    if (enabling && width && ratio) setHeight(Math.round(width / ratio));
  }, [lockAspectRatio, width, ratioForField]);

  const { dismiss } = useDialogContainer();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  return (
    <Dialog size="medium">
      <form
        style={{ display: "contents" }}
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          setForceValidation(true);
          const clean = sanitizeSvgMarkup(markup);
          if (!clean) return;
          dismiss();
          props.onSubmit({
            // The stored value is what came back from the sanitizer, never the
            // raw text - the node's markup attr is injected into the page as
            // HTML, so the textarea is untrusted input like any other.
            markup: clean,
            ...(props.showLayoutFields
              ? { width, height, lockAspectRatio }
              : {}),
          });
        }}
      >
        <Heading>{stringFormatter.format("svgDetailsTitle")}</Heading>
        <Content>
          <Flex gap="large" direction="column">
            <TextArea
              label={stringFormatter.format("svgMarkupLabel")}
              value={markup}
              onChange={setMarkup}
              autoFocus
              // Markup is long and structural - the default two-or-three line
              // box makes anything past the opening tag guesswork.
              height="scale.3000"
              errorMessage={
                forceValidation && !sanitized
                  ? stringFormatter.format("svgMarkupInvalid")
                  : undefined
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
                <ScrollDismissTooltipTrigger>
                  <ToggleButton
                    prominence="low"
                    isSelected={lockAspectRatio}
                    aria-label={stringFormatter.format("imageLockAspectRatio")}
                    onPress={onLockToggle}
                  >
                    <Icon src={lockAspectRatio ? link2Icon : link2OffIcon} />
                  </ToggleButton>
                  <Tooltip>
                    {stringFormatter.format("imageLockAspectRatio")}
                  </Tooltip>
                </ScrollDismissTooltipTrigger>
              </Flex>
            )}
          </Flex>
        </Content>
        <ButtonGroup>
          <Button onPress={dismiss}>{stringFormatter.format("cancel")}</Button>
          <Button prominence="high" type="submit">
            {stringFormatter.format("save")}
          </Button>
        </ButtonGroup>
      </form>
    </Dialog>
  );
}
