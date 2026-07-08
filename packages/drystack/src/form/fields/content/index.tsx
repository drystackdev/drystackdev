import { AssetsFormField } from '../../api';
import { FieldDataError } from '../error';
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
  return {
    kind: 'form',
    formKind: 'assets',
    htmlContentEditor: true,
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
    parse(value, { other }) {
      if (value === undefined) return getDefaultValue(getSchema());
      if (typeof value !== 'string') {
        throw new FieldDataError('Must be a string');
      }
      return parseToEditorStateHTML(value, getSchema(), other);
    },
    validate(value) {
      return value;
    },
    serialize(value) {
      const out = serializeFromEditorStateHTML(value);
      return { value: out.value, other: out.other, external: new Map() };
    },
    reader: {
      parse(value) {
        if (typeof value !== 'string') return '';
        return value;
      },
    },
  };
}

export declare namespace content {
  type Field = AssetsFormField<EditorState, EditorState, string>;
}
