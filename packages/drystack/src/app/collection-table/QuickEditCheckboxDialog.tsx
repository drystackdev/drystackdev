import { useMemo } from "react";
import { AlertDialog } from "@keystar/ui/dialog";
import { ProgressCircle } from "@keystar/ui/progress";
import { Flex } from "@keystar/ui/layout";
import { Text } from "@keystar/ui/typography";
import { toastQueue } from "@keystar/ui/toast";

import { Config } from "../../config";
import { ComponentSchema } from "../../form/api";
import { useItemData } from "../useItemData";
import { useUpsertItem } from "../updating";
import { getCollectionFormat, getCollectionItemPath } from "../utils";

export type PendingCheckboxEdit = {
  itemSlug: string;
  fieldKey: string;
  fieldLabel: string;
  nextValue: boolean;
};

// mounted only while a checkbox quick-edit confirm is open, so the full
// (uncut) entry - including its content field - is only fetched on demand,
// unlike the table's own lightweight per-row parse (see parseEntryForTable
// in CollectionPage.tsx) which deliberately skips content for speed
export function QuickEditCheckboxDialog(props: {
  config: Config;
  collectionKey: string;
  schema: Record<string, ComponentSchema>;
  slugField: string;
  edit: PendingCheckboxEdit;
  onDone: () => void;
}) {
  const { config, collectionKey, schema, slugField, edit } = props;
  const dirpath = getCollectionItemPath(config, collectionKey, edit.itemSlug);

  // `format` and `slug` must keep a stable identity across renders: they feed
  // useItemData's useCallback deps, and a fresh object each render makes the
  // memoized loader recompute every render. Once the entry's blobs are cached
  // (so parseEntry runs synchronously) that loops via useData's
  // setState-during-render - the "Too many re-renders" crash. Mirror ItemPage,
  // which memoizes both for exactly this reason.
  const format = useMemo(
    () => getCollectionFormat(config, collectionKey),
    [config, collectionKey],
  );
  const slug = useMemo(
    () => ({ slug: edit.itemSlug, field: slugField }),
    [edit.itemSlug, slugField],
  );

  const itemData = useItemData({
    config,
    schema,
    dirpath,
    format,
    slug,
  });

  const loaded =
    itemData.kind === "loaded" && itemData.data !== "not-found"
      ? itemData.data
      : undefined;

  const state = loaded
    ? { ...loaded.initialState, [edit.fieldKey]: edit.nextValue }
    : undefined;

  const [updateResult, onUpdate] = useUpsertItem({
    state,
    initialFiles: loaded?.initialFiles,
    schema,
    config,
    format,
    currentLocalTreeKey: loaded?.localTreeKey,
    basePath: dirpath,
    slug: { value: edit.itemSlug, field: slugField },
  });

  return (
    <AlertDialog
      title={`Update ${edit.fieldLabel}`}
      cancelLabel="Cancel"
      primaryActionLabel="Confirm"
      isPrimaryActionDisabled={!state || updateResult.kind === "loading"}
      onCancel={props.onDone}
      onPrimaryAction={async () => {
        const ok = await onUpdate();
        if (ok) {
          toastQueue.positive(`${edit.fieldLabel} updated`);
        } else {
          toastQueue.critical(
            `Could not update ${edit.fieldLabel} - open the item to edit it directly.`,
          );
        }
        props.onDone();
      }}
    >
      <Flex direction="column" gap="regular">
        <Text>
          Set <Text weight="medium">{edit.fieldLabel}</Text> to{" "}
          <Text weight="medium">{edit.nextValue ? "On" : "Off"}</Text> for “
          {edit.itemSlug}”?
        </Text>
        {!state && (
          <ProgressCircle
            aria-label="Loading entry"
            isIndeterminate
            size="small"
          />
        )}
        {itemData.kind === "loaded" && itemData.data === "not-found" && (
          <Text color="critical">Entry could not be found.</Text>
        )}
      </Flex>
    </AlertDialog>
  );
}
