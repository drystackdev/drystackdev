import { ReactNode } from "react";
import { useLocalizedStringFormatter } from "@react-aria/i18n";
import l10nMessages from "../l10n";
import { Badge } from "@keystar/ui/badge";
import { Icon } from "@keystar/ui/icon";
import { externalLinkIcon } from "@keystar/ui/icon/icons/externalLinkIcon";
import { fileIcon } from "@keystar/ui/icon/icons/fileIcon";
import { Flex } from "@keystar/ui/layout";
import { Switch } from "@keystar/ui/switch";
import { css, tokenSchema } from "@keystar/ui/style";
import { Text } from "@keystar/ui/typography";

import { ComponentSchema } from "../../form/api";
import { useMediaLibraryPreviewURL } from "../media-library/useMediaLibraryPreviewURL";
import { useInView } from "../file-manager/useInView";
import { ColumnDescriptor } from "./column-model";
import {
  formatDateValue,
  formatDatetimeValue,
  formatNumberValue,
  summarizeContent,
} from "./format-helpers";
import { HighlightedSnippet, HighlightedText, MatchRange } from "./highlight";
import { PendingCheckboxEdit } from "./QuickEditCheckboxDialog";

const lineClampStyle = css({
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  wordBreak: "break-word",
  // a tight line-height clips Vietnamese diacritics (dấu) above/below the
  // glyph, since -webkit-line-clamp cuts off exactly at line-height × 2
  lineHeight: 2,
});

const dimText = { color: "neutralSecondary" as const, size: "small" as const };

const clickableContentStyle = css({
  cursor: "pointer",
  borderRadius: 4,
  padding: "2px 4px",
  margin: "-2px -4px",
  "&:hover": { backgroundColor: "rgba(128, 128, 128, 0.08)" },
});

export function EmptyCell() {
  return <Text {...dimText}>-</Text>;
}

const slugStyle = css({
  marginTop: 5,
  display: "-webkit-box",
  WebkitLineClamp: 2,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  wordBreak: "break-all",
  fontStyle: "italic",
  lineHeight: 1.5,
});

export function NameCell(props: { title: string; slug: string }) {
  const showSlug = props.title !== props.slug;
  return (
    <Flex direction="column" gap="xsmall" minWidth={0}>
      <Text
        weight="medium"
        UNSAFE_style={{
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          lineHeight: 2,
        }}
      >
        {props.title}
      </Text>
      {showSlug && (
        <Text
          size="small"
          color="neutralSecondary"
          UNSAFE_className={slugStyle}
        >
          {props.slug}
        </Text>
      )}
    </Flex>
  );
}

// a non-designated fields.slug()/fields.text() column - the value shape is
// the only way to tell them apart at this point (see DisplayKind's
// 'slugPair' case in column-model.ts)
export function SlugPairCell(props: { value: unknown }) {
  const { value } = props;
  if (
    value &&
    typeof value === "object" &&
    "name" in value &&
    "slug" in value &&
    typeof (value as any).name === "string" &&
    typeof (value as any).slug === "string"
  ) {
    return <NameCell title={(value as any).name} slug={(value as any).slug} />;
  }
  return <TextCell value={typeof value === "string" ? value : ""} />;
}

export function TextCell(props: { value: string }) {
  if (!props.value) return <EmptyCell />;
  return <Text UNSAFE_className={lineClampStyle}>{props.value}</Text>;
}

// 16:9 preview, like a video/cover thumbnail
const thumbnailStyle = css({
  width: 128,
  height: 72,
  borderRadius: tokenSchema.size.radius.regular,
  objectFit: "cover",
  display: "block",
  backgroundColor: tokenSchema.color.background.surfaceSecondary,
});

export function ImageCell(props: { path: string | null }) {
  const [ref, inView] = useInView<HTMLDivElement>();
  const url = useMediaLibraryPreviewURL(props.path, undefined, inView);
  if (!props.path) return <EmptyCell />;
  return (
    <div ref={ref} className={thumbnailStyle}>
      {url && <img src={url} alt="" className={thumbnailStyle} />}
    </div>
  );
}

export function FileCell(props: { path: string | null }) {
  if (!props.path) return <EmptyCell />;
  const filename = props.path.split("/").pop() ?? props.path;
  return (
    <Flex gap="xsmall" alignItems="center" minWidth={0}>
      <Icon src={fileIcon} color="neutralSecondary" size="small" />
      <Text truncate>{filename}</Text>
    </Flex>
  );
}

