import type { Collection, Config, ComponentSchema, Singleton } from '@drystack/core';
import type { EntryWithResolvedLinkedFiles } from '@drystack/core/reader';
import { createConfiguredReader } from './reader';

export type DryItem = { 'data-dry': string };

type SchemaOf<S> = S extends Singleton<infer Schema> ? Schema : never;

export type DrySingleton<
  S extends Singleton<Record<string, ComponentSchema>> = Singleton<
    Record<string, ComponentSchema>
  >,
> = EntryWithResolvedLinkedFiles<S> & {
  item(field: keyof SchemaOf<S> & string): DryItem | {};
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
      const fieldSchema = schema[field];
      // `fields.text` (this fork) reports `kind: 'form', formKind: 'slug'` — the
      // same tag `fields.slug`'s inner name field uses (they share an
      // implementation). Singletons never use `fields.slug`, so this check is
      // unambiguous within dry()'s singleton-only scope.
      const isTextField =
        !!fieldSchema &&
        fieldSchema.kind === 'form' &&
        (fieldSchema as { formKind?: string }).formKind === 'slug';
      if (!isTextField) {
        console.warn(
          `[drystack] dry(): field "${field}" on singleton "${name}" is not fields.text — skipping data-dry attribute.`
        );
        return {};
      }
      return { 'data-dry': `singleton::${name}::${field}` };
    },
  });
  return result;
}
