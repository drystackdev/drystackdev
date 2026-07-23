import { Node } from "prosemirror-model";
import { EditorState } from "prosemirror-state";
import { ActionButton } from "@keystar/ui/button";
import { Flex } from "@keystar/ui/layout";
import { Text } from "@keystar/ui/typography";
import { Icon } from "@keystar/ui/icon";
import { importIcon } from "@keystar/ui/icon/icons/importIcon";
import { trash2Icon } from "@keystar/ui/icon/icons/trash2Icon";
import { TooltipTrigger, Tooltip } from "@keystar/ui/tooltip";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../../../../../app/l10n";
import { useEditorDispatchCommand } from "../editor-view";
import { useConfig } from "../../../../../app/shell/context";
import { entryRefExists, resolveEntryRef } from "../../../../../app/path-utils";
import { editKey, parseEditKey } from "../../../../../app/edit-sync";
import { openContentRefPicker } from "../../../../../app/content-ref/bridge";
import { useContentRefScope } from "../content-ref-scope";

export function ContentRefPopover(props: {
  node: Node;
  state: EditorState;
  pos: number;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const runCommand = useEditorDispatchCommand();
  const config = useConfig();
  const currentEntryRef = useContentRefScope();
  const parsed = parseEditKey(props.node.attrs.ref as string);
  const label =
    parsed && entryRefExists(config, parsed)
      ? parsed.type === "singleton"
        ? `${resolveEntryRef(config, parsed).label} / ${parsed.field}`
        : `${resolveEntryRef(config, parsed).label} / ${parsed.slug} / ${parsed.field}`
      : stringFormatter.format("contentRefNotFound");

  return (
    <Flex gap="regular" padding="regular" alignItems="center">
      <Text>{label}</Text>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          onPress={() => {
            (async () => {
              const picked = await openContentRefPicker({
                excludeRef: currentEntryRef,
              });
              if (!picked) return;
              runCommand((state, dispatch) => {
                if (dispatch) {
                  dispatch(
                    state.tr.setNodeAttribute(
                      props.pos,
                      "ref",
                      editKey(picked.ref, picked.field),
                    ),
                  );
                }
                return true;
              });
            })();
          }}
        >
          <Icon src={importIcon} />
        </ActionButton>
        <Tooltip>{stringFormatter.format("contentRefButtonLabel")}</Tooltip>
      </TooltipTrigger>
      <TooltipTrigger>
        <ActionButton
          prominence="low"
          onPress={() => {
            runCommand((state, dispatch) => {
              if (dispatch) {
                dispatch(
                  state.tr.delete(props.pos, props.pos + props.node.nodeSize),
                );
              }
              return true;
            });
          }}
        >
          <Icon src={trash2Icon} />
        </ActionButton>
        <Tooltip tone="critical">{stringFormatter.format("remove")}</Tooltip>
      </TooltipTrigger>
    </Flex>
  );
}
