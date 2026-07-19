import { useContext, useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ActionButton } from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { css, tokenSchema } from "@keystar/ui/style";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";

import { PathContext } from "../../form/fields/text/path-slug-context";
import { describeField } from "../../api/ai/schema-to-yaml";
import { fieldMagicWriteIcon } from "../icons/fieldMagicWriteIcon";
import l10nMessages from "../l10n";
import { MagicWriteDialog } from "./MagicWriteDialog";
import { useAiStatus } from "./useAiStatus";
import { useFieldMagicWrite } from "./field-magic-write-context";

// The button floats over the field it writes - in the content pane, directly
// over the text being edited, with no popover behind it. Hence the blur: the
// circle has to stay legible without hiding what's underneath it. (The
// selection button doesn't share this: it sits inside an EditorPopover, which
// brings its own surface.)
const roundButton = css({
  borderRadius: "50%",
  // The default action button is a pill: wider than tall, with inline padding.
  // A circle needs the width pinned to the height and that padding gone.
  paddingInline: 0,
  minWidth: "unset",
  width: tokenSchema.size.element.regular,
  backgroundColor: `color-mix(in srgb, ${tokenSchema.color.background.canvas} 70%, transparent)`,
  backdropFilter: "blur(8px)",
  borderColor: tokenSchema.color.border.muted,
  boxShadow: `${tokenSchema.size.shadow.small} ${tokenSchema.color.shadow.muted}`,
});

/**
 * Per-field "write just this one" button, rendered next to a field's own
 * label. Everything else in the entry becomes context, so the model writes
 * something that fits what's already there.
 *
 * Only appears on top-level fields: the lock and the stream both key off the
 * top-level name, and a button on a nested item would suggest a granularity
 * the rest of the pipeline doesn't have.
 *
 * Content fields are excluded: their editor has its own AI button in the
 * toolbar (ContentToolbarAiButton), which also handles rewriting a selected
 * passage - a control this one has no notion of.
 */
export function FieldMagicWriteButton() {
  const ctx = useFieldMagicWrite();
  const path = useContext(PathContext);
  const status = useAiStatus();
  const [isOpen, setOpen] = useState(false);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  if (!ctx) return null;
  if (path.length !== 1) return null;
  const key = path[0];
  if (typeof key !== "string") return null;

  const schema = ctx.schema[key];
  if (!schema) return null;
  // Unsupported kinds (image, file, relationship) have no spec at all - no
  // button rather than one that would fail.
  const spec = describeField(key, schema);
  if (!spec) return null;
  if (spec.kind === "content") return null;
  if (status?.configured === false) return null;
  // Mid-stream the field is inert; offering to restart it would race the
  // write already in flight.
  if (ctx.magicWrite.status === "streaming") return null;

  return (
    <>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label={stringFormatter.format("aiMagicWriteForField")}
          onPress={() => setOpen(true)}
          UNSAFE_className={roundButton}
        >
          <Icon src={fieldMagicWriteIcon} />
        </ActionButton>
        <Tooltip>{stringFormatter.format("aiWriteJustThisField")}</Tooltip>
      </TooltipTrigger>
      <DialogContainer onDismiss={() => setOpen(false)}>
        {isOpen && (
          <MagicWriteDialog
            entryLabel={ctx.entryLabel}
            schema={ctx.schema}
            state={ctx.state}
            singleFieldKey={key}
            onDismiss={() => setOpen(false)}
            onGenerate={(request) => {
              setOpen(false);
              ctx.magicWrite.start(request);
            }}
          />
        )}
      </DialogContainer>
    </>
  );
}
