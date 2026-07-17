import { useEffect, useMemo } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { Item, Picker } from "@keystar/ui/picker";
import { Text } from "@keystar/ui/typography";

import l10nMessages from "../l10n";
import { useAiModels } from "./useAiModels";

// A Picker key can't be undefined, and "" is a footgun in react-stately, so
// "follow the server's default" needs a name of its own on the wire.
const DEFAULT_KEY = "__default__";

/**
 * Picks which model writes.
 *
 * Renders nothing until there's a real choice to make: before the list lands,
 * and when the provider wouldn't give one. A picker with a single option, or
 * one that pops into existence half-filled, is worse than no picker - the
 * configured model is used either way.
 */
export function AiModelPicker() {
  const state = useAiModels();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const load = state?.load;
  useEffect(() => {
    load?.();
  }, [load]);

  const items = useMemo((): {
    key: string;
    name: string;
    description?: string;
  }[] => {
    if (!state) return [];
    return [
      {
        key: DEFAULT_KEY,
        // Naming the model it resolves to, because "default" on its own tells
        // the user nothing about what they're about to spend.
        name: state.serverDefault
          ? stringFormatter.format("aiModelDefault", {
              model: state.serverDefault,
            })
          : "",
      },
      // The id leads, not the vendor's display name: it's what goes on the
      // wire, what DRY_AI_MODEL is set to, and what tells two near-identical
      // names apart (gemini-flash-latest vs gemini-2.5-flash both read as
      // "Gemini Flash").
      ...state.models.map((model) => ({ key: model.id, name: model.id, description: model.label })),
    ];
  }, [state, stringFormatter]);

  if (!state || !state.models.length || !state.serverDefault) return null;

  return (
    <Picker
      label={stringFormatter.format("aiModel")}
      items={items}
      selectedKey={state.selected ?? DEFAULT_KEY}
      onSelectionChange={(key) => {
        state.setSelected(key === DEFAULT_KEY ? undefined : String(key));
      }}
      // Model ids are long, and a picker that truncates the thing it's naming
      // defeats the point.
      width="100%"
    >
      {(item) => (
        <Item key={item.key} textValue={item.name}>
          <Text truncate>{item.name}</Text>
          {item.description && (
            <Text slot="description">{item.description}</Text>
          )}
        </Item>
      )}
    </Picker>
  );
}
