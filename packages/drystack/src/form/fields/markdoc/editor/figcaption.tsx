import { useState } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../app/l10n";
import { ActionButton, Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog, DialogContainer, useDialogContainer } from "@keystar/ui/dialog";
import { Content } from "@keystar/ui/slots";
import { css, tokenSchema } from "@keystar/ui/style";
import { TextField } from "@keystar/ui/text-field";
import { Tooltip } from "@keystar/ui/tooltip";
import { ScrollDismissTooltipTrigger } from "./ScrollDismissTooltipTrigger";
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
// glyph, but this one (a speech bubble) is a filled shape, same convention
// as popovers/grid.tsx's `GridSettingsIcon`.
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
        fillRule="evenodd"
        clipRule="evenodd"
        d="M10.46 1.25h3.08c1.603 0 2.86 0 3.864.095c1.023.098 1.861.3 2.6.752a5.75 5.75 0 0 1 1.899 1.899c.452.738.654 1.577.752 2.6c.095 1.004.095 2.261.095 3.865v1.067c0 1.141 0 2.036-.05 2.759c-.05.735-.153 1.347-.388 1.913a5.75 5.75 0 0 1-3.112 3.112c-.805.334-1.721.408-2.977.43a11 11 0 0 0-.929.036c-.198.022-.275.054-.32.08c-.047.028-.112.078-.224.232c-.121.166-.258.396-.476.764l-.542.916c-.773 1.307-2.69 1.307-3.464 0l-.542-.916a11 11 0 0 0-.476-.764c-.112-.154-.177-.204-.224-.232c-.045-.026-.122-.058-.32-.08c-.212-.023-.49-.03-.93-.037c-1.255-.021-2.171-.095-2.976-.429A5.75 5.75 0 0 1 1.688 16.2c-.235-.566-.338-1.178-.389-1.913c-.049-.723-.049-1.618-.049-2.76v-1.066c0-1.604 0-2.86.095-3.865c.098-1.023.3-1.862.752-2.6a5.75 5.75 0 0 1 1.899-1.899c.738-.452 1.577-.654 2.6-.752C7.6 1.25 8.857 1.25 10.461 1.25M6.739 2.839c-.914.087-1.495.253-1.959.537A4.25 4.25 0 0 0 3.376 4.78c-.284.464-.45 1.045-.537 1.96c-.088.924-.089 2.11-.089 3.761v1c0 1.175 0 2.019.046 2.685c.045.659.131 1.089.278 1.441a4.25 4.25 0 0 0 2.3 2.3c.515.214 1.173.294 2.429.316h.031c.398.007.747.013 1.037.045c.311.035.616.104.909.274c.29.17.5.395.682.645c.169.232.342.525.538.856l.559.944a.52.52 0 0 0 .882 0l.559-.944c.196-.331.37-.624.538-.856c.182-.25.392-.476.682-.645c.293-.17.598-.24.909-.274c.29-.032.639-.038 1.037-.045h.032c1.255-.022 1.913-.102 2.428-.316a4.25 4.25 0 0 0 2.3-2.3c.147-.352.233-.782.278-1.441c.046-.666.046-1.51.046-2.685v-1c0-1.651 0-2.837-.089-3.762c-.087-.914-.253-1.495-.537-1.959a4.25 4.25 0 0 0-1.403-1.403c-.464-.284-1.045-.45-1.96-.537c-.924-.088-2.11-.089-3.761-.089h-3c-1.651 0-2.837 0-3.762.089M7.25 9A.75.75 0 0 1 8 8.25h8a.75.75 0 0 1 0 1.5H8A.75.75 0 0 1 7.25 9m0 3.5a.75.75 0 0 1 .75-.75h5.5a.75.75 0 0 1 0 1.5H8a.75.75 0 0 1-.75-.75"
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
      <ScrollDismissTooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label={props.subject}
          onPress={() => setIsOpen(true)}
        >
          <CaptionIcon />
        </ActionButton>
        <Tooltip>{props.subject}</Tooltip>
      </ScrollDismissTooltipTrigger>
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
