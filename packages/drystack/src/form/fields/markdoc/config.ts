import { text } from "../text";
import { BasicFormField, SlugFormField, ComponentSchema } from "../../api";
import { FieldDataError } from "../error";
import { basicFormFieldWithSimpleReaderParse } from "../utils";

type HeadingLevels = boolean | readonly (1 | 2 | 3 | 4 | 5 | 6)[];

export type BasicStringFormField =
  | BasicFormField<string>
  | SlugFormField<string, string, string, null>;

const defaultAltField: SlugFormField<string, string, string, null> = text({
  label: "Alt text",
  description: "This text will be used by screen readers and search engines.",
});

const emptyTitleField: BasicFormField<string> =
  basicFormFieldWithSimpleReaderParse({
    Input() {
      return null;
    },
    defaultValue() {
      return "";
    },
    parse(value) {
      if (value === undefined) return "";
      if (typeof value !== "string") {
        throw new FieldDataError("Must be string");
      }
      return value;
    },
    validate(value) {
      return value;
    },
    serialize(value) {
      return { value };
    },
    label: "Title",
  });

export type EditorConfig = {
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  code: boolean;
  heading: {
    levels: readonly (1 | 2 | 3 | 4 | 5 | 6)[];
    schema: Record<string, ComponentSchema>;
  };
  blockquote: boolean;
  orderedList: boolean;
  unorderedList: boolean;
  table: boolean;
  // multi-column layout block (div + CSS grid, 24 tracks). HTML-only - it
  // only round-trips through the HTML `content` field, never markdoc/mdx.
  grid: boolean;
  link: boolean;
  image:
    | {
        directory: string | undefined;
        publicPath: string | undefined;
        transformFilename: (originalFilename: string) => string;
        schema: {
          alt: BasicStringFormField;
          title: BasicStringFormField;
        };
      }
    | undefined;
  divider: boolean;
  codeBlock: { schema: Record<string, ComponentSchema> } | undefined;
  // whether this field's serialization format supports storing an image by
  // reference (an unhydrated node resolved lazily from the shared media
  // library directory) rather than always embedding its bytes as a sibling
  // file - only the HTML-backed `content` field supports this today
  supportsMediaLibraryReferences: boolean;
  // whether this field serializes to HTML and therefore supports block-level
  // layout that only round-trips through HTML: text alignment on paragraphs/
  // headings and explicit image width/height/float. false for markdoc/mdx.
  htmlLayout: boolean;
};

export type MarkdocEditorOptions = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  heading?:
    | HeadingLevels
    | { levels: HeadingLevels; schema: Record<string, ComponentSchema> };
  blockquote?: boolean;
  orderedList?: boolean;
  unorderedList?: boolean;
  table?: boolean;
  grid?: boolean;
  link?: boolean;
  image?:
    | boolean
    | {
        directory?: string;
        publicPath?: string;
        transformFilename?: (originalFilename: string) => string;
        schema?: { alt?: BasicStringFormField; title?: BasicStringFormField };
      };
  divider?: boolean;
  codeBlock?: boolean | { schema: Record<string, ComponentSchema> };
};

export type MDXEditorOptions = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  code?: boolean;
  heading?: HeadingLevels;
  blockquote?: boolean;
  orderedList?: boolean;
  unorderedList?: boolean;
  table?: boolean;
  link?: boolean;
  image?:
    | boolean
    | {
        directory?: string;
        publicPath?: string;
        transformFilename?: (originalFilename: string) => string;
        schema?: { alt?: BasicStringFormField; title?: BasicStringFormField };
      };
  divider?: boolean;
  codeBlock?: boolean;
};

type EditorOptions = MarkdocEditorOptions | MDXEditorOptions;

export function editorOptionsToConfig(
  options: EditorOptions,
  isHtml = false,
): EditorConfig {
  return {
    supportsMediaLibraryReferences: isHtml,
    htmlLayout: isHtml,
    bold: options.bold ?? true,
    italic: options.italic ?? true,
    // no markdoc/mdx syntax maps to underline, so it only defaults on for
    // the HTML-backed editor unless a caller opts in explicitly
    underline: options.underline ?? isHtml,
    strikethrough: options.strikethrough ?? true,
    code: options.code ?? true,
    heading: (() => {
      let levels = [];
      let levelsOpt =
        typeof options.heading === "object" && !Array.isArray(options.heading)
          ? (options.heading as { levels: HeadingLevels }).levels
          : (options.heading as HeadingLevels | undefined);
      if (levelsOpt === true || levelsOpt === undefined) {
        levels = [1, 2, 3, 4, 5, 6];
      }
      if (Array.isArray(levelsOpt)) {
        levels = levelsOpt;
      }
      return {
        levels,
        schema:
          options.heading &&
          typeof options.heading === "object" &&
          "schema" in options.heading
            ? options.heading.schema
            : {},
      };
    })(),
    blockquote: options.blockquote ?? true,
    orderedList: options.orderedList ?? true,
    unorderedList: options.unorderedList ?? true,
    table: options.table ?? true,
    // grid is HTML-only: default on for the HTML `content` field, always off
    // for markdoc/mdx (which can't serialize the div+style layout)
    grid: isHtml ? ((options as MarkdocEditorOptions).grid ?? true) : false,
    link: options.link ?? true,
    image:
      options.image !== false
        ? (() => {
            const opts = options.image === true ? undefined : options.image;
            return {
              directory: opts?.directory,
              publicPath: opts?.publicPath,
              transformFilename: opts?.transformFilename ?? ((x) => x),
              schema: {
                alt: opts?.schema?.alt ?? defaultAltField,
                title: opts?.schema?.title ?? emptyTitleField,
              },
            };
          })()
        : undefined,
    divider: options.divider ?? true,
    codeBlock:
      options.codeBlock === false
        ? undefined
        : {
            schema:
              typeof options.codeBlock === "object"
                ? options.codeBlock.schema
                : {},
          },
  };
}
