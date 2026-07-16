import { AssetsFormField } from '../../api';
import {
  DocumentFieldInput,
  getDefaultValue,
  serializeFromEditorStateHTML,
  createEditorSchema,
  parseToEditorStateHTML,
} from '#field-ui/content';
import type { EditorSchema } from '../markdoc/editor/schema';
import type { EditorState } from 'prosemirror-state';
import {
  MarkdocEditorOptions,
  editorOptionsToConfig,
} from '../markdoc/config';
import {
  countWordsAndChars,
  stripHtmlForPreview,
} from '../../../app/collection-table/format-helpers';

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export type ContentSummary = { wordCount: number; charCount: number };

export function content({
  label,
  description,
  options = {},
}: {
  label: string;
  description?: string;
  options?: Omit<MarkdocEditorOptions, 'image'> & {
    image?: boolean;
  };
}): content.Field {
  let schema: undefined | EditorSchema;
  let inlineSchema: undefined | EditorSchema;
  const config = editorOptionsToConfig(
    { strikethrough: false, code: false, codeBlock: false, ...options },
    true
  );
  const getSchema = () => {
    if (!schema) {
      schema = createEditorSchema(config, {}, false);
    }
    return schema;
  };
  // Same schema, minus the editor's own block spacing — see inlineParse.
  const getInlineSchema = () => {
    if (!inlineSchema) {
      inlineSchema = createEditorSchema(config, {}, false, {
        hostTypography: true,
      });
    }
    return inlineSchema;
  };
  return {
    kind: 'form',
    formKind: 'assets',
    htmlContentEditor: true,
    // the HTML body is written to its own file instead of living inline in
    // the entry's YAML/JSON — `value` only carries the lightweight
    // { wordCount, charCount } summary, so listing entries never has to
    // fetch (and parse) the full document
    contentExtension: '.html',
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
    // typography — the visual editor's inline spots (see
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
        stripHtmlForPreview(out.value)
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
        if (extra?.content === undefined) return '';
        return textDecoder.decode(extra.content);
      },
    },
  };
}

export declare namespace content {
  type Field = AssetsFormField<EditorState, EditorState, string> & {
    inlineParse(
      html: string,
      other: ReadonlyMap<string, Uint8Array>
    ): EditorState;
  };
}
