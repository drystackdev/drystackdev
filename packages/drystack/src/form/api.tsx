import { ReactElement, ReactNode } from 'react';
import { Glob } from '../config';

import { ChildField } from './fields/child';
import { Awareness } from 'y-protocols/awareness';

export type FormFieldInputProps<Value> = {
  value: Value;
  onChange(value: Value): void;
  autoFocus: boolean;
  /**
   * This will be true when validate has returned false and the user has attempted to close the form
   * or when the form is open and they attempt to save the item
   */
  forceValidation: boolean;
};

export type JsonYamlValue =
  | string
  | number
  | boolean
  | null
  | Date
  | readonly JsonYamlValue[]
  | { [key: string]: JsonYamlValue };

type JsonYamlValueWithoutNull = JsonYamlValue & {};

export type FormFieldStoredValue = JsonYamlValueWithoutNull | undefined;

// a hint for how a basic form field's value should be presented as a
// collection-table column — most basic fields share `kind: 'form',
// formKind: undefined`, so this is the only thing that lets the table tell a
// checkbox apart from an image path apart from a plain string, etc.
export type ColumnKind =
  | 'text'
  | 'checkbox'
  | 'image'
  | 'file'
  | 'url'
  | 'relationship'
  | 'multiRelationship'
  | 'date'
  | 'datetime'
  | 'number'
  | 'select'
  | 'multiselect'
  | 'files';

// what the AI codec (api/ai/schema-to-yaml.ts) needs to describe a field to
// the model. fields keep their options in closures — `label` aside, none of
// it is readable off the field object — so anything the codec has to see must
// be surfaced here explicitly. same reasoning as `columnKind` above: the
// consumer can't introspect what it can't see.
//
// only fields the AI is allowed to fill set this; image/file/relationship
// deliberately leave it unset (the model can't produce asset bytes).
export type AiFieldMeta = {
  // free-form guidance from the site's own schema — the strongest steer
  // available without touching config, e.g. a `description` teaching the
  // bracket convention for emphasised headings.
  description?: string;
  multiline?: boolean;
  isRequired?: boolean;
  // HTML tags `fields.content` permits, derived from its editor options, so
  // the model is never told it can emit a tag the editor would drop on parse.
  htmlTags?: readonly string[];
};

export type BasicFormField<
  ParsedValue extends {} | null,
  ValidatedValue extends ParsedValue = ParsedValue,
  ReaderValue = ValidatedValue,
> = {
  kind: 'form';
  formKind?: undefined;
  columnKind?: ColumnKind;
  aiMeta?: AiFieldMeta;
  Input(props: FormFieldInputProps<ParsedValue>): ReactElement | null;
  defaultValue(): ParsedValue;
  parse(value: FormFieldStoredValue): ParsedValue;
  /**
   * If undefined is returned, the field will generally not be written,
   * except in array fields where it will be stored as null
   */
  serialize(value: ParsedValue): { value: FormFieldStoredValue };
  validate(value: ParsedValue): ValidatedValue;
  reader: {
    parse(value: FormFieldStoredValue): ReaderValue;
  };
  label?: string;
  // when set, this field's value is auto-stamped by the save pipeline
  // (stampTimestamps in app/updating.tsx), not edited by the user:
  //   'created' → stamped once, only when the stored value is empty
  //   'updated' → re-stamped on every save
  timestamp?: 'created' | 'updated';
};

export type SlugFormField<
  ParsedValue extends {} | null,
  ValidatedValue extends ParsedValue,
  ReaderValue,
  ReaderValueAsSlugField,
