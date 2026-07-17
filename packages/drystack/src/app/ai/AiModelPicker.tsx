import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { Item, Picker } from "@keystar/ui/picker";
import { toastQueue } from "@keystar/ui/toast";
import { Text } from "@keystar/ui/typography";

import l10nMessages from "../l10n";
import { useRouter } from "../router";
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
  const { basePath } = useRouter();
  const [isChecking, setChecking] = useState(false);
  // A pick made while an earlier check is still in flight wins; the stale
  // answer must not toast about a model the user has already moved off.
  const checkRef = useRef<AbortController | null>(null);

  const load = state?.load;
  useEffect(() => {
    load?.();
  }, [load]);
  useEffect(() => () => checkRef.current?.abort(), []);

  const dropModel = state?.dropModel;
  const setSelected = state?.setSelected;

  /**
   * Confirms the pick against the provider before the user spends a write on
   * it. The list can only say a model exists in the catalogue, not that this
   * key may call it, so the answer costs one real (1-token) request.
   */
  const verify = useCallback(
    async (model: string) => {
      checkRef.current?.abort();
      const controller = new AbortController();
      checkRef.current = controller;
      setChecking(true);
      try {
        const res = await fetch(`/api${basePath}/ai/models/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ model }),
          signal: controller.signal,
        });
        const data = await res.json().catch(() => undefined);
        if (data?.ok) return;

        if (data?.reason === "gone") {
          // Proven dead, not just unlucky: take it off the list and fall back,
          // so the same dead end isn't offered again.
          dropModel?.(model);
          setSelected?.(undefined);
          toastQueue.critical(
            stringFormatter.format("aiModelGone", { model }),
            { timeout: 8000 },
          );
          return;
        }
        // Rate limits and outages: the model is fine, the moment isn't. The
        // pick stands - the user may just want to wait.
        toastQueue.critical(
          data?.message ??
            data?.error ??
            stringFormatter.format("aiUnknownError"),
          { timeout: 8000 },
        );
      } catch (err) {
        if ((err as Error)?.name === "AbortError") return;
        // A failed check isn't a failed model; don't punish the pick for it.
      } finally {
        if (checkRef.current === controller) {
          checkRef.current = null;
          setChecking(false);
        }
      }
    },
    [basePath, dropModel, setSelected, stringFormatter],
  );

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
        const model = key === DEFAULT_KEY ? undefined : String(key);
        state.setSelected(model);
        // The default needs no check: it's whatever the server settles on, and
        // it re-settles (skipping known-dead models) on every request anyway.
        if (model) verify(model);
      }}
      isDisabled={isChecking}
      description={
        isChecking ? stringFormatter.format("aiModelChecking") : undefined
      }
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
