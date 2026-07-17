import { ComponentSchema } from "../../form/api";

// a normalized hint for how a schema field should be presented as a
// collection-table column/cell - folds together the schema-level `formKind`
// discriminant (slug/assets) and the `columnKind` hint basic fields carry
// (see `ColumnKind` in form/api.tsx) into one thing the table can switch on.
export type DisplayKind =
  | "name" // the collection's designated slug/title field
  | "checkbox"
  | "image"
  | "file"
  | "url"
  | "relationship"
  | "multiRelationship"
  | "date"
  | "datetime"
  | "number"
  | "select"
  | "multiselect"
  | "files"
  | "content" // fields.content() - rendered as a size/word-count summary
  | "slugPair" // a non-designated fields.slug()/fields.text() column - the
  // actual shape (string vs {name,slug}) is only known at the value level,
  // see `isNameSlugPair` in cells.tsx
  | "array"
  | "object"
  | "text";

export function getDisplayKind(
  schema: ComponentSchema,
  key: string,
  slugField: string,
): DisplayKind {
  if (key === slugField) return "name";
  if (schema.kind === "array") return "array";
  if (schema.kind === "object") return "object";
  if (schema.kind !== "form") return "text";
  if (schema.formKind === "assets") return "content";
  if (schema.formKind === "slug") return "slugPair";
  if (schema.formKind === "content" || schema.formKind === "asset") {
    return "text";
  }
  return schema.columnKind ?? "text";
}

export type ColumnDescriptor = {
  key: string;
  label: string;
  displayKind: DisplayKind;
  schema: ComponentSchema;
};

// text a column's value contributes to the "search across visible columns"
// haystack - deliberately blank for kinds where stringifying the raw value
// wouldn't be meaningful to search (images, checkboxes, nested structures)
export function columnValueToSearchText(
  descriptor: ColumnDescriptor,
  value: unknown,
  itemSlug: string,
): string {
  switch (descriptor.displayKind) {
    case "name":
      return `${typeof value === "string" ? value : ""} ${itemSlug}`;
    case "slugPair":
      if (value && typeof value === "object" && "name" in value) {
        return String((value as any).name ?? "");
      }
      return typeof value === "string" ? value : "";
    case "content":
    case "url":
    case "relationship":
    case "select":
      return typeof value === "string" ? value : "";
    case "multiselect":
    case "multiRelationship":
    case "files":
      return Array.isArray(value) ? value.join(" ") : "";
    case "date":
    case "datetime":
      return typeof value === "string" ? value : "";
    case "number":
      return value != null ? String(value) : "";
    case "text":
      return typeof value === "string" ? value : "";
    case "checkbox":
    case "image":
    case "file":
    case "array":
    case "object":
      return "";
    default:
      return "";
  }
}