> = {
  kind: 'form';
  formKind: 'slug';
  aiMeta?: AiFieldMeta;
  Input(props: FormFieldInputProps<ParsedValue>): ReactElement | null;
  defaultValue(): ParsedValue;
  parse(
    value: FormFieldStoredValue,
    extra: { slug: string } | undefined
  ): ParsedValue;

  serialize(value: ParsedValue): { value: FormFieldStoredValue };
  serializeWithSlug(value: ParsedValue): {
    slug: string;
    value: FormFieldStoredValue;
  };
  validate(
    value: ParsedValue,
    extra: { slugField: { slugs: Set<string>; glob: Glob } } | undefined
  ): ValidatedValue;
  reader: {
    parse(value: FormFieldStoredValue): ReaderValue;
    parseWithSlug(
      value: FormFieldStoredValue,
      extra: {
        slug: string;
        glob: Glob;
      }
    ): ReaderValueAsSlugField;
  };
  label?: string;
};

export type AssetFormField<
  ParsedValue extends {} | null,
  ValidatedValue extends ParsedValue,
  ReaderValue,
> = {
  kind: 'form';
  formKind: 'asset';
  Input(props: FormFieldInputProps<ParsedValue>): ReactElement | null;
  directory?: string;
  defaultValue(): ParsedValue;
  filename(
    value: FormFieldStoredValue,
    extra: {
      suggestedFilenamePrefix: string | undefined;
      slug: string | undefined;
    }
  ): string | undefined;
  parse(
    value: FormFieldStoredValue,
    extra: {
      asset: Uint8Array | undefined;
      slug: string | undefined;
    }
  ): ParsedValue;
  serialize(
    value: ParsedValue,
    extra: {
      suggestedFilenamePrefix: string | undefined;
      slug: string | undefined;
    }
  ): {
    value: FormFieldStoredValue;
    asset: { content: Uint8Array; filename: string } | undefined;
  };

  validate(value: ParsedValue): ValidatedValue;
  reader: {
    parse(value: FormFieldStoredValue): ReaderValue;
  };
  label?: string;
};

export type AssetsFormField<
  ParsedValue extends {} | null,
  ValidatedValue extends ParsedValue,
  ReaderValue,
> = {
  kind: 'form';
  formKind: 'assets';
  aiMeta?: AiFieldMeta;
  label?: string;
  directories?: string[];
  // set by `fields.content` (the HTML rich-text editor) so `entryLayout:
  // 'content'` can auto-detect it as the main content pane. other assets
  // fields (image/file) leave this unset.
  htmlContentEditor?: boolean;
  // when set, the field's main value is split out into its own file (like
  // `ContentFormField.contentExtension`) instead of living inline in the
  // entry's YAML/JSON — `fields.content()` sets this to store the HTML body
  // separately and keep only lightweight metadata (e.g. word/char counts) in
  // `value`. Fields that don't set this (e.g. `markdoc.inline()`) keep their
  // whole value inline, as before.
  contentExtension?: string;

  Input(props: FormFieldInputProps<ParsedValue>): ReactElement | null;
  defaultValue(): ParsedValue;
  parse(
    value: FormFieldStoredValue,
    args: {
      content?: Uint8Array | undefined;
      other: ReadonlyMap<string, Uint8Array>;
      external: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
      slug: string | undefined;
    }
  ): ParsedValue;
  serialize(
    value: ParsedValue,
    extra: {
      slug: string | undefined;
      // Repo-relative directory of the entry being serialized. Used by
      // fields.content to write embedded-image srcs as live-resolvable public
      // paths (`/<entryDirectory>/assets/<name>`); other assets fields ignore
      // it. Optional so callers that lack the directory still type-check.
      entryDirectory?: string | undefined;
    }
  ): {
    value: FormFieldStoredValue;
    content?: Uint8Array | undefined;
    other: ReadonlyMap<string, Uint8Array>;
    external: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
  };

  validate(value: ParsedValue): ValidatedValue;
  reader: {
    parse(
      value: FormFieldStoredValue,
      extra?: { content?: Uint8Array | undefined }
    ): ReaderValue;
  };
  collaboration?: {
    toYjs: (value: ParsedValue) => unknown;
    fromYjs: (yjsValue: unknown, awareness: Awareness) => ParsedValue;
  };
};

export type ContentFormField<
  ParsedValue extends {} | null,
  ValidatedValue extends ParsedValue,
  ReaderValue,
