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

// The HTML tags this field's editor will actually keep, derived from the same
// options that build its schema. The AI codec puts this in the prompt, so the
// model is never invited to emit a tag `parse()` would silently drop.
//
// `<img>` is never listed even when images are enabled: the model can't
// produce asset bytes, and a made-up src would point at nothing (see the
// content image src format — `/<entryDir>/assets/<name>`).
// Mirrors `editorOptionsToConfig`'s defaults, which are `?? true` for most
// marks — so the test is `!== false`, not truthiness. `content()` overrides
// strikethrough/code to default off (see the call below), hence the plain
// truthy test for those two.
//
// Deliberately omits `table` and `grid` even though both default on for the
// HTML editor: their markup is structural rather than prose, and a model
// improvising it tends to produce nodes the schema drops on parse. Leaving
// them out of the prompt costs nothing — a person can still add them by hand.
function allowedHtmlTags(
  options: Omit<MarkdocEditorOptions, 'image'> & { image?: boolean }
): string[] {
  const tags = ['p'];

  const heading = options.heading;
  // `heading` is either the levels themselves or a { levels, schema } object;
  // testing for the `levels` key tells them apart without tripping over
  // Array.isArray's inability to narrow a readonly array.
  const levelsOpt =
    typeof heading === 'object' && heading !== null && 'levels' in heading
      ? heading.levels
      : heading;
  // `true`/undefined both mean "every level" — matching editorOptionsToConfig.
  const levels =
    levelsOpt === true || levelsOpt === undefined
      ? [1, 2, 3, 4, 5, 6]
      : Array.isArray(levelsOpt)
        ? levelsOpt
        : [];
  for (const level of levels) tags.push(`h${level}`);

  if (options.bold !== false) tags.push('strong');
  if (options.italic !== false) tags.push('em');
  // underline defaults on for the HTML-backed editor specifically.
  if (options.underline !== false) tags.push('u');
  if (options.link !== false) tags.push('a');
  if (options.blockquote !== false) tags.push('blockquote');
  if (options.unorderedList !== false) tags.push('ul');
  if (options.orderedList !== false) tags.push('ol');
  if (options.unorderedList !== false || options.orderedList !== false) {
    tags.push('li');
  }
  if (options.strikethrough) tags.push('s');
  if (options.code) tags.push('code');
  if (options.divider) tags.push('hr');
  return tags;
}

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
    label,
    aiMeta: { description, htmlTags: allowedHtmlTags(options) },
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
