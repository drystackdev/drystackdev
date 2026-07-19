import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog, useDialogContainer } from "@keystar/ui/dialog";
import { Content } from "@keystar/ui/slots";
import { css } from "@keystar/ui/style";
import { Heading, Text } from "@keystar/ui/typography";

import l10nMessages from "../l10n";
import { HighlightedText, MatchRange } from "./highlight";

const bodyStyle = css({
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
  lineHeight: 1.6,
});

// The plain text a fields.content() body was stripped down to for search
// (see htmlToSearchableText in CollectionPage.tsx) - only reachable via the
// content column's cell once "search content" has fetched it, so there's
// always a fullText by the time this opens.
export function ContentPreviewDialog(props: {
  label: string;
  text: string;
  matchIndices?: readonly MatchRange[];
}) {
  const { dismiss } = useDialogContainer();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <Dialog size="large" aria-label={props.label}>
      <Heading>{props.label}</Heading>
      <Content>
        <Text UNSAFE_className={bodyStyle}>
          <HighlightedText text={props.text} indices={props.matchIndices} />
        </Text>
      </Content>
      <ButtonGroup>
        <Button onPress={dismiss}>{stringFormatter.format("close")}</Button>
      </ButtonGroup>
    </Dialog>
  );
}