> = {
  kind: 'form';
  formKind: 'content';
  contentExtension: string;
  directories?: string[];

  Input(props: FormFieldInputProps<ParsedValue>): ReactElement | null;
  defaultValue(): ParsedValue;
  parse(
    value: FormFieldStoredValue,
    args: {
      content: Uint8Array | undefined;
      other: ReadonlyMap<string, Uint8Array>;
      external: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
      slug: string | undefined;
    }
  ): ParsedValue;
  serialize(
    value: ParsedValue,
    extra: {
      slug: string | undefined;
      entryDirectory?: string | undefined;
    }
  ): {
    value: FormFieldStoredValue;
    content: Uint8Array | undefined;
    other: ReadonlyMap<string, Uint8Array>;
    external: ReadonlyMap<string, ReadonlyMap<string, Uint8Array>>;
  };

  validate(value: ParsedValue): ValidatedValue;
  reader: {
    parse(
      value: FormFieldStoredValue,
      extra: {
        content: Uint8Array | undefined;
      }
    ): ReaderValue;
  };
  collaboration?: {
    toYjs: (value: ParsedValue) => unknown;
    fromYjs: (yjsValue: unknown, awareness: Awareness) => ParsedValue;
  };
};

export type FormField<
  ParsedValue extends {} | null,
  ValidatedValue extends ParsedValue,
  ReaderValue,
> =
  | BasicFormField<ParsedValue, ValidatedValue, ReaderValue>
  | SlugFormField<ParsedValue, ValidatedValue, ReaderValue, any>
  | AssetFormField<ParsedValue, ValidatedValue, ReaderValue>
  | ContentFormField<ParsedValue, ValidatedValue, ReaderValue>
  | AssetsFormField<ParsedValue, ValidatedValue, ReaderValue>;

export type DocumentNode = DocumentElement | DocumentText;

export type DocumentElement = {
  children: DocumentNode[];
  [key: string]: unknown;
};

export type DocumentText = {
  text: string;
  [key: string]: unknown;
};

export type { ChildField } from './fields/child';

export type ArrayField<ElementField extends ComponentSchema> = {
  kind: 'array';
  element: ElementField;
  label: string;
  description?: string;
  // this is written with unknown to avoid typescript being annoying about circularity or variance things
  itemLabel?(props: unknown): string;
  asChildTag?: string;
  slugField?: string;
  validation?: {
    length?: {
      min?: number;
      max?: number;
    };
  };
  Input?(props: unknown): ReactElement | null;
};

export type ObjectFieldOptions = {
  label?: string;
  description?: string;
  /**
   * Define the number of columns each field should span. The grid layout
   * supports 12 possible columns.
   * @example [6, 6] - "one row, equal columns"
   * @example [12, 8, 4] - "one field in the first row, two fields in the second row"
   */
  layout?: number[];
};

export interface ObjectField<
  Fields extends Record<string, ComponentSchema> = Record<
    string,
    ComponentSchema
  >,
> extends ObjectFieldOptions {
  kind: 'object';
  fields: Fields;
  Input?(props: unknown): ReactElement | null;
}

export type ConditionalField<
  DiscriminantField extends BasicFormField<string | boolean>,
  ConditionalValues extends {
    [Key in `${ReturnType<
      DiscriminantField['defaultValue']
    >}`]: ComponentSchema;
  },
> = {
  kind: 'conditional';
  discriminant: DiscriminantField;
  values: ConditionalValues;
  Input?(props: unknown): ReactElement | null;
};

// this is written like this rather than ArrayField<ComponentSchema> to avoid TypeScript erroring about circularity
type ArrayFieldInComponentSchema = {
  kind: 'array';
  element: ComponentSchema;
  label: string;
  description?: string;
  // this is written with unknown to avoid typescript being annoying about circularity or variance things
  itemLabel?(props: unknown): string;
  asChildTag?: string;
  slugField?: string;
  validation?: {
    length?: {
      min?: number;
      max?: number;
    };
  };
  Input?(props: unknown): ReactElement | null;
};

