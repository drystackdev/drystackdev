import { useMemo, useState } from "react";
import { Item } from "@react-stately/collections";
import { Combobox } from "@keystar/ui/combobox";
import { Button, ButtonGroup } from "@keystar/ui/button";
import { Dialog, useDialogContainer } from "@keystar/ui/dialog";
import { Content } from "@keystar/ui/slots";
import { Flex } from "@keystar/ui/layout";
import { Notice } from "@keystar/ui/notice";
import { Heading } from "@keystar/ui/typography";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../l10n";
import { useConfig } from "../shell/context";
import { useSlugsInCollection } from "../useSlugsInCollection";
import type { EntryRef } from "../path-utils";
import { REDIRECTS_SINGLETON_KEY } from "../../config";
import { listTopLevelContentFields } from "../../form/fields/content/is-content-field";
import { useReferencedContentHtml } from "./useReferencedContentHtml";
import type { ContentRefPick } from "./bridge";

type Source = {
  type: "singleton" | "collection";
  name: string;
  label: string;
  kindLabel: string;
};

function useCandidateSources(excludeRef: EntryRef | null): Source[] {
  const config = useConfig();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  return useMemo(() => {
    const singletons: Source[] = Object.entries(config.singletons ?? {})
      .filter(([name]) => name !== REDIRECTS_SINGLETON_KEY)
      .filter(
        ([name]) =>
          !(excludeRef?.type === "singleton" && excludeRef.name === name),
      )
      .filter(([, cfg]) => listTopLevelContentFields(cfg.schema).length > 0)
      .map(([name, cfg]) => ({
        type: "singleton" as const,
        name,
        label: cfg.label,
        kindLabel: stringFormatter.format("singleton"),
      }));
    const collections: Source[] = Object.entries(config.collections ?? {})
      .filter(([, cfg]) => listTopLevelContentFields(cfg.schema).length > 0)
      .map(([name, cfg]) => ({
        type: "collection" as const,
        name,
        label: cfg.label,
        kindLabel: stringFormatter.format("collection"),
      }));
    return [...singletons, ...collections];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, excludeRef?.type, excludeRef?.name, stringFormatter]);
}

// Only mounted once a collection is actually chosen - useSlugsInCollection
// reads config.collections![name] unconditionally, so calling it with a
// not-yet-chosen ("") name would throw. Keeping it in its own component that
// only renders once `collectionName` is real satisfies hooks rules for free.
function EntryCombobox(props: {
  collectionName: string;
  excludeSlug: string | undefined;
  value: string | null;
  onChange: (slug: string | null) => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const slugs = useSlugsInCollection(props.collectionName).filter(
    (slug) => slug !== props.excludeSlug,
  );
  const items = useMemo(() => slugs.map((slug) => ({ slug })), [slugs]);
  return (
    <Combobox
      label={stringFormatter.format("contentRefEntryLabel")}
      selectedKey={props.value}
      onSelectionChange={(key) => {
        props.onChange(typeof key === "string" ? key : null);
      }}
      defaultItems={items}
      width="auto"
    >
      {(item) => <Item key={item.slug}>{item.slug}</Item>}
    </Combobox>
  );
}

export function ContentRefPickerDialog(props: {
  excludeRef: EntryRef | null;
  onSubmit: (pick: ContentRefPick) => void;
}) {
  const { dismiss } = useDialogContainer();
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const sources = useCandidateSources(props.excludeRef);
  const config = useConfig();

  const [sourceKey, setSourceKey] = useState<string | null>(null);
  const [entrySlug, setEntrySlug] = useState<string | null>(null);
  const [selectedField, setSelectedField] = useState<string | null>(null);

  const selectedSource = sources.find(
    (s) => `${s.type}:${s.name}` === sourceKey,
  );

  const ref: EntryRef | null = useMemo(() => {
    if (!selectedSource) return null;
    if (selectedSource.type === "singleton") {
      return { type: "singleton", name: selectedSource.name };
    }
    if (!entrySlug) return null;
    return { type: "collection", name: selectedSource.name, slug: entrySlug };
  }, [selectedSource, entrySlug]);

  const candidateFields = useMemo(() => {
    if (!selectedSource) return [];
    const schema =
      selectedSource.type === "singleton"
        ? config.singletons?.[selectedSource.name]?.schema
        : config.collections?.[selectedSource.name]?.schema;
    return schema ? listTopLevelContentFields(schema) : [];
  }, [config, selectedSource]);

  const field =
    candidateFields.length === 1 ? candidateFields[0] : selectedField;

  const htmlState = useReferencedContentHtml(ref, field);
  const alreadyImported =
    htmlState.status === "ready" &&
    htmlState.html.includes("data-ref-content=");

  const canConfirm =
    !!ref && !!field && htmlState.status === "ready" && !alreadyImported;

  return (
    <Dialog size="medium">
      <Heading>{stringFormatter.format("contentRefButtonLabel")}</Heading>
      <Content>
        <Flex gap="large" direction="column">
          {sources.length === 0 ? (
            <Notice tone="caution">
              {stringFormatter.format("contentRefNoSources")}
            </Notice>
          ) : (
            <>
              <Combobox
                label={stringFormatter.format("contentRefSourceLabel")}
                selectedKey={sourceKey}
                onSelectionChange={(key) => {
                  setSourceKey(typeof key === "string" ? key : null);
                  setEntrySlug(null);
                  setSelectedField(null);
                }}
                defaultItems={sources}
                width="auto"
              >
                {(item) => (
                  <Item key={`${item.type}:${item.name}`}>
                    {`${item.kindLabel} - ${item.label}`}
                  </Item>
                )}
              </Combobox>
              {selectedSource?.type === "collection" && (
                <EntryCombobox
                  key={selectedSource.name}
                  collectionName={selectedSource.name}
                  excludeSlug={
                    props.excludeRef?.type === "collection" &&
                    props.excludeRef.name === selectedSource.name
                      ? props.excludeRef.slug
                      : undefined
                  }
                  value={entrySlug}
                  onChange={(slug) => {
                    setEntrySlug(slug);
                    setSelectedField(null);
                  }}
                />
              )}
              {ref && candidateFields.length > 1 && (
                <Combobox
                  label={stringFormatter.format("contentRefFieldLabel")}
                  selectedKey={selectedField}
                  onSelectionChange={(key) => {
                    setSelectedField(typeof key === "string" ? key : null);
                  }}
                  defaultItems={candidateFields.map((name) => ({ name }))}
                  width="auto"
                >
                  {(item) => <Item key={item.name}>{item.name}</Item>}
                </Combobox>
              )}
              {alreadyImported && (
                <Notice tone="critical">
                  {stringFormatter.format("contentRefAlreadyImported")}
                </Notice>
              )}
            </>
          )}
        </Flex>
      </Content>
      <ButtonGroup>
        <Button onPress={dismiss}>{stringFormatter.format("cancel")}</Button>
        <Button
          prominence="high"
          isDisabled={!canConfirm}
          onPress={() => {
            if (!ref || !field) return;
            // Don't call `dismiss()` here - it triggers the same `onDismiss`
            // the host resolves the pending pick with `undefined` from, which
            // would race with (and always beat) `onSubmit` below since a
            // promise's first resolution wins. Closing happens as a side
            // effect of `onSubmit` once the host clears its pending request
            // (see FileManagerDialog.tsx for the same pattern).
            props.onSubmit({ ref, field });
          }}
        >
          {stringFormatter.format("save")}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}
