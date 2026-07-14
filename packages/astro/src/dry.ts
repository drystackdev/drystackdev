import type { Collection, Config, ComponentSchema, Singleton } from '@drystack/core';
import type { EntryWithResolvedLinkedFiles } from '@drystack/core/reader';
import { getSyncableFieldKind } from '@drystack/core/edit-sync';
import { createConfiguredReader } from './reader';

export type DryItem = {
  'data-dry': string;
  'data-dry-kind': 'text' | 'image' | 'array';
};

type SchemaOf<S> = S extends Singleton<infer Schema> ? Schema : never;

// Plain field ("heading") or one level into a fields.array ("array.0") — the
// two path shapes readSingleton()'s item() actually supports, see dry.ts.
type DryFieldPath<S> =
  | (keyof SchemaOf<S> & string)
  | `${keyof SchemaOf<S> & string}.${number}`;

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
      // surfaces recognize the same fields the same way. MVP scope: flat
      // top-level fields.text ('slug' formKind), fields.image ('image'
      // columnKind), and fields.array of a fields.text or fields.image
      // element (one path segment deeper, e.g. "array.0") — see
      // plan/vei-array-object.md.
      const [baseField, ...rest] = field.split('.');
      const baseSchema = schema[baseField];

      if (rest.length === 0) {
        const kind = getSyncableFieldKind(baseSchema);
        if (!kind) {
          console.warn(
            `[drystack] dry(): field "${field}" on singleton "${name}" is not fields.text, fields.image, or fields.array — skipping data-dry attribute.`
          );
          return {};
        }
        return { 'data-dry': `singleton::${name}::${field}`, 'data-dry-kind': kind };
      }

      // Nested path — MVP only supports one level deep, indexing into a
      // fields.array whose element is itself fields.text or fields.image
      // (array-of-object is deferred, see plan).
      if (rest.length !== 1 || !baseSchema || baseSchema.kind !== 'array') {
        console.warn(
          `[drystack] dry(): "${field}" on singleton "${name}" is not a supported array item path — skipping data-dry attribute.`
        );
        return {};
      }
      const elementKind = getSyncableFieldKind(
        (baseSchema as { element: ComponentSchema }).element
      );
      if (elementKind !== 'text' && elementKind !== 'image') {
        console.warn(
          `[drystack] dry(): array "${baseField}" on singleton "${name}" is not an array of fields.text or fields.image — array-of-object item editing isn't supported yet.`
        );
        return {};
      }
      return { 'data-dry': `singleton::${name}::${field}`, 'data-dry-kind': elementKind };
    },
  });
  return result;
}