export type ComponentSchema =
  | ChildField
  | FormField<any, any, any>
  | ObjectField
  | ConditionalField<
      BasicFormField<any, any, any>,
      { [key: string]: ComponentSchema }
    >
  | ArrayFieldInComponentSchema;

export * as fields from './fields';

export type ComponentBlock<
  Fields extends Record<string, ComponentSchema> = Record<
    string,
    ComponentSchema
  >,
> = {
  preview: (props: any) => ReactElement | null;
  schema: Fields;
  label: string;
  toolbarIcon?: ReactElement;
} & (
  | {
      chromeless: true;
      toolbar?: (props: {
        props: Record<string, any>;
        onRemove(): void;
      }) => ReactElement;
    }
  | {
      chromeless?: false;
      toolbar?: (props: {
        props: Record<string, any>;
        onShowEditMode(): void;
        onRemove(): void;
        isValid: boolean;
      }) => ReactElement;
    }
);

type ChildFieldPreviewProps<Schema extends ChildField, ChildFieldElement> = {
  readonly element: ChildFieldElement;
  readonly schema: Schema;
};

type FormFieldPreviewProps<Schema extends FormField<any, any, any>> = {
  readonly value: ReturnType<Schema['defaultValue']>;
  onChange(value: ReturnType<Schema['defaultValue']>): void;
  readonly schema: Schema;
};

type ObjectFieldPreviewProps<
  Schema extends ObjectField<any>,
  ChildFieldElement,
> = {
  readonly fields: {
    readonly [Key in keyof Schema['fields']]: GenericPreviewProps<
      Schema['fields'][Key],
      ChildFieldElement
    >;
  };
  onChange(value: {
    readonly [Key in keyof Schema['fields']]?: InitialOrUpdateValueFromComponentPropField<
      Schema['fields'][Key]
    >;
  }): void;
  readonly schema: Schema;
};

type ConditionalFieldPreviewProps<
  Schema extends ConditionalField<BasicFormField<string | boolean>, any>,
  ChildFieldElement,
> = {
  readonly [Key in keyof Schema['values']]: {
    readonly discriminant: DiscriminantStringToDiscriminantValue<
      Schema['discriminant'],
      Key
    >;
    onChange<
      Discriminant extends ReturnType<Schema['discriminant']['defaultValue']>,
    >(
      discriminant: Discriminant,
      value?: InitialOrUpdateValueFromComponentPropField<
        Schema['values'][`${Discriminant}`]
      >
    ): void;
    readonly value: GenericPreviewProps<
      Schema['values'][Key],
      ChildFieldElement
    >;
    readonly schema: Schema;
  };
}[keyof Schema['values']];

type ArrayFieldPreviewProps<
  Schema extends ArrayField<ComponentSchema>,
  ChildFieldElement,
> = {
  readonly elements: readonly (GenericPreviewProps<
    Schema['element'],
    ChildFieldElement
  > & {
    readonly key: string;
  })[];
  readonly onChange: (
    value: readonly {
      key: string | undefined;
      value?: InitialOrUpdateValueFromComponentPropField<Schema['element']>;
    }[]
  ) => void;
  readonly schema: Schema;
};

export type GenericPreviewProps<
  Schema extends ComponentSchema,
  ChildFieldElement,
> = Schema extends ChildField
  ? ChildFieldPreviewProps<Schema, ChildFieldElement>
  : Schema extends FormField<any, any, any>
  ? FormFieldPreviewProps<Schema>
  : Schema extends ObjectField<any>
  ? ObjectFieldPreviewProps<Schema, ChildFieldElement>
  : Schema extends ConditionalField<any, any>
  ? ConditionalFieldPreviewProps<Schema, ChildFieldElement>
  : Schema extends ArrayField<any>
  ? ArrayFieldPreviewProps<Schema, ChildFieldElement>
  : never;

export type PreviewProps<Schema extends ComponentSchema> = GenericPreviewProps<
  Schema,
  ReactNode
>;

export type InitialOrUpdateValueFromComponentPropField<
  Schema extends ComponentSchema,
