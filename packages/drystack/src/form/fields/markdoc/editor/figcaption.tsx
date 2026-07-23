import { useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../app/l10n";
import { ActionButton, Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog, DialogContainer, useDialogContainer } from "@keystar/ui/dialog";
import { Content } from "@keystar/ui/slots";
import { css, tokenSchema } from "@keystar/ui/style";
import { TextField } from "@keystar/ui/text-field";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Heading } from "@keystar/ui/typography";

// Admin-only skin for a node's `<figcaption>` (image/table/grid, all edited
// through their own popover's "Caption" field - see popovers/images.tsx,
// popovers/grid.tsx, popovers/table.tsx). On a host page (see
// createEditorSchema's `hostTypography`) this is deliberately left unstyled:
// the published `<figcaption>` carries none of this, so imposing it here
// would make the caption visibly reflow the moment edit mode turned on -
// whatever `.rich-content figcaption` the page already defines is what's
// right there (see global.css).
export const figcaptionClass = css({
  display: "block",
  marginTop: "0.5rem",
  fontSize: tokenSchema.typography.text.small.size,
  fontStyle: "italic",
  color: tokenSchema.color.foreground.neutralTertiary,
  textAlign: "center",
});

// Read-only display of a node's caption attr - editing happens through
// `CaptionButton` below, not here. Renders nothing for an empty caption,
// matching how the HTML serializer only emits a `<figure>` wrapper at all
// when there's a caption to put in it (see html/serialize.ts).
export function Figcaption(props: { text: string; hostTypography: boolean }) {
  if (!props.text) return null;
  return (
    <figcaption
      contentEditable={false}
      className={props.hostTypography ? undefined : figcaptionClass}
    >
      {props.text}
    </figcaption>
  );
}

// Not in @keystar/ui's bundled (Tabler-derived) icon set, so drawn directly
// rather than through <Icon> - that wrapper assumes a 24×24 stroke-only
// glyph, but this one (a note with a pencil corner) is a filled shape, same
// convention as popovers/grid.tsx's `GridSettingsIcon`.
function CaptionIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M0 0h24v24H0z" fill="none" />
      <path
        fill="currentColor"
        d="m20 15l2-2v5a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h13l-2 2H4v12h16zm2.44-8.56l-.88-.88a1.5 1.5 0 0 0-2.12 0L12 13v2H6v2h9v-1l7.44-7.44a1.5 1.5 0 0 0 0-2.12"
      />
    </svg>
  );
}

// The dedicated caption dialog opened by `CaptionButton` - same
// Dialog/form/submit shape as popovers/images.tsx's `ImageDialog` (a
// deliberate, explicit Save/Cancel moment, rather than committing on every
// keystroke like a toolbar field would).
function CaptionDialog(props: {
  title: string;
  caption: string;
  onSubmit: (caption: string) => void;
}) {
  const [caption, setCaption] = useState(props.caption);
  const { dismiss } = useDialogContainer();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <Dialog size="small">
      <form
        style={{ display: "contents" }}
        onSubmit={(event) => {
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          dismiss();
          props.onSubmit(caption);
        }}
      >
        <Heading>{props.title}</Heading>
        <Content>
          <TextField
            label={props.title}
            autoFocus
            value={caption}
            onChange={setCaption}
          />
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

// The single "add/edit caption" entry point shared by the image, table, and
// grid popovers - a dedicated button (rather than a field folded into an
// existing settings surface) so all three nodes get the same discoverable
// affordance regardless of how different their other popover controls are.
// `subject` names what's being captioned ("Image caption"/"Table
// caption"/"Grid caption") rather than a bare "Caption" - once a merged
// popover (see popovers/index.tsx's mergeable-ancestor layers) can show an
// image's, a table's, and a grid's caption button side by side, a generic
// label no longer says which one is which.
export function CaptionButton(props: {
  caption: string;
  subject: string;
  onSubmit: (caption: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label={props.subject}
          onPress={() => setIsOpen(true)}
        >
          <CaptionIcon />
        </ActionButton>
        <Tooltip>{props.subject}</Tooltip>
      </TooltipTrigger>
      <DialogContainer onDismiss={() => setIsOpen(false)}>
        {isOpen && (
          <CaptionDialog
            title={props.subject}
            caption={props.caption}
            onSubmit={(caption) => {
              props.onSubmit(caption);
              setIsOpen(false);
            }}
          />
        )}
      </DialogContainer>
    </>
  );
}
