import { useContext, useEffect, useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ActionButton } from "@keystar/ui/button";
import { DialogContainer } from "@keystar/ui/dialog";
import { EditorPopover } from "@keystar/ui/editor";
import { Icon } from "@keystar/ui/icon";
import { Flex } from "@keystar/ui/layout";
import { ProgressCircle } from "@keystar/ui/progress";
import { toastQueue } from "@keystar/ui/toast";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { TextSelection } from "prosemirror-state";

import { describeField } from "../../api/ai/schema-to-yaml";
import { getAiRewriteRange } from "../../form/fields/markdoc/editor/ai-rewrite";
import {
  useEditorState,
  useEditorViewRef,
} from "../../form/fields/markdoc/editor/editor-view";
import { useEditorReferenceElement } from "../../form/fields/markdoc/editor/popovers/reference";
import { PathContext } from "../../form/fields/text/path-slug-context";
import { fieldMagicWriteIcon } from "../icons/fieldMagicWriteIcon";
import l10nMessages from "../l10n";
import { RewriteSelectionDialog } from "./RewriteSelectionDialog";
import { useContentSelectionStore } from "./content-selection-context";
import { useFieldMagicWrite } from "./field-magic-write-context";
import { useAiStatus } from "./useAiStatus";
import { useRewriteSelection } from "./useRewriteSelection";

/**
 * The "rewrite just this passage" button, floating at whatever the user has
 * selected inside a content editor.
 *
 * Mounted inside the editor rather than beside the field's label, because the
 * only thing that knows where the selection is - and that there is one - is
 * ProseMirror. The field's own button steps aside while this one is up
 * (see content-selection-context).
 */
export function SelectionRewriteButton() {
  const ctx = useFieldMagicWrite();
  const path = useContext(PathContext);
  const status = useAiStatus();
  const editorState = useEditorState();
  const store = useContentSelectionStore();
  const [isOpen, setOpen] = useState(false);
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const key = typeof path[0] === "string" ? path[0] : undefined;
  const selection = editorState.selection;
  const hasSelection =
    selection instanceof TextSelection && !selection.empty && path.length === 1;

  const viewRef = useEditorViewRef();

  const rewrite = useRewriteSelection({
    entry: ctx?.magicWrite.entry ?? { kind: "collection", key: "" },
    fieldKey: key ?? "",
    schema: ctx?.schema ?? {},
    state: ctx?.state ?? {},
  });

  // While the request is in flight the button belongs to the passage being
  // rewritten, not to wherever the caret has since wandered - so anchor to the
  // range the plugin is tracking, which moves with the text.
  const pending =
    rewrite.status === "streaming" ? getAiRewriteRange(editorState) : undefined;
  // Hooks can't hide behind the conditions below, and an unused reference
  // costs nothing.
  const reference = useEditorReferenceElement(
    pending?.from ?? selection.from,
    pending?.to ?? selection.to,
  );

  const isEligible =
    !!ctx &&
    !!key &&
    path.length === 1 &&
    // Unsupported kinds have no spec at all; only a content field can have a
    // passage rewritten inside it.
    describeField(key, ctx.schema[key] ?? ({} as any))?.kind === "content" &&
    status?.configured !== false &&
    // Mid-write the whole field is being replaced anyway; rewriting a passage
    // of a document that's about to be thrown away would race it.
    ctx.magicWrite.status !== "streaming";

  const isActive = isEligible && (hasSelection || rewrite.status === "streaming");

  // Tell the field's own button to stand down while this one is up.
  useEffect(() => {
    if (!store || !key) return;
    if (isActive) store.set(key);
    else store.clear(key);
  }, [store, key, isActive]);
  useEffect(() => {
    if (!store || !key) return;
    return () => store.clear(key);
  }, [store, key]);

  // A toast rather than a notice in the popover: by the time a rewrite fails
  // the popover may well be gone (the selection collapsed, the caret moved),
  // and the error would go with it.
  const { error, clearError } = rewrite;
  useEffect(() => {
    if (!error) return;
    toastQueue.critical(error, { timeout: 8000 });
    clearError();
  }, [error, clearError]);

  if (!isActive || !reference) return null;

  const isBusy = rewrite.status === "streaming";
  const passage = viewRef.current
    ? viewRef.current.state.doc.textBetween(selection.from, selection.to, "\n\n")
    : "";

  return (
    <>
      <EditorPopover
        reference={reference}
        boundary={viewRef.current?.dom}
        // Below is taken: a selection inside a heading already gets
        // HeadingPopover there (see popovers/index.tsx).
        placement="top"
        portal={false}
      >
        {/* Same shape as every other editor popover (see HeadingPopover): the
            popover itself is the surface, so the button inside needs no chrome
            of its own. A circle here would read as a different family of
            control to the toolbar sitting right above it. */}
        <Flex gap="regular" padding="regular">
          <TooltipTrigger>
            <ActionButton
              prominence="low"
              aria-label={stringFormatter.format(
                isBusy ? "aiStop" : "aiRewriteSelection",
              )}
              onPress={() => (isBusy ? rewrite.abort() : setOpen(true))}
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
            <Tooltip>
              {stringFormatter.format(
                isBusy ? "aiRewriting" : "aiRewriteSelection",
              )}
            </Tooltip>
          </TooltipTrigger>
        </Flex>
      </EditorPopover>
      <DialogContainer onDismiss={() => setOpen(false)}>
        {isOpen && (
          <RewriteSelectionDialog
            passage={passage}
            onDismiss={() => setOpen(false)}
            onSubmit={(description) => {
              setOpen(false);
              rewrite.start(description);
            }}
          />
        )}
      </DialogContainer>
    </>
  );
}