> = Schema extends ChildField
  ? undefined
  : Schema extends FormField<infer ParsedValue, any, any>
  ? ParsedValue | undefined
  : Schema extends ObjectField<infer Value>
  ? {
      readonly [Key in keyof Value]?: InitialOrUpdateValueFromComponentPropField<
        Value[Key]
      >;
    }
  : Schema extends ConditionalField<infer DiscriminantField, infer Values>
  ? {
      readonly [Key in keyof Values]: {
        readonly discriminant: DiscriminantStringToDiscriminantValue<
          DiscriminantField,
          Key
        >;
        readonly value?: InitialOrUpdateValueFromComponentPropField<
          Values[Key]
        >;
      };
    }[keyof Values]
  : Schema extends ArrayField<infer ElementField>
  ? readonly {
      key: string | undefined;
      value?: InitialOrUpdateValueFromComponentPropField<ElementField>;
    }[]
  : never;

type DiscriminantStringToDiscriminantValue<
  DiscriminantField extends FormField<any, any, any>,
  DiscriminantString extends PropertyKey,
> = ReturnType<DiscriminantField['defaultValue']> extends boolean
  ? 'true' extends DiscriminantString
    ? true
    : 'false' extends DiscriminantString
    ? false
    : never
  : DiscriminantString & string;

export type PreviewPropsForToolbar<Schema extends ComponentSchema> =
  GenericPreviewProps<Schema, undefined>;

export function component<
  Schema extends {
    [Key in any]: ComponentSchema;
  },
>(
  options: {
    /** The preview component shown in the editor */
    preview: (
      props: PreviewProps<ObjectField<Schema>> & { onRemove(): void }
    ) => ReactElement | null;
    /** The schema for the props that the preview component, toolbar and rendered component will receive */
    schema: Schema;
    /** The label to show in the insert menu and chrome around the block if chromeless is false */
    label: string;
    /** An icon to show in the toolbar for this component block. Component blocks with `toolbarIcon` are shown in the toolbar directly instead of the insert menu */
    toolbarIcon?: ReactElement;
  } & (
    | {
        chromeless: true;
        toolbar?:
          | null
          | ((props: {
              props: PreviewPropsForToolbar<ObjectField<Schema>>;
              onRemove(): void;
            }) => ReactElement);
      }
    | {
        chromeless?: false;
        toolbar?: (props: {
          props: PreviewPropsForToolbar<ObjectField<Schema>>;
          onShowEditMode(): void;
          onRemove(): void;
        }) => ReactElement;
      }
  )
): ComponentBlock<Schema> {
  return options as any;
}

type Comp<Props> = (props: Props) => ReactElement | null;

// Recursion-depth guard for DotPathForComponentSchema below. `ComponentSchema`
// is structurally self-referential (an array field's `element`, and an
// object field's `fields` values, are themselves `ComponentSchema`), so the
// *generic*, unconstrained `Schema extends ComponentSchema` case has no
// inherent depth bound. Collapsing straight to a string union (rather than
// staying object-shaped the way ParsedValueForComponentSchema does) makes
// TypeScript evaluate eagerly enough that the unbounded case hits "type
// instantiation excessively deep" even before any real schema is plugged
// in. 8 levels is far deeper than any real content schema nests today (the
// deepest realistic case is array→object→array, 3 levels) — a practical
// ceiling to satisfy the compiler, not a deliberate feature cap.
type Prev = [never, 0, 1, 2, 3, 4, 5, 6, 7];

// Every dot-path string reachable into `Schema` — mirrors
// ParsedValueForComponentSchema's recursion (same branch order/shape) so the
// two stay in sync. A leaf (form/child) has no path past itself: `never`
// there, which a template literal type collapses out of any union it
// appears in (so array-of-text's paths are `${number}` alone, not
// `${number}.${never}`). Path convention is dot-string (not the
// array-shaped ReadonlyPropPath used elsewhere in this package) to match
// dry.item()'s existing data-dry-key convention, its only consumer today.
export type DotPathForComponentSchema<
  Schema extends ComponentSchema,
  Depth extends number = 8,
