import { useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ActionButton, Button } from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { Flex } from "@keystar/ui/layout";
import { ProgressCircle } from "@keystar/ui/progress";
import { breakpointQueries, useMediaQuery } from "@keystar/ui/style";
import { Text } from "@keystar/ui/typography";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";

import type { Config } from "../../config";
import type { ComponentSchema } from "../../form/api";
import { magicWriteIcon } from "../icons/magicWriteIcon";
import l10nMessages from "../l10n";
import { localizeAiConfigError } from "./ai-config-error-message";
import { MagicWriteDialog } from "./MagicWriteDialog";
import type { useMagicWrite } from "./useMagicWrite";
import { useAiStatus } from "./useAiStatus";

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
