import type { Collection, Config, ComponentSchema, Singleton } from '@drystack/core';
import type { EntryWithResolvedLinkedFiles } from '@drystack/core/reader';
import { getSyncableFieldKind } from '@drystack/core/edit-sync';
import { createConfiguredReader } from './reader';

export type DryItem = {
  'data-dry': string;
  'data-dry-kind': 'text' | 'image' | 'file' | 'array' | 'object';
};

type SchemaOf<S> = S extends Singleton<infer Schema> ? Schema : never;

// Plain field ("heading"), one level into a fields.array ("array.0" — a
// primitive item or an object-item wrapper), or one level deeper into an
// array-of-object item's sub-field ("cards.0.title") — the path shapes
// readSingleton()'s item() supports, see dry.ts.
type DryFieldPath<S> =
  | (keyof SchemaOf<S> & string)
  | `${keyof SchemaOf<S> & string}.${number}`
  | `${keyof SchemaOf<S> & string}.${number}.${string}`;

export type DrySingleton<
  S extends Singleton<Record<string, ComponentSchema>> = Singleton<
    Record<string, ComponentSchema>
  >,
> = EntryWithResolvedLinkedFiles<S> & {
  item(field: DryFieldPath<S>): DryItem | {};
};

/**
 * Server-side helper for MVP 1 of visual DOM editing.
 * Only `singleton` + `fields.text` are supported — see plan.md.
 *
 * Usage:
 *   const d = await dry(config).singleton.home;
 *   <h1 {...d.item('heading')}>{d.heading}</h1>
 */
export function dry<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
>(
  config: Config<Collections, Singletons>
): {
  singleton: { [Name in keyof Singletons]: Promise<DrySingleton<Singletons[Name]>> };
} {
  const readerPromise = createConfiguredReader(config);
  const singleton = {} as {
    [Name in keyof Singletons]: Promise<DrySingleton<Singletons[Name]>>;
  };
  for (const name of Object.keys(config.singletons ?? {})) {
    let promise: Promise<DrySingleton> | undefined;
    Object.defineProperty(singleton, name, {
      enumerable: true,
      get: () =>
        (promise ??= readerPromise.then(reader =>
          readSingleton(config, reader, name)
        )),
    });
  }
  return { singleton };
}

async function readSingleton(
  config: Config<any, any>,
  reader: Awaited<ReturnType<typeof createConfiguredReader>>,
  name: string
): Promise<DrySingleton> {
  const entry = ((await (reader.singletons as any)[name]?.read({
    resolveLinkedFiles: true,
  })) ?? {}) as Record<string, unknown>;
  const schema = config.singletons![name].schema as Record<
    string,
    ComponentSchema
  >;
  const result: DrySingleton = { ...entry } as DrySingleton;
  Object.defineProperty(result, 'item', {
    enumerable: false,
    value(field: string) {
      // Shared with the admin's edit-sync effects (SingletonPage.tsx) so both
      // surfaces recognize the same fields the same way. Supported path shapes:
      // flat top-level fields.text ('slug' formKind), fields.image ('image'
      // columnKind), fields.file ('file' columnKind), fields.array; one level
      // into an array ("array.0" — a primitive item or an array-of-object item
      // wrapper); and one level deeper into an array-of-object item's
      // sub-field ("cards.0.title"). See plan/vei-array-object.md.
      const [baseField, ...rest] = field.split('.');
      const baseSchema = schema[baseField];

      if (rest.length === 0) {
        const kind = getSyncableFieldKind(baseSchema);
        if (!kind) {
          console.warn(
            `[drystack] dry(): field "${field}" on singleton "${name}" is not fields.text, fields.image, fields.file, or fields.array — skipping data-dry attribute.`
          );
          return {};
        }
        return { 'data-dry': `singleton::${name}::${field}`, 'data-dry-kind': kind };
      }

      // Nested paths only index into a fields.array (one item deep, then at
      // most one sub-field deeper for array-of-object).
      if ((rest.length !== 1 && rest.length !== 2) || baseSchema?.kind !== 'array') {
        console.warn(
          `[drystack] dry(): "${field}" on singleton "${name}" is not a supported array item path — skipping data-dry attribute.`
        );
        return {};
      }
      const element = (baseSchema as { element: ComponentSchema }).element;

      // "array.N" — a single item. A primitive element (fields.text/image/file)
      // gets that element's kind and is edited inline; an object element marks
      // the item *wrapper* ('object' kind, a structural marker used by
      // bind.ts's template-clone, not itself contentEditable).
      if (rest.length === 1) {
        const elementKind = getSyncableFieldKind(element);
        if (elementKind === 'text' || elementKind === 'image' || elementKind === 'file') {
          return {
            'data-dry': `singleton::${name}::${field}`,
            'data-dry-kind': elementKind,
          };
        }
        if (element.kind === 'object') {
          return { 'data-dry': `singleton::${name}::${field}`, 'data-dry-kind': 'object' };
        }
        console.warn(
          `[drystack] dry(): array "${baseField}" on singleton "${name}" is not an array of fields.text, fields.image, fields.file, or fields.object — skipping data-dry attribute.`
        );
        return {};
      }

      // "array.N.sub" — a sub-field of an array-of-object item. The element
      // must be a fields.object and the sub-field itself a fields.text/image/file.
      if (element.kind !== 'object') {
        console.warn(
          `[drystack] dry(): "${field}" on singleton "${name}" indexes a sub-field but array "${baseField}" is not an array of fields.object — skipping data-dry attribute.`
        );
        return {};
      }
      const subField = rest[1];
      const subKind = getSyncableFieldKind(
        (element as { fields: Record<string, ComponentSchema> }).fields[subField]
      );
      if (subKind !== 'text' && subKind !== 'image' && subKind !== 'file') {
        console.warn(
          `[drystack] dry(): sub-field "${subField}" of "${baseField}" on singleton "${name}" is not fields.text, fields.image, or fields.file — skipping data-dry attribute.`
        );
        return {};
      }
      return { 'data-dry': `singleton::${name}::${field}`, 'data-dry-kind': subKind };
    },
  });
  return result;
}
