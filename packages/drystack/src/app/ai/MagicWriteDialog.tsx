import { Fragment, type ReactNode, useMemo, useState } from "react";

import { useLocalizedStringFormatter } from "@react-aria/i18n";
import { ActionButton, Button, ButtonGroup } from "@keystar/ui/button";
import { Checkbox } from "@keystar/ui/checkbox";
import { Dialog } from "@keystar/ui/dialog";
import { Icon } from "@keystar/ui/icon";
import { chevronDownIcon } from "@keystar/ui/icon/icons/chevronDownIcon";
import { chevronRightIcon } from "@keystar/ui/icon/icons/chevronRightIcon";
import { Content } from "@keystar/ui/slots";
import { Flex } from "@keystar/ui/layout";
import { Notice } from "@keystar/ui/notice";
import { Item, Picker } from "@keystar/ui/picker";
import { Radio, RadioGroup } from "@keystar/ui/radio";
import { css, tokenSchema } from "@keystar/ui/style";
import { TextArea } from "@keystar/ui/text-field";
import { Tooltip, TooltipTrigger } from "@keystar/ui/tooltip";
import { Heading, Text } from "@keystar/ui/typography";

import type { ComponentSchema } from "../../form/api";
import { AiSize, SIZE_SPECS } from "../../api/ai/prompt";
import { AiFieldSpec, describeFields } from "../../api/ai/schema-to-yaml";
import l10nMessages from "../l10n";
import { AiModelPicker } from "./AiModelPicker";
import type { MagicWriteRequest } from "./useMagicWrite";
import {
  Column,
  canContinue,
  canPickSize,
  initialSelection,
  isContinuableKind,
} from "./field-columns";
import { fieldToContextText } from "./field-value-text";
import { seedYaml } from "./form-value-to-ai";

const SIZE_LABEL_KEYS: Record<AiSize, string> = {
  short: "aiSizeShort",
  medium: "aiSizeMedium",
  long: "aiSizeLong",
  xlong: "aiSizeXlong",
};

export function MagicWriteDialog(props: {
  entryLabel: string;
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
  /** when set, the dialog writes only this field and skips the field table */
  singleFieldKey?: string;
  onDismiss: () => void;
  onGenerate: (request: MagicWriteRequest) => void;
}) {
  const { schema, state, singleFieldKey } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  const specs = useMemo(() => describeFields(schema), [schema]);

  const [selection, setSelection] = useState<Record<string, Column>>(() =>
    initialSelection({ specs, schema, state, singleFieldKey }),
  );
  const [sizes, setSizes] = useState<Record<string, AiSize>>({});
  const [continueKeys, setContinueKeys] = useState<ReadonlySet<string>>(
    new Set(),
  );
  const [description, setDescription] = useState("");

  const fillSpecs = specs.filter((s) => selection[s.key] === "fill");

  const sizeFor = (key: string): AiSize => sizes[key] ?? "medium";

  const submit = () => {
    const context: Record<string, string> = {};
    for (const spec of specs) {
      if (selection[spec.key] !== "context") continue;
      const text = fieldToContextText(schema[spec.key], state[spec.key]);
      if (text) context[spec.key] = text;
    }

    const requestSizes: Record<string, AiSize> = {};
    const seeds: Record<string, string> = {};
    for (const spec of fillSpecs) {
      if (spec.kind === "content") requestSizes[spec.key] = sizeFor(spec.key);
      // Re-checked against the same rule the checkbox is enabled by: state can
      // have moved since it was ticked (a size change, an untick of `fill`),
      // and a seed for a field that's no longer eligible would be paid for in
      // tokens and ignored.
      if (
        continueKeys.has(spec.key) &&
        canContinue(spec, schema[spec.key], state[spec.key], "fill")
      ) {
        const yaml = seedYaml(spec, schema[spec.key], state[spec.key]);
        if (yaml) seeds[spec.key] = yaml;
      }
    }

    props.onGenerate({
      targets: fillSpecs.map((s) => s.key),
      context,
      description,
      sizes: requestSizes,
      seeds,
    });
  };

  // Single-field mode has no table, so anything the table would have offered
  // for the one target has to stand on its own.
  const singleSpec = singleFieldKey
    ? specs.find((s) => s.key === singleFieldKey)
    : undefined;
  const showSingleSize = singleSpec?.kind === "content";
  const showSingleContinue =
    !!singleSpec &&
    canContinue(singleSpec, schema[singleSpec.key], state[singleSpec.key], "fill");

  return (
    <Dialog>
      <Heading>
        {stringFormatter.format("magicWriteFor", { label: props.entryLabel })}
      </Heading>
      <Content>
        <form
          style={{ display: "contents" }}
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <Flex direction="column" gap="large">
            {specs.length === 0 && (
              <Notice tone="caution">
                <Text>{stringFormatter.format("aiNoFillableFields")}</Text>
              </Notice>
            )}

            {!singleFieldKey && specs.length > 0 && (
              <FieldTableDisclosure>
                <FieldTable
                  specs={specs}
                  schema={schema}
                  state={state}
                  selection={selection}
                  sizes={sizes}
                  continueKeys={continueKeys}
                  onSelectionChange={setSelection}
                  onSizesChange={setSizes}
                  onContinueChange={setContinueKeys}
                />
              </FieldTableDisclosure>
            )}

            <TextArea
              label={stringFormatter.format("aiDescriptionLabel")}
              description={stringFormatter.format("aiDescriptionHelp")}
              value={description}
              onChange={setDescription}
              autoFocus
              height="scale.1600"
            />

            {showSingleSize && (
              <RadioGroup
                label={stringFormatter.format("aiContentSize")}
                value={sizeFor(singleFieldKey!)}
                onChange={(value) =>
                  setSizes((prev) => ({
                    ...prev,
                    [singleFieldKey!]: value as AiSize,
                  }))
                }
                orientation="horizontal"
              >
                {(Object.keys(SIZE_SPECS) as AiSize[]).map((key) => (
                  <Radio key={key} value={key}>
                    {`${stringFormatter.format(SIZE_LABEL_KEYS[key])} (${SIZE_SPECS[key].words})`}
                  </Radio>
                ))}
              </RadioGroup>
            )}

            {showSingleContinue && (
              <Checkbox
                isSelected={continueKeys.has(singleFieldKey!)}
                onChange={(checked) =>
                  setContinueKeys(
                    toggle(continueKeys, singleFieldKey!, checked),
                  )
                }
              >
                <Text>{stringFormatter.format("aiContinueLabel")}</Text>
                <Text slot="description">
                  {stringFormatter.format("aiColContinueHelp")}
                </Text>
              </Checkbox>
            )}

            <AiModelPicker />
          </Flex>
        </form>
      </Content>
      <ButtonGroup>
        <Button onPress={props.onDismiss}>
          {stringFormatter.format("cancel")}
        </Button>
        <Button
          prominence="high"
          isDisabled={fillSpecs.length === 0}
          onPress={submit}
        >
          {stringFormatter.format("create")}
        </Button>
      </ButtonGroup>
    </Dialog>
  );
}