export function ContentSizeCell(props: {
  value: unknown;
  // the plain-text body, only present once "search content" has fetched and
  // stripped the field's .html file (see CollectionPage.tsx) - undefined
  // means skip straight to the word-count summary below, same as before
  // this feature existed.
  fullText?: string;
  matchIndices?: readonly MatchRange[];
  isClickable?: boolean;
  onOpenPreview?: () => void;
}) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const value = props.value as
    | string
    | { wordCount: number; charCount: number }
    | undefined
    | null;
  const isEmpty =
    value == null ||
    (typeof value === "string"
      ? !value.trim()
      : !value.wordCount && !value.charCount);
  const hasMatch = !!props.fullText && !!props.matchIndices?.length;
  if (isEmpty && !hasMatch) {
    return <EmptyCell />;
  }

  const inner = hasMatch ? (
    <HighlightedSnippet text={props.fullText!} indices={props.matchIndices!} />
  ) : (
    summarizeContent(value, stringFormatter)
  );

  if (!props.isClickable) {
    return (
      <Flex direction="column" gap="xsmall" minWidth={0}>
        <Text UNSAFE_className={lineClampStyle}>{inner}</Text>
      </Flex>
    );
  }

  return (
    <Flex
      direction="column"
      gap="xsmall"
      minWidth={0}
      role="button"
      tabIndex={0}
      UNSAFE_className={clickableContentStyle}
      onClick={(e) => {
        e.stopPropagation();
        props.onOpenPreview?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          props.onOpenPreview?.();
        }
      }}
    >
      <Text UNSAFE_className={lineClampStyle}>{inner}</Text>
    </Flex>
  );
}

export function DateCell(props: { value: string | null; withTime?: boolean }) {
  if (!props.value) return <EmptyCell />;
  return (
    <Text>
      {props.withTime
        ? formatDatetimeValue(props.value)
        : formatDateValue(props.value)}
    </Text>
  );
}

export function NumberCell(props: { value: number | null }) {
  if (props.value === null || props.value === undefined) return <EmptyCell />;
  return (
    <Text UNSAFE_className={css({ fontVariantNumeric: "tabular-nums" })}>
      {formatNumberValue(props.value)}
    </Text>
  );
}

export function UrlCell(props: { value: string | null }) {
  if (!props.value) return <EmptyCell />;
  return (
    <Text>
      <a
        href={props.value}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={css({
          display: "inline-flex",
          alignItems: "center",
          gap: tokenSchema.size.space.xsmall,
          color: tokenSchema.color.foreground.accent,
        })}
      >
        <span className={css({ overflow: "hidden", textOverflow: "ellipsis" })}>
          {props.value}
        </span>
        <Icon src={externalLinkIcon} size="small" />
      </a>
    </Text>
  );
}

export function RelationshipCell(props: { value: string | null }) {
  if (!props.value) return <EmptyCell />;
  return <Badge tone="neutral">{props.value}</Badge>;
}

export function SelectCell(props: {
  value: string | null;
  schema: ComponentSchema;
}) {
  if (!props.value) return <EmptyCell />;
  const label = getOptionLabel(props.schema, props.value) ?? props.value;
  return <Badge tone="neutral">{label}</Badge>;
}

export function ListCell(props: {
  values: readonly string[];
  schema?: ComponentSchema;
  max?: number;
}) {
  const { values, schema, max = 3 } = props;
  if (!values.length) return <EmptyCell />;
  const shown = values.slice(0, max);
  const remaining = values.length - shown.length;
  return (
    <Flex gap="xsmall" wrap>
      {shown.map((value, i) => (
        <Badge key={i} tone="neutral">
          {schema ? (getOptionLabel(schema, value) ?? value) : value}
        </Badge>
      ))}
      {remaining > 0 && <Badge tone="neutral">+{remaining}</Badge>}
    </Flex>
  );
}

export function CheckboxCell(props: {
  label: string;
  value: boolean;
  isDisabled?: boolean;
  onRequestChange: (nextValue: boolean) => void;
}) {
  return (
    <Switch
      aria-label={props.label}
      isSelected={props.value}
      isDisabled={props.isDisabled}
      onChange={props.onRequestChange}
    />
  );
}

export function ArrayCell(props: { length: number }) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  if (!props.length) return <EmptyCell />;
  return (
    <Text {...dimText}>
      {stringFormatter.format("arrayItemCount", { count: props.length })}
    </Text>
  );
}

