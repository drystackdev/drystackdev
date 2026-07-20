import { useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import {
  ActionButton,
  Button,
  actionButtonClassList,
} from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { Flex } from "@keystar/ui/layout";
import { ProgressCircle } from "@keystar/ui/progress";
import {
  breakpointQueries,
  classNames,
  css,
  useMediaQuery,
} from "@keystar/ui/style";
import { Text } from "@keystar/ui/typography";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";

import type { Config } from "../../config";
import type { ComponentSchema } from "../../form/api";
import { aiGradientSweep } from "../icons/ai-gradient";
import { magicWriteIcon } from "../icons/magicWriteIcon";
import l10nMessages from "../l10n";
import { localizeAiConfigError } from "./ai-config-error-message";
import { MagicWriteDialog } from "./MagicWriteDialog";
import type { useMagicWrite } from "./useMagicWrite";
import { useAiStatus } from "./useAiStatus";

// Without the label there's nothing for the button's inline padding to sit
// beside, and it stretches into a lozenge. At zero the button falls back to its
// square minimum, which the pill radius then rounds into a circle. `padding`
// isn't a style prop on ActionButton, so this has to go through the class.
const iconOnlyStyle = css({ paddingInline: 0 });

// Thin enough to read as a border rather than a frame - the ring is the same
// gradient as the glyph, and at any real width the button starts competing
// with the icon it's meant to be introducing.
const RING_WIDTH = "1.5px";

const textSelector = actionButtonClassList.selector("text", "descendant");

// react-aria gives a <button> the `disabled` attribute and an <a> (this button
// is never one, but the styles are cheap) `aria-disabled`. AiGlyph matches on
// both for the same reason.
const disabledSelectors = '&:disabled, &[aria-disabled="true"]';

/**
 * The Magic write button wears the AI gradient on its border and its label, so
 * it reads as the same feature as the animated glyph inside it.
 */
const gradientStyle = css({
  position: "relative",
  // The ring is the pseudo-element below; the button's real border would
  // otherwise sit outside it and show through as a grey outline.
  borderColor: "transparent",

  // A masked ring, rather than the usual padding-box/border-box background
  // trick: that one has to punch the middle out with a solid colour, and this
  // button sits on the entry header at one breakpoint and a toolbar at
  // another - there's no single colour that's right in both.
  "&::before": {
    ...aiGradientSweep,
    content: '""',
    position: "absolute",
    inset: 0,
    borderRadius: "inherit",
    padding: RING_WIDTH,
    // Decoration only - the button underneath still owns every event.
    pointerEvents: "none",
    // Paint the whole box, then subtract the content box, leaving the padding
    // ring. Both boxes are rounded by `border-radius`, so the ring is too.
    WebkitMask:
      "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    WebkitMaskComposite: "xor",
    mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    maskComposite: "exclude",
  },

  [textSelector]: {
    ...aiGradientSweep,
    backgroundClip: "text",
    WebkitBackgroundClip: "text",
    // `color` alone leaves the text opaque in Safari, which paints the fill
    // from `-webkit-text-fill-color` when it's set at all.
    color: "transparent",
    WebkitTextFillColor: "transparent",
  },

  // Disabled means inert, colour cycling included: a button whose whole point
  // is looking unavailable shouldn't be the liveliest thing on screen.
  [disabledSelectors]: {
    "&::before": { display: "none" },
    [textSelector]: {
      backgroundImage: "none",
      animation: "none",
      color: "inherit",
      WebkitTextFillColor: "currentColor",
    },
  },
});

/**
 * Whether this entry is opted into AI generation. A key absent from
 * `ai.for` has no button at all - the route enforces the same rule, so this
 * is only about not offering what won't work.
 */
export function useAiEntryDescription(
  config: Config,
  entryKey: string,
): string | undefined {
  const forMap = config.ai?.for as Record<string, string> | undefined;
  return forMap?.[entryKey];
}

export function MagicWriteButton(props: {
  entryLabel: string;
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
  magicWrite: ReturnType<typeof useMagicWrite>;
}) {
  const { magicWrite } = props;
  const [isOpen, setOpen] = useState(false);
  const status = useAiStatus();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const isBelowTablet = useMediaQuery(breakpointQueries.below.tablet);

  if (magicWrite.status === "streaming") {
    return (
      <Flex alignItems="center" gap="regular">
        <ProgressCircle
          aria-label={stringFormatter.format("aiGeneratingContent")}
          isIndeterminate
          size="small"
        />
        <Button onPress={magicWrite.abort}>
          {stringFormatter.format("aiStop")}
        </Button>
      </Flex>
    );
  }

  // Shown-but-disabled rather than hidden: a button that quietly vanishes
  // when a key is missing leaves the user with no idea why.
  const isDisabled = status?.configured === false;

  const label = stringFormatter.format("aiMagicWrite");

  return (
    <>
      <TooltipTrigger>
        <ActionButton
          aria-label={label}
          UNSAFE_className={classNames(
            gradientStyle,
            isBelowTablet && iconOnlyStyle,
          )}
          UNSAFE_style={{ borderRadius: 50 }}
          isDisabled={isDisabled}
          onPress={() => setOpen(true)}
        >
          <Icon src={magicWriteIcon} />
          {!isBelowTablet && <Text>{label}</Text>}
        </ActionButton>
        <Tooltip>
          {isDisabled
            ? localizeAiConfigError(stringFormatter, status)
            : stringFormatter.format("aiWriteForSelectedFields")}
        </Tooltip>
      </TooltipTrigger>
      <DialogContainer onDismiss={() => setOpen(false)}>
        {isOpen && (
          <MagicWriteDialog
            entryLabel={props.entryLabel}
            schema={props.schema}
            state={props.state}
            onDismiss={() => setOpen(false)}
            onGenerate={(request) => {
              // Closing first puts the form back in view, which is the whole
              // point of streaming into it rather than into a preview pane.
              setOpen(false);
              magicWrite.start(request);
            }}
          />
        )}
      </DialogContainer>
    </>
  );
}