function toggle(
  set: ReadonlySet<string>,
  key: string,
  present: boolean,
): Set<string> {
  const next = new Set(set);
  if (present) next.add(key);
  else next.delete(key);
  return next;
}

// Collapse
// ----------------------------------------------------------------------------

const DISCLOSURE_STORAGE_KEY = "drystack-ai-fields-open";

function readDisclosureOpen(): boolean {
  try {
    return localStorage.getItem(DISCLOSURE_STORAGE_KEY) === "true";
  } catch {
    // Private mode, or storage disabled - the table still opens, the choice
    // just won't outlive the tab.
    return false;
  }
}

/**
 * Hides the field table behind a click.
 *
 * Closed by default, and unmounted rather than hidden while closed: the
 * defaults are right for the common case, and the dialog's real subject is the
 * description box below. Someone who tunes the table once tends to tune it
 * every time, so the choice is remembered.
 */
function FieldTableDisclosure(props: { children: ReactNode }) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const [isOpen, setOpen] = useState(readDisclosureOpen);

  const setPersisted = (open: boolean) => {
    setOpen(open);
    try {
      localStorage.setItem(DISCLOSURE_STORAGE_KEY, String(open));
    } catch {
      // See readDisclosureOpen.
    }
  };

  return (
    <Flex direction="column" gap="regular">
      <ActionButton
        prominence="low"
        alignSelf="start"
        onPress={() => setPersisted(!isOpen)}
        aria-expanded={isOpen}
      >
        <Icon src={isOpen ? chevronDownIcon : chevronRightIcon} />
        <Text>{stringFormatter.format("aiFieldsTableToggle")}</Text>
      </ActionButton>
      {isOpen && props.children}
    </Flex>
  );
}

// Field table
// ----------------------------------------------------------------------------

// A grid rather than a <table>: the cells are form controls, and the row's
// only job is to line them up under their headers. No borders - the columns
// read as columns from alignment alone, and rules between them would turn a
// short list of fields into a spreadsheet.
const fieldTable = css({
  display: "grid",
  gridTemplateColumns: "1fr auto auto auto auto",
  alignItems: "center",
  columnGap: tokenSchema.size.space.regular,
  rowGap: tokenSchema.size.space.small,
});

const headerCell = css({
  paddingBottom: tokenSchema.size.space.small,
  borderBottom: `${tokenSchema.size.border.regular} solid ${tokenSchema.color.border.muted}`,
});

// Checkbox columns are narrow and their headers are abbreviations; centring
// the control under the label is what makes the column scannable.
const centreCell = css({ display: "flex", justifyContent: "center" });