export function ObjectCell(props: { value: unknown }) {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  const count =
    props.value && typeof props.value === "object"
      ? Object.values(props.value).filter((v) => v != null && v !== "").length
      : 0;
  if (!count) return <EmptyCell />;
  return (
    <Text {...dimText}>
      {stringFormatter.format("objectFieldsSetCount", { count })}
    </Text>
  );
}

export function getOptionLabel(
  schema: ComponentSchema,
  value: string,
): string | undefined {
  const options = (schema as any).options as
    | readonly { label: string; value: string }[]
    | undefined;
  return options?.find((option) => option.value === value)?.label;
}

export function DefaultCell(props: { value: unknown }): ReactNode {
  const stringFormatter = useLocalizedStringFormatter(l10nMessages);
  if (props.value == null || props.value === "") return <EmptyCell />;
  if (typeof props.value === "boolean") {
    return (
      <Text>
        {stringFormatter.format(props.value ? "trueLabel" : "falseLabel")}
      </Text>
    );
  }
  return <TextCell value={String(props.value)} />;
}

export function renderColumnCell(
  descriptor: ColumnDescriptor,
  value: unknown,
  itemSlug: string,
  ctx: {
    onRequestCheckboxEdit: (edit: PendingCheckboxEdit) => void;
    content?: {
      fullText?: string;
      matchIndices?: readonly MatchRange[];
      isClickable: boolean;
      onOpenPreview: () => void;
    };
    // a search match outside the content field's own .html body - covers
    // every other column (name, text, select, date, url, ...) except
    // image/checkbox, which have nothing textual to highlight. Overrides
    // that column's normal formatted cell (badge, date, link icon, ...)
    // with plain highlighted text, same tradeoff the content snippet makes:
    // showing *what* matched beats preserving formatting no one asked to
    // search past.
    match?: { text: string; indices: readonly MatchRange[] };
  },
): ReactNode {
  if (
    ctx.match &&
    descriptor.displayKind !== "content" &&
    descriptor.displayKind !== "image" &&
    descriptor.displayKind !== "checkbox"
  ) {
    return (
      <Text UNSAFE_className={lineClampStyle}>
        <HighlightedText text={ctx.match.text} indices={ctx.match.indices} />
      </Text>
    );
  }
  switch (descriptor.displayKind) {
    case "name":
      return (
        <NameCell
          title={typeof value === "string" && value ? value : itemSlug}
          slug={itemSlug}
        />
      );
    case "checkbox":
      return (
        <CheckboxCell
          label={descriptor.label}
          value={Boolean(value)}
          onRequestChange={(next) =>
            ctx.onRequestCheckboxEdit({
              itemSlug,
              fieldKey: descriptor.key,
              fieldLabel: descriptor.label,
              nextValue: next,
            })
          }
        />
      );
    case "image":
      return <ImageCell path={typeof value === "string" ? value : null} />;
    case "file":
      return <FileCell path={typeof value === "string" ? value : null} />;
    case "url":
      return <UrlCell value={typeof value === "string" ? value : null} />;
    case "relationship":
      return (
        <RelationshipCell value={typeof value === "string" ? value : null} />
      );
    case "multiRelationship":
    case "files":
      return <ListCell values={Array.isArray(value) ? value : []} />;
    case "select":
      return (
        <SelectCell
          value={typeof value === "string" ? value : null}
          schema={descriptor.schema!}
        />
      );
    case "multiselect":
      return (
        <ListCell
          values={Array.isArray(value) ? value : []}
          schema={descriptor.schema}
        />
      );
    case "date":
      return <DateCell value={typeof value === "string" ? value : null} />;
    case "datetime":
      return (
        <DateCell value={typeof value === "string" ? value : null} withTime />
      );
    case "number":
      return <NumberCell value={typeof value === "number" ? value : null} />;
    case "content":
      return (
        <ContentSizeCell
          value={value}
          fullText={ctx.content?.fullText}
          matchIndices={ctx.content?.matchIndices}
          isClickable={ctx.content?.isClickable}
          onOpenPreview={ctx.content?.onOpenPreview}
        />
      );
    case "slugPair":
      return <SlugPairCell value={value} />;
    case "array":
      return <ArrayCell length={Array.isArray(value) ? value.length : 0} />;
    case "object":
      return <ObjectCell value={value} />;
    case "text":
    default:
      return <DefaultCell value={value} />;
  }
}
