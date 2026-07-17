import { useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog } from "@keystar/ui/dialog";
import { Flex } from "@keystar/ui/layout";
import { Content } from "@keystar/ui/slots";
import { css, tokenSchema } from "@keystar/ui/style";
import { TextArea } from "@keystar/ui/text-field";
import { Heading, Text } from "@keystar/ui/typography";

import l10nMessages from "../l10n";
import { AiModelPicker } from "./AiModelPicker";

// Long enough to recognise the passage, short enough that the dialog doesn't
// become a second editor. The user can see the real thing behind the dialog.
const PREVIEW_CHARS = 300;

const passagePreview = css({
  backgroundColor: tokenSchema.color.background.surfaceSecondary,
  border: `${tokenSchema.size.border.regular} solid ${tokenSchema.color.border.muted}`,
  borderRadius: tokenSchema.size.radius.small,
  padding: tokenSchema.size.space.regular,
  maxHeight: tokenSchema.size.scale[1600],
  overflowY: "auto",
});

/**
 * Asks what to do with the passage the user selected.
 *
 * Deliberately not `MagicWriteDialog` with another mode: that dialog is built
 * around picking fields and a length preset, and a rewrite has neither. The
 * field is already decided by where the selection is, and the length follows
 * from the passage and the instruction.
 */
export function RewriteSelectionDialog(props: {
  /** the selected passage as plain text, for the preview */
  passage: string;
  onDismiss: () => void;
  onSubmit: (description: string) => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [description, setDescription] = useState("");

  const submit = () => props.onSubmit(description);

  const preview =
    props.passage.length > PREVIEW_CHARS
      ? `${props.passage.slice(0, PREVIEW_CHARS)}…`
      : props.passage;

  return (
    <Dialog>
      <Heading>{stringFormatter.format("aiRewriteTitle")}</Heading>
      <Content>
        <form
          style={{ display: "contents" }}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="large">
            <Flex direction="column" gap="regular">
              <Text weight="semibold">
                {stringFormatter.format("aiRewriteSelectedPassage")}
              </Text>
              <div className={passagePreview}>
                <Text size="small" color="neutralSecondary">
                  {preview}
                </Text>
              </div>
            </Flex>

            <TextArea
              label={stringFormatter.format("aiRewriteInstructionLabel")}
              description={stringFormatter.format("aiRewriteInstructionHelp")}
              value={description}
              onChange={setDescription}
              autoFocus
              height="scale.1600"
            />

            <AiModelPicker />
          </Flex>
        </form>
      </Content>
      <ButtonGroup>
        <Button onPress={props.onDismiss}>
          {stringFormatter.format("cancel")}
        </Button>
        <Button prominence="high" onPress={submit}>
          {stringFormatter.format("create")}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