function FieldTable(props: {
  specs: AiFieldSpec[];
  schema: Record<string, ComponentSchema>;
  state: Record<string, unknown>;
  selection: Record<string, Column>;
  sizes: Record<string, AiSize>;
  continueKeys: ReadonlySet<string>;
  onSelectionChange: (selection: Record<string, Column>) => void;
  onSizesChange: (
    update: (prev: Record<string, AiSize>) => Record<string, AiSize>,
  ) => void;
  onContinueChange: (keys: ReadonlySet<string>) => void;
}) {
  const { specs, schema, state, selection, sizes, continueKeys } = props;
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);

  // The two columns are mutually exclusive per field: the prompt tells the
  // model not to echo the context block, so a field that's both context and a
  // target would be asking for two contradictory things at once. A field may
  // be in neither.
  const setColumn = (
    key: string,
    column: Exclude<Column, "none">,
    checked: boolean,
  ) => {
    props.onSelectionChange({
      ...selection,
      [key]: checked ? column : "none",
    });
  };

  return (
    <div className={fieldTable} role="group">
      <div className={headerCell}>
        <Text size="small" color="neutralSecondary">
          {stringFormatter.format("aiColName")}
        </Text>
      </div>
      <HeaderCell
        label={stringFormatter.format("aiColSize")}
        help={stringFormatter.format("aiContentSize")}
      />
      <HeaderCell
        label={stringFormatter.format("aiColContinue")}
        help={stringFormatter.format("aiColContinueHelp")}
      />
      <HeaderCell
        label={stringFormatter.format("aiColInput")}
        help={stringFormatter.format("aiUseAsContextHelp")}
      />
      <HeaderCell
        label={stringFormatter.format("aiColOutput")}
        help={stringFormatter.format("aiFillInHelp")}
      />

      {specs.map((spec) => {
        const column = selection[spec.key] ?? "none";
        const fieldSchema = schema[spec.key];
        const value = state[spec.key];
        const sizeEnabled = canPickSize(spec, column);
        const continueEnabled = canContinue(spec, fieldSchema, value, column);

        return (
          <Fragment key={spec.key}>
            <Flex direction="column" gap="xsmall">
              <Text>{spec.label}</Text>
              {spec.description && (
                <Text size="small" color="neutralSecondary">
                  {spec.description}
                </Text>
              )}
              {spec.kind === "content" && (
                <Text size="small" color="neutralTertiary">
                  {stringFormatter.format("aiContentTokenHint")}
                </Text>
              )}
            </Flex>

            <div className={centreCell}>
              {spec.kind === "content" ? (
                <Picker
                  aria-label={`${spec.label} - ${stringFormatter.format("aiContentSize")}`}
                  isDisabled={!sizeEnabled}
                  selectedKey={sizes[spec.key] ?? "medium"}
                  onSelectionChange={(key) =>
                    props.onSizesChange((prev) => ({
                      ...prev,
                      [spec.key]: key as AiSize,
                    }))
                  }
                  items={(Object.keys(SIZE_SPECS) as AiSize[]).map((key) => ({
                    key,
                    name: stringFormatter.format(SIZE_LABEL_KEYS[key]),
                  }))}
                >
                  {(item) => <Item key={item.key}>{item.name}</Item>}
                </Picker>
              ) : null}
            </div>

            <div className={centreCell}>
              {isContinuableKind(spec) ? (
                <Checkbox
                  aria-label={`${spec.label} - ${stringFormatter.format("aiColContinue")}`}
                  isDisabled={!continueEnabled}
                  // A disabled box must not read as ticked: `fill` can be
                  // unticked after `continue` was, and a tick that no longer
                  // does anything is a lie about what will be sent.
                  isSelected={continueEnabled && continueKeys.has(spec.key)}
                  onChange={(checked) =>
                    props.onContinueChange(
                      toggle(continueKeys, spec.key, checked),
                    )
                  }
                />
              ) : null}
            </div>

            <div className={centreCell}>
              <Checkbox
                aria-label={`${spec.label} - ${stringFormatter.format("aiUseAsContext")}`}
                isSelected={column === "context"}
                onChange={(checked) => setColumn(spec.key, "context", checked)}
              />
            </div>

            <div className={centreCell}>
              <Checkbox
                aria-label={`${spec.label} - ${stringFormatter.format("aiFillIn")}`}
                isSelected={column === "fill"}
                onChange={(checked) => setColumn(spec.key, "fill", checked)}
              />
            </div>
          </Fragment>
        );
      })}
    </div>
  );
}

function HeaderCell(props: { label: string; help: string }) {
  return (
    <div className={[headerCell, centreCell].join(" ")}>
      <TooltipTrigger>
        {/* The header is an abbreviation - the tooltip is where it says what
            it means, so it has to be reachable, not just hoverable. */}
        <ActionButton prominence="low">
          <Text size="small" color="neutralSecondary">
            {props.label}
          </Text>
        </ActionButton>
        <Tooltip>{props.help}</Tooltip>
      </TooltipTrigger>
    </div>
  );
}
