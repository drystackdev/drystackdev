import { useContext, useEffect, useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ActionButton } from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { ProgressCircle } from "@keystar/ui/progress";
import { toastQueue } from "@keystar/ui/toast";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { TextSelection } from "prosemirror-state";

import { describeField } from "../../api/ai/schema-to-yaml";
import {
  useEditorState,
  useEditorViewRef,
} from "../../form/fields/markdoc/editor/editor-view";
import { PathContext } from "../../form/fields/text/path-slug-context";
import { fieldMagicWriteIcon } from "../icons/fieldMagicWriteIcon";
import l10nMessages from "../l10n";
import { truncateToastMessage } from "../toast-message";
import { MagicWriteDialog } from "./MagicWriteDialog";
import { RewriteSelectionDialog } from "./RewriteSelectionDialog";
import { useAiStatus } from "./useAiStatus";
import { useFieldMagicWrite } from "./field-magic-write-context";
import { useRewriteSelection } from "./useRewriteSelection";

/**
 * The content editor's one AI entry point, living in the toolbar rather than
 * floating over the field (generate) or the selection (rewrite) - those two
 * used to be separate controls (FieldMagicWriteButton, SelectionRewriteButton)
 * that had to coordinate over which one was showing. A single button that
 * reads the current selection needs no such coordination: no selection opens
 * the whole-field generate dialog, a real selection opens the rewrite dialog.
 */
export function ContentToolbarAiButton() {
  const ctx = useFieldMagicWrite();
  const path = useContext(PathContext);
  const status = useAiStatus();
  const editorState = useEditorState();
  const viewRef = useEditorViewRef();
  const [magicOpen, setMagicOpen] = useState(false);
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const key = typeof path[0] === "string" ? path[0] : undefined;
  const selection = editorState.selection;
  const hasSelection = selection instanceof TextSelection && !selection.empty;

  const rewrite = useRewriteSelection({
    entry: ctx?.magicWrite.entry ?? { kind: "collection", key: "" },
    fieldKey: key ?? "",
    schema: ctx?.schema ?? {},
    state: ctx?.state ?? {},
  });

  const { error, clearError } = rewrite;
  useEffect(() => {
    if (!error) return;
    toastQueue.critical(truncateToastMessage(error), { timeout: 8000 });
    clearError();
  }, [error, clearError]);

  const isEligible =
    !!ctx &&
    !!key &&
    path.length === 1 &&
    describeField(key, ctx.schema[key] ?? ({} as any))?.kind === "content" &&
    status?.configured !== false;

  if (!isEligible) return null;

  // Mid whole-entry generate this field is about to be overwritten anyway
  // (matches the old FieldMagicWriteButton's guard); a passage rewrite has its
  // own independent status and stays available regardless.
  const isGenerateBusy = ctx.magicWrite.status === "streaming";
  const isRewriteBusy = rewrite.status === "streaming";
  const isBusy = isGenerateBusy || isRewriteBusy;

  const passage = viewRef.current
    ? viewRef.current.state.doc.textBetween(selection.from, selection.to, "\n\n")
    : "";

  const label = isRewriteBusy
    ? "aiStop"
    : hasSelection
      ? "aiRewriteSelection"
      : "aiWriteJustThisField";

  return (
    <>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          aria-label={stringFormatter.format(label)}
          isDisabled={isGenerateBusy && !isRewriteBusy}
          onPress={() => {
            if (isRewriteBusy) {
              rewrite.abort();
            } else if (hasSelection) {
              setRewriteOpen(true);
            } else {
              setMagicOpen(true);
            }
          }}
        >
          {isBusy ? (
            <ProgressCircle
              size="small"
              isIndeterminate
              aria-label={stringFormatter.format("aiRewriting")}
            />
          ) : (
            <Icon src={fieldMagicWriteIcon} />
          )}
        </ActionButton>
        <Tooltip>{stringFormatter.format(label)}</Tooltip>
      </TooltipTrigger>
      <DialogContainer onDismiss={() => setMagicOpen(false)}>
        {magicOpen && (
          <MagicWriteDialog
            entryLabel={ctx.entryLabel}
            schema={ctx.schema}
            state={ctx.state}
            singleFieldKey={key}
            onDismiss={() => setMagicOpen(false)}
            onGenerate={(request) => {
              setMagicOpen(false);
              ctx.magicWrite.start(request);
            }}
          />
        )}
      </DialogContainer>
      <DialogContainer onDismiss={() => setRewriteOpen(false)}>
        {rewriteOpen && (
          <RewriteSelectionDialog
            passage={passage}
            onDismiss={() => setRewriteOpen(false)}
            onSubmit={(description) => {
              setRewriteOpen(false);
              rewrite.start(description);
            }}
          />
        )}
      </DialogContainer>
    </>
  );
}
