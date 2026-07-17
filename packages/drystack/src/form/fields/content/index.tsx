import { AssetsFormField } from "../../api";
import {
  DocumentFieldInput,
  getDefaultValue,
  serializeFromEditorStateHTML,
  createEditorSchema,
  parseToEditorStateHTML,
} from "#field-ui/content";
import type { EditorSchema } from "../markdoc/editor/schema";
import type { EditorState } from "prosemirror-state";
import {
  EditorConfig,
  MarkdocEditorOptions,
  editorOptionsToConfig,
} from "../markdoc/config";
import {
  countWordsAndChars,
  stripHtmlForPreview,
} from "../../../app/collection-table/format-helpers";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type ContentSummary = { wordCount: number; charCount: number };

// A content field is the body of a page that already renders its own `<h1>`
// from the entry's title, so a second one inside the body would be a duplicate
// top-level heading. Callers can still pass `heading` explicitly to get h1 back.
const defaultHeadingLevels = [2, 3, 4, 5, 6] as const;

// The HTML tags this field's editor will actually keep, read off the same
// resolved config that builds its schema. The AI codec puts this in the prompt,
// so the model is never invited to emit a tag `parse()` would silently drop.
//
// `<img>` is never listed even when images are enabled: the model can't
// produce asset bytes, and a made-up src would point at nothing (see the
// content image src format - `/<entryDir>/assets/<name>`).
//
// Deliberately omits `table` and `grid` even though both default on for the
// HTML editor: their markup is structural rather than prose, and a model
// improvising it tends to produce nodes the schema drops on parse. Leaving
// them out of the prompt costs nothing - a person can still add them by hand.
function allowedHtmlTags(config: EditorConfig): string[] {
  const tags = ["p"];
  for (const level of config.heading.levels) tags.push(`h${level}`);
  if (config.bold) tags.push("strong");
  if (config.italic) tags.push("em");
  if (config.underline) tags.push("u");
  if (config.link) tags.push("a");
  if (config.blockquote) tags.push("blockquote");
  if (config.unorderedList) tags.push("ul");
  if (config.orderedList) tags.push("ol");
  if (config.unorderedList || config.orderedList) tags.push("li");
  if (config.strikethrough) tags.push("s");
  if (config.code) tags.push("code");
  if (config.divider) tags.push("hr");
  return tags;
}

export function content({
  label,
  description,
  options = {},
}: {
  label: string;
  description?: string;
  options?: Omit<MarkdocEditorOptions, "image"> & {
    image?: boolean;
  };
}): content.Field {
  let schema: undefined | EditorSchema;
  let inlineSchema: undefined | EditorSchema;
  const config = editorOptionsToConfig(
    {
      strikethrough: false,
      code: false,
      codeBlock: false,
      ...options,
      heading: options.heading ?? defaultHeadingLevels,
    },
    true,
  );
  const getSchema = () => {
    if (!schema) {
      schema = createEditorSchema(config, {}, false);
    }
    return schema;
  };
  // Same schema, minus the editor's own block spacing - see inlineParse.
  const getInlineSchema = () => {
    if (!inlineSchema) {
      inlineSchema = createEditorSchema(config, {}, false, {
        hostTypography: true,
      });
    }
    return inlineSchema;
  };
  return {
    kind: "form",
    formKind: "assets",
    htmlContentEditor: true,
    label,
    aiMeta: { description, htmlTags: allowedHtmlTags(config) },
    // the HTML body is written to its own file instead of living inline in
    // the entry's YAML/JSON - `value` only carries the lightweight
    // { wordCount, charCount } summary, so listing entries never has to
    // fetch (and parse) the full document
    contentExtension: ".html",
    defaultValue() {
      return getDefaultValue(getSchema());
    },
    Input(props) {
      return (
        <DocumentFieldInput
          description={description}
          label={label}
          {...props}
        />
      );
    },
    parse(_value, { content, other }) {
      if (content === undefined) return getDefaultValue(getSchema());
      const html = textDecoder.decode(content);
      return parseToEditorStateHTML(html, getSchema(), other);
    },
    // parse() for an editor mounted onto a page that supplies its own
    // typography - the visual editor's inline spots (see
    // markdoc/editor/schema.tsx's `hostTypography`). Serializing the result
    // yields byte-identical HTML to parse()'s: the difference is only in what
    // the nodes render while being edited, never in what gets written.
    inlineParse(html, other) {
      return parseToEditorStateHTML(html, getInlineSchema(), other);
    },
    validate(value) {
      return value;
    },
    serialize(value, extra) {
      const out = serializeFromEditorStateHTML(value, extra?.entryDirectory);
      const summary: ContentSummary = countWordsAndChars(
        stripHtmlForPreview(out.value),
      );
      return {
        value: summary,
        content: textEncoder.encode(out.value),
        other: out.other,
        external: new Map(),
      };
    },
    reader: {
      parse(_value, extra) {
        if (extra?.content === undefined) return "";
        return textDecoder.decode(extra.content);
      },
    },
  };
}

export declare namespace content {
  type Field = AssetsFormField<EditorState, EditorState, string> & {
    inlineParse(
      html: string,
      other: ReadonlyMap<string, Uint8Array>,
    ): EditorState;
  };
}