> = Depth extends 0
  ? never
  : Schema extends ChildField
    ? never
    : Schema extends FormField<any, any, any>
      ? never
      : Schema extends ObjectField<infer Fields>
        ? {
            [Key in keyof Fields & string]:
              | Key
              | `${Key}.${DotPathForComponentSchema<Fields[Key], Prev[Depth]>}`;
          }[keyof Fields & string]
        : Schema extends ConditionalField<infer _DiscriminantField, infer Values>
          ?
              | 'discriminant'
              | 'value'
              | `value.${{
                  [Key in keyof Values]: DotPathForComponentSchema<Values[Key], Prev[Depth]>;
                }[keyof Values]}`
          : Schema extends ArrayField<infer ElementField>
            ? `${number}` | `${number}.${DotPathForComponentSchema<ElementField, Prev[Depth]>}`
            : never;

export type ParsedValueForComponentSchema<Schema extends ComponentSchema> =
  Schema extends ChildField
    ? null
    : Schema extends FormField<infer Value, any, any>
    ? Value
    : Schema extends ObjectField<infer Value>
    ? {
        readonly [Key in keyof Value]: ParsedValueForComponentSchema<
          Value[Key]
        >;
      }
    : Schema extends ConditionalField<infer DiscriminantField, infer Values>
    ? {
        readonly [Key in keyof Values]: {
          readonly discriminant: DiscriminantStringToDiscriminantValue<
            DiscriminantField,
            Key
          >;
          readonly value: ParsedValueForComponentSchema<Values[Key]>;
        };
      }[keyof Values]
    : Schema extends ArrayField<infer ElementField>
    ? readonly ParsedValueForComponentSchema<ElementField>[]
    : never;

export type ValueForReading<Schema extends ComponentSchema> =
  Schema extends ChildField
    ? null
    : Schema extends ContentFormField<any, any, infer Value>
    ? () => Promise<Value>
    : Schema extends BasicFormField<any, any, infer Value>
    ? Value
    : Schema extends SlugFormField<any, any, infer Value, any>
    ? Value
    : Schema extends AssetFormField<any, any, infer Value>
    ? Value
    : Schema extends AssetsFormField<any, any, infer Value>
    ? Value
    : Schema extends ObjectField<infer Value>
    ? {
        readonly [Key in keyof Value]: ValueForReading<Value[Key]>;
      }
    : Schema extends ConditionalField<infer DiscriminantField, infer Values>
    ? {
        readonly [Key in keyof Values]: {
          readonly discriminant: DiscriminantStringToDiscriminantValue<
            DiscriminantField,
            Key
          >;
          readonly value: ValueForReading<Values[Key]>;
        };
      }[keyof Values]
    : Schema extends ArrayField<infer ElementField>
    ? readonly ValueForReading<ElementField>[]
    : never;

export type ValueForReadingDeep<Schema extends ComponentSchema> =
  Schema extends ChildField
    ? null
    : Schema extends FormField<any, any, infer Value>
    ? Value
    : Schema extends ObjectField<infer Value>
    ? {
        readonly [Key in keyof Value]: ValueForReadingDeep<Value[Key]>;
      }
    : Schema extends ConditionalField<infer DiscriminantField, infer Values>
    ? {
        readonly [Key in keyof Values]: {
          readonly discriminant: DiscriminantStringToDiscriminantValue<
            DiscriminantField,
            Key
          >;
          readonly value: ValueForReadingDeep<Values[Key]>;
        };
      }[keyof Values]
    : Schema extends ArrayField<infer ElementField>
    ? readonly ValueForReadingDeep<ElementField>[]
    : never;

export type InferRenderersForComponentBlocks<
  ComponentBlocks extends Record<string, ComponentBlock<any>>,
> = {
  [Key in keyof ComponentBlocks]: Comp<
    ValueForReading<ObjectField<ComponentBlocks[Key]['schema']>>
  >;
};
