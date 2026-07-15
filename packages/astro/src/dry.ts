import type {
  ArrayField,
  Collection,
  Config,
  ComponentSchema,
  DotPathForComponentSchema,
  ObjectField,
  Singleton,
} from '@drystack/core';
import type { EntryWithResolvedLinkedFiles } from '@drystack/core/reader';
import { getSyncableFieldKind, isAssetKind } from '@drystack/core/edit-sync';
import { createConfiguredReader } from './reader';

export type DryItem = {
  'data-dry': string;
  'data-dry-kind': 'text' | 'image' | 'file' | 'array' | 'object';
  'data-dry-value'?: string;
};

type SchemaOf<S> = S extends Singleton<infer Schema> ? Schema : never;

// Every valid dry.item() path into a singleton — one segment per top-level
// field, recursing into each field's own shape via DotPathForComponentSchema
// (form/api.tsx) so array-of-object, object-of-object, array-of-array, etc.
// all get real autocomplete/type-checking here. readSingleton()'s item()
// below (via resolveDrySpot) walks the schema the same way at runtime, so
// every path this type accepts actually resolves — see plan/de-quy-object.md.
type DryFieldPath<S> = {
  [Key in keyof SchemaOf<S> & string]:
    | Key
    | `${Key}.${DotPathForComponentSchema<SchemaOf<S>[Key]>}`;
}[keyof SchemaOf<S> & string];

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

// fields.image/fields.file store `string | null`. Rendered into
// `data-dry-value` so bind.ts's readSpotValue (editor/bind.ts) never has to
// fall back to the element's native src/href to know the real value — a page
// author's own placeholder markup for the "empty" case (e.g. `href={obj.file
// ?? '#'}`, see Demo.astro) would otherwise be misread as a real, selected
// file. Always a string (never undefined) so the attribute is present even
// when empty, matching how bind.ts paints it after a client-side edit.
function assetValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

// Resolves one dry.item() path against `schema`/`value` in lockstep,
// recursing one path segment at a time — an array segment is a numeric
// index into `schema.element`, an object segment is a field name into
// `schema.fields`. Landing exactly on a leaf (text/image/file) with no
// segments left returns its kind + current value; landing on a container
// (array/object) with no segments left returns just its kind, a structural
// marker bind.ts uses to know a container spot's own boundaries (never
// contentEditable itself — see bind.ts's isContainerSpot) without needing a
// value of its own. `getSyncableFieldKind` is the single source of truth
// both branches share for "is this schema syncable at all" (edit-sync.ts).
function resolveDrySpot(
  schema: ComponentSchema | undefined,
  value: unknown,
  segments: string[]
): { kind: DryItem['data-dry-kind']; value?: unknown } | undefined {
  if (!schema) return undefined;
  if (segments.length === 0) {
    const kind = getSyncableFieldKind(schema);
    if (!kind) return undefined;
    if (kind === 'array' || kind === 'object') return { kind };
    return { kind, value };
  }
  const [seg, ...rest] = segments;
  if (schema.kind === 'array') {
    const idx = Number(seg);
    if (!Number.isInteger(idx) || idx < 0) return undefined;
    const items = Array.isArray(value) ? value : [];
    return resolveDrySpot((schema as ArrayField<ComponentSchema>).element, items[idx], rest);
  }
  if (schema.kind === 'object') {
    const fields = (schema as ObjectField).fields;
    const subValue =
      value && typeof value === 'object' && !Array.isArray(value)
        ? (value as Record<string, unknown>)[seg]
        : undefined;
    return resolveDrySpot(fields[seg], subValue, rest);
  }
  return undefined; // form/child fields have no further path to walk.
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
      // surfaces recognize the same fields the same way. Any path
      // DotPathForComponentSchema type-checks resolves here — flat fields,
      // any depth of fields.array/fields.object nesting (array-of-object,
      // object-of-array, array-of-object-of-array, a standalone top-level
      // fields.object, …) — see plan/de-quy-object.md.
      const [baseField, ...rest] = field.split('.');
      const resolved = resolveDrySpot(schema[baseField], entry[baseField], rest);
      if (!resolved) {
        console.warn(
          `[drystack] dry(): "${field}" on singleton "${name}" could not be resolved against the schema — skipping data-dry attribute.`
        );
        return {};
      }
      const attrs: DryItem = {
        'data-dry': `singleton::${name}::${field}`,
        'data-dry-kind': resolved.kind,
      };
      if (isAssetKind(resolved.kind)) {
        attrs['data-dry-value'] = assetValue(resolved.value);
      }
      return attrs;
    },
  });
  return result;
}
