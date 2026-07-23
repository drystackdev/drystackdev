import { Icon } from "@keystar/ui/icon";
import { importIcon } from "@keystar/ui/icon/icons/importIcon";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Text } from "@keystar/ui/typography";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../app/l10n";
import { openContentRefPicker } from "../../../../app/content-ref/bridge";
import { useContentRefScope } from "./content-ref-scope";
import { getEditorSchema } from "./schema";
import { editKey } from "../../../../app/edit-sync";
import { ToolbarButton } from "./Toolbar";

/**
 * Toolbar button for "Import content" - opens the content-ref picker
 * (app/content-ref) and, once an entry/field is chosen, inserts a
 * `content_ref` atom node pointing at it. The current entry (read from
 * ContentRefScopeProvider, set up wherever this editor is mounted - the
 * admin's DocumentFieldInput or VEI's InlineDocumentEditor) is excluded from
 * the picker so an entry can never import its own content field.
 */
export function ContentRefToolbarButton() {
  const currentEntryRef = useContentRefScope();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return (
    <TooltipTrigger>
      <ToolbarButton
        aria-label={stringFormatter.format("contentRefButtonLabel")}
        command={(_, dispatch, view) => {
          if (dispatch && view) {
            (async () => {
              const picked = await openContentRefPicker({
                excludeRef: currentEntryRef,
              });
              const schema = getEditorSchema(view.state.schema);
              if (!picked || !schema.nodes.content_ref) return;
              view.dispatch(
                view.state.tr.replaceSelectionWith(
                  schema.nodes.content_ref.createChecked({
                    ref: editKey(picked.ref, picked.field),
                  }),
                ),
              );
            })();
          }
          return true;
        }}
      >
        <Icon src={importIcon} />
      </ToolbarButton>
      <Tooltip>
        <Text>{stringFormatter.format("contentRefButtonLabel")}</Text>
      </Tooltip>
    </TooltipTrigger>
  );
}
