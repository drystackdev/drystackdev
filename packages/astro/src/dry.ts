import type {
  ArrayField,
  Collection,
  Config,
  ComponentSchema,
  DotPathForComponentSchema,
  ObjectField,
  Singleton,
} from "@drystack/core";
import type { Entry, EntryWithResolvedLinkedFiles } from "@drystack/core/reader";
import { editKey, getSyncableFieldKind, isAssetKind } from "@drystack/core/edit-sync";
import {
  entryRefExists,
  resolveEntryRef,
  type EntryRef,
} from "@drystack/core/path-utils";
import { createConfiguredReader } from "./reader";
import { resolveContentRefsInEntry } from "./content-ref-resolve";
import {
  appendFileSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

export type DryItem = {
  "data-dry": string;
  "data-dry-kind": "text" | "image" | "file" | "array" | "object" | "content";
  // Only ever set for image/file (see isAssetKind below). A 'content' spot
  // deliberately has none: its value *is* its own innerHTML, so duplicating
  // the whole HTML body into an attribute would bloat every page (and, in
  // github mode, the dry-map payload) for nothing. This rule matters even
  // more for a collection than a singleton - do not relax it just because a
  // field now lives per-entry.
  "data-dry-value"?: string;
  // Set only by .view() - marks a spot as a read-only mirror (still live-
  // synced, never made editable). Absent entirely for a .bind() spot, not
  // `false`, so the DOM attribute itself is only ever present when true.
  "data-dry-readonly"?: true;
};

export type DryMapEntry = DryItem;

// Populated as .bind()/.view() resolve spots during `astro build`'s
// prerender pass (storage.kind === 'github' only - see attachEntrySpots
// below), read back whole by the astro:build:done hook in index.ts and
// flushed to a static asset (gated behind GitHub auth by the `github/dry-map`
// route, generic.ts) - so production HTML never carries plaintext
// data-dry/-kind/-value (would leak full field paths/schema to anonymous
// visitors via view-source), only an opaque `data-dry-id`.
//
// Backed by a JSONL file, not just the in-memory Maps below: Astro/Vite loads
// this module as *separate instances* for the page-rendering SSR bundle
// (where .bind()/.view() actually run) and for the integration's own
// astro:build:done hook code, so an in-memory-only registry never reaches the
// hook - confirmed empirically (a first pass using only a Map produced an
// empty registry every time). Both instances do run in the same OS process
// with a real filesystem during prerendering (see reader.ts's
// hasBuildTimeFilesystem), so a file bridges the gap reliably. The in-memory
// Maps are still worth keeping alongside it - they give id numbering/dedup
// *within* a single render pass, which is all one instance handles.
const dryMapRegistry = new Map<string, DryMapEntry>();
const dryIdBySpotKey = new Map<string, string>();
const dryIdCounters = new Map<string, number>();

function dryMapRegistryFilePath(): string {
  return join(process.cwd(), ".astro", "dry-map-registry.jsonl");
}

// Called once per build (astro:config:done, before any page renders) so a
// previous build's entries - which may assign different ids to different
// fields if the schema/pages changed - never leak into this one.
export function resetDryMapRegistryFile(): void {
  dryMapRegistry.clear();
  dryIdBySpotKey.clear();
  dryIdCounters.clear();
  try {
    mkdirSync(join(process.cwd(), ".astro"), { recursive: true });
    writeFileSync(dryMapRegistryFilePath(), "");
  } catch {
    // Best-effort - see persistDryMapEntry below for why this must not throw.
  }
}

// Called once, after all pages have rendered (astro:build:done), to build
// the final id → entry map that gets encrypted and shipped.
export function readDryMapRegistryFile(): Record<string, DryMapEntry> {
  let raw: string;
  try {
    raw = readFileSync(dryMapRegistryFilePath(), "utf8");
  } catch {
    return {};
  }
  const result: Record<string, DryMapEntry> = {};
  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    const { id, entry } = JSON.parse(line) as {
      id: string;
      entry: DryMapEntry;
    };
    result[id] = entry;
  }
  return result;
}

// Swallows fs errors rather than throwing: this runs inline in .bind()/.view(),
// on the hot path of rendering a real page, and a page must still render
// correctly (just without a working editor for this spot until the next
// build) even if, say, .astro/ isn't writable for some reason.
function persistDryMapEntry(id: string, entry: DryMapEntry) {
  try {
    mkdirSync(join(process.cwd(), ".astro"), { recursive: true });
    appendFileSync(
      dryMapRegistryFilePath(),
      JSON.stringify({ id, entry }) + "\n",
    );
  } catch {
    // See above.
  }
}

// `name` is the singleton or collection name - never the full entry ref key -
// so a 100-slug collection with 8 bound fields still gets short ids like
// `d:blog:137` instead of `d:collection::blog::<slug>:137`. The id string is
// duplicated into every bound element's HTML *and* into every dry-map JSON
// key, so this matters for real payload size; dedup already happens on the
// full `data-dry` (which does carry the slug) via dryIdBySpotKey, so two
// different slugs' same-named field can never collide on an id.
function getOrCreateDryId(name: string, entry: DryMapEntry): string {
  // A .bind() and a .view() of the *same* field share `data-dry` but must
  // never share an id - they carry different data-dry-readonly - so the
  // dedup key folds that in too. Two .bind()s (or two .view()s) of the same
  // field still collapse to one id, same as before.
  const spotKey = `${entry["data-dry"]}::${entry["data-dry-readonly"] ? "view" : "bind"}`;
  const existing = dryIdBySpotKey.get(spotKey);
  if (existing) return existing;
  const n = dryIdCounters.get(name) ?? 0;
  dryIdCounters.set(name, n + 1);
  const id = `d:${name}:${n}`;
  dryIdBySpotKey.set(spotKey, id);
  dryMapRegistry.set(id, entry);
  persistDryMapEntry(id, entry);
  return id;
}

type SchemaOf<S> = S extends Collection<infer Schema, any>
  ? Schema
  : S extends Singleton<infer Schema>
    ? Schema
    : never;

// Every valid dry.bind()/dry.view() path into a singleton/collection-entry -
// one segment per top-level field, recursing into each field's own shape via
// DotPathForComponentSchema (form/api.tsx) so array-of-object,
// object-of-object, array-of-array, etc. all get real autocomplete/type-
// checking here. attachEntrySpots()'s bind()/view() below (via
// resolveDrySpot) walk the schema the same way at runtime, so every path this
// type accepts actually resolves - see plan/de-quy-object.md.
type DryFieldPath<S> = {
  [Key in keyof SchemaOf<S> & string]:
    | Key
    | `${Key}.${DotPathForComponentSchema<SchemaOf<S>[Key]>}`;
}[keyof SchemaOf<S> & string];

// What .bind()/.view() actually return: the spread-able DOM attrs (or, in
// github mode, the opaque id stand-in - see attachEntrySpots) plus a non-
// enumerable `value()` so `{...demo.bind('name')}` never renders a stray
// `value` attribute - object spread only copies own *enumerable* props, and
// Object.defineProperty defaults to non-enumerable.
export type DryBoundSpot = (DryItem | { "data-dry-id": string } | {}) & {
  value(): unknown;
};

export type DrySingleton<
  S extends Singleton<Record<string, ComponentSchema>> = Singleton<
    Record<string, ComponentSchema>
  >,
> = EntryWithResolvedLinkedFiles<S> & {
  bind(field: DryFieldPath<S>): DryBoundSpot;
  // Read-only mirror of the same field - never made editable (no
  // contentEditable, no asset picker, no container dialog, no ProseMirror
  // mount - see bind.ts/Toolbar.tsx/InlineContentEditors.tsx), but still
  // live-synced: it carries the same `data-dry` key as any .bind() of the
  // same field, so every existing paint path (which matches by key, not by
  // an "is this the editable one" flag) already reaches it for free.
  view(field: DryFieldPath<S>): DryBoundSpot;
};

// `Resolved` mirrors the reader's own resolveLinkedFiles distinction
// (reader/generic.ts's EntryWithResolvedLinkedFiles vs Entry) rather than
// re-deriving a per-field conditional type from scratch - `Entry`/
// `EntryWithResolvedLinkedFiles` are the two shapes the reader already
// exports, and dry.collection(name).all()/.entry() only ever request one or
// the other as a whole, never a per-field mix. `false` deliberately reuses
// the reader's own (pre-existing, upstream) inaccuracy for content fields -
// `Entry<C>` types an unresolved content leaf as `string` when the runtime
// value is actually `() => Promise<string>` (fields.content is declared as
// AssetsFormField, not ContentFormField, so ValueForReading's content-thunk
// branch never matches it) - attachEntrySpots below guards against this at
// runtime rather than trying to fix the reader's type system.
export type DryEntry<
  C extends Collection<any, any>,
  Resolved extends boolean = true,
> = (Resolved extends true ? EntryWithResolvedLinkedFiles<C> : Entry<C>) & {
  slug: string;
  bind(field: DryFieldPath<C>): DryBoundSpot;
  view(field: DryFieldPath<C>): DryBoundSpot;
};

type DryEntryReaderOpts = { resolveLinkedFiles?: boolean };

type ResolvedFlag<Opts extends DryEntryReaderOpts | undefined> =
  Opts extends { resolveLinkedFiles: true } ? true : false;

// The handle returned by dry.collection(name) - synchronous (not a promise)
// so it can be hoisted out of a loop/passed as a prop, mirroring
// reader.collections[name]'s own surface so there's no new shape to learn.
export type DryCollectionHandle<C extends Collection<any, any>> = {
  // Default resolveLinkedFiles: false, matching a listing page's needs (don't
  // fetch every entry's body.html just to render title/excerpt/cover cards) -
  // see the ⚠️ comment on attachEntrySpots for what an unresolved content
  // field's spot does when bound anyway.
  all<Opts extends [opts?: DryEntryReaderOpts]>(
    ...opts: Opts
  ): Promise<Record<string, DryEntry<C, ResolvedFlag<Opts[0]>>>>;
  // Always resolves - this is the detail-page API, and a detail page always
  // needs the body. Returns null when the slug doesn't exist (matches
  // reader.collections[name].read, and callers already check-then-redirect).
  entry(slug: string): Promise<DryEntry<C, true> | null>;
  // Slugs only, no entry reads at all - what getStaticPaths actually needs.
  list(): Promise<string[]>;
};

/**
 * Server-side helper for visual DOM editing.
 *
 * Usage:
 *   const dry = createDry(config);
 *   const home = await dry.singleton('home');
 *   <h1 {...home.bind('heading')}>{home.bind('heading').value()}</h1>
 *
 *   const posts = await dry.collection('blog').all();
 *   const post = await dry.collection('blog').entry(slug);
 *   <h1 {...post.bind('title')}>{post.bind('title').value()}</h1>
 *
 * Safe to construct once and share across the whole app (e.g. one shared
 * module-level instance imported everywhere) - neither .singleton() nor
 * .collection(name).all()/.entry() cache a resolved value across calls, so
 * sharing the returned object only shares the (stateless) reader wiring,
 * never stale content. See createConfiguredReader.
 */
export function createDry<
  Collections extends {
    [key: string]: Collection<Record<string, ComponentSchema>, string>;
  },
  Singletons extends {
    [key: string]: Singleton<Record<string, ComponentSchema>>;
  },
>(
  config: Config<Collections, Singletons>,
): {
  singleton<Name extends keyof Singletons & string>(
    name: Name,
  ): Promise<DrySingleton<Singletons[Name]>>;
  collection<Name extends keyof Collections & string>(
    name: Name,
  ): DryCollectionHandle<Collections[Name]>;
} {
  const readerPromise = createConfiguredReader(config);
  return {
    async singleton(name) {
      const reader = await readerPromise;
      const entry = await readEntry(config, reader, {
        type: "singleton",
        name,
      });
      return entry as any;
    },
    collection(name) {
      return {
        async all(...opts: [opts?: DryEntryReaderOpts]) {
          const reader = await readerPromise;
          const resolveLinkedFiles = opts[0]?.resolveLinkedFiles ?? false;
          const items =
            (await (reader.collections as any)[name]?.all({
              resolveLinkedFiles,
            })) ?? [];
          const out: Record<string, unknown> = {};
          for (const { slug, entry } of items as {
            slug: string;
            entry: Record<string, unknown>;
          }[]) {
            out[slug] = await attachEntrySpots(
              config,
              reader,
              { type: "collection", name, slug },
              entry,
            );
          }
          return out;
        },
        async entry(slug: string) {
          const reader = await readerPromise;
          return readEntry(config, reader, { type: "collection", name, slug });
        },
        async list() {
          const reader = await readerPromise;
          return (
            ((await (reader.collections as any)[name]?.list()) as
              | string[]
              | undefined) ?? []
          );
        },
      } as any;
    },
  };
}

// fields.image/fields.file store `string | null`. Rendered into
// `data-dry-value` so bind.ts's readSpotValue (editor/bind.ts) never has to
// fall back to the element's native src/href to know the real value - a page
// author's own placeholder markup for the "empty" case (e.g. `href={obj.file
// ?? '#'}`, see Demo.astro) would otherwise be misread as a real, selected
// file. Always a string (never undefined) so the attribute is present even
// when empty, matching how bind.ts paints it after a client-side edit.
function assetValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function describeRef(ref: EntryRef): string {
  return ref.type === "singleton"
    ? `singleton "${ref.name}"`
    : `"${ref.slug}" in collection "${ref.name}"`;
}

// Resolves one dry.bind()/dry.view() path against `schema`/`value` in
// lockstep, recursing one path segment at a time - an array segment is a
// numeric index into `schema.element`, an object segment is a field name
// into `schema.fields`. Landing exactly on a leaf (text/image/file/content)
// or a container (array/object) with no segments left returns its kind + its
// current value - the caller decides which kinds actually put `value` into a
// DOM attribute (only asset kinds do, see isAssetKind below); a container's
// value is still returned here so `.value()` works on it too, even though
// bind.ts only ever treats the container spot itself as a structural marker
// (never contentEditable - see bind.ts's isContainerSpot). `getSyncableFieldKind`
// is the single source of truth both branches share for "is this schema
// syncable at all" (edit-sync.ts). Entirely schema-shape-driven - identical
// for a singleton's own schema and a collection entry's schema.
function resolveDrySpot(
  schema: ComponentSchema | undefined,
  value: unknown,
  segments: string[],
): { kind: DryItem["data-dry-kind"]; value: unknown } | undefined {
  if (!schema) return undefined;
  if (segments.length === 0) {
    const kind = getSyncableFieldKind(schema);
    if (!kind) return undefined;
    return { kind, value };
  }
  const [seg, ...rest] = segments;
  if (schema.kind === "array") {
    const idx = Number(seg);
    if (!Number.isInteger(idx) || idx < 0) return undefined;
    const items = Array.isArray(value) ? value : [];
    return resolveDrySpot(
      (schema as ArrayField<ComponentSchema>).element,
      items[idx],
      rest,
    );
  }
  if (schema.kind === "object") {
    const fields = (schema as ObjectField).fields;
    const subValue =
      value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)[seg]
        : undefined;
    return resolveDrySpot(fields[seg], subValue, rest);
  }
  return undefined; // form/child fields have no further path to walk.
}

// Attaches bind()/view() (and, for a collection entry, its slug) to an
// already-read entry object. Split out from readEntry below so
// dry.collection(name).all() can decorate every item from its single batched
// reader.collections[name].all() call instead of re-reading each slug one at
// a time (see readEntry's own doc comment for why that re-read would be
// O(n²) in Astro).
async function attachEntrySpots(
  config: Config<any, any>,
  reader: Awaited<ReturnType<typeof createConfiguredReader>>,
  ref: EntryRef,
  entry: Record<string, unknown>,
): Promise<
  DrySingleton | DryEntry<Collection<Record<string, ComponentSchema>, string>>
> {
  const schema = resolveEntryRef(config, ref).schema;
  // Mutates a copy of `entry`'s own top-level content fields in place before
  // anything below reads them, so both the plain prop and .bind()/.view()'s
  // .value() see whatever a content_ref node currently points at - never a
  // value cached from whenever the reference was inserted.
  const entryWithResolvedRefs = { ...entry };
  await resolveContentRefsInEntry(config, reader, schema, entryWithResolvedRefs);
  const result: Record<string, unknown> = { ...entryWithResolvedRefs };

  if (ref.type === "collection") {
    // parseWithSlug (form/fields/slug/index.tsx) discards the slug half on
    // read - the entry only ever carries the human-readable `name` half
    // under its slugField key - so the slug itself would otherwise be
    // unreachable from a DryEntry. Enumerable (unlike bind/view below) so
    // `{...entry}` carries it through like every other field.
    if ("slug" in schema) {
      console.warn(
        `[drystack] dry(): collection "${ref.name}" has a field named "slug", which shadows DryEntry's own injected slug property - the schema's value wins.`,
      );
    } else {
      result.slug = ref.slug;
    }
  }

  // Attaches a non-enumerable `value()` to `attrs` so it survives an
  // `{...}` spread untouched (spread only copies own-enumerable props) while
  // still being callable as `demo.bind('name').value()`.
  function withValue<T extends object>(
    attrs: T,
    value: unknown,
  ): T & { value(): unknown } {
    Object.defineProperty(attrs, "value", {
      enumerable: false,
      value: () => value,
    });
    return attrs as T & { value(): unknown };
  }

  // Shared by bind()/view() - resolves `field` against the schema/entry and
  // builds its DOM attrs, differing only in whether `data-dry-readonly` is
  // set. Shared with the admin's edit-sync effects (SingletonPage.tsx,
  // useEntryEditSync) so both surfaces recognize the same fields the same
  // way. Any path DotPathForComponentSchema type-checks resolves here - flat
  // fields, any depth of fields.array/fields.object nesting (array-of-object,
  // object-of-array, array-of-object-of-array, a standalone top-level
  // fields.object, …) - see plan/de-quy-object.md.
  function makeSpot(field: string, readonly: boolean) {
    const [baseField, ...rest] = field.split(".");
    const baseSchema = schema[baseField];
    const resolved = resolveDrySpot(baseSchema, entry[baseField], rest);
    if (!resolved) {
      console.warn(
        `[drystack] dry(): "${field}" on ${describeRef(ref)} could not be resolved against the schema - skipping data-dry attribute.`,
      );
      return withValue({}, undefined);
    }
    // An unresolved fields.content/fields.assets leaf (see readItem,
    // reader/generic.ts) is a deferred `() => Promise<string>` thunk, never
    // awaited unless the caller passed resolveLinkedFiles: true. Only a
    // content-shaped leaf can ever be a function here - text/image/file
    // always resolve to strings, array/object always resolve to real
    // structures - so this check is unambiguous.
    if (typeof resolved.value === "function") {
      console.warn(
        `[drystack] dry(): "${field}" on ${describeRef(ref)} is an unresolved content field - call .all({ resolveLinkedFiles: true }) or .entry(slug) to bind it. Skipping data-dry attribute.`,
      );
      return withValue({}, undefined);
    }
    // fields.text and fields.slug both report getSyncableFieldKind() ===
    // "text" (they share formKind: 'slug' - see edit-sync.ts's comment on
    // getSyncableFieldKind), so `.slugify` (only fields.slug exposes it) is
    // the real discriminator. A fields.slug used somewhere other than its
    // collection's declared slugField is read back as a `{name, slug}`
    // object, not a plain string - binding it as text and later saving a bare
    // string would corrupt that shape. The collection's actual slugField IS
    // safe to bind: makeSpot's caller (save.ts's validateField) reconstructs
    // the {name, slug} pair before validating, and only that field's `name`
    // half is ever written back (see the plan's slugField handling).
    if (
      resolved.kind === "text" &&
      typeof (baseSchema as { slugify?: unknown })?.slugify === "function"
    ) {
      const declaredSlugField =
        ref.type === "collection"
          ? config.collections![ref.name].slugField
          : undefined;
      if (baseField !== declaredSlugField) {
        console.warn(
          `[drystack] dry(): "${field}" on ${describeRef(ref)} is a fields.slug not used as its collection's slugField - binding it as plain text would corrupt its {name, slug} shape on save. Skipping data-dry attribute.`,
        );
        return withValue({}, undefined);
      }
    }
    const attrs: DryItem = {
      "data-dry": editKey(ref, field),
      "data-dry-kind": resolved.kind,
    };
    if (isAssetKind(resolved.kind)) {
      attrs["data-dry-value"] = assetValue(resolved.value);
    }
    if (readonly) attrs["data-dry-readonly"] = true;
    return withValue(attrs, resolved.value);
  }

  Object.defineProperty(result, "bind", {
    enumerable: false,
    value: (field: string) => makeSpot(field, false),
  });
  Object.defineProperty(result, "view", {
    enumerable: false,
    value: (field: string) => makeSpot(field, true),
  });
  return result as any;
}

// Reads one entry (singleton, or one collection slug) and decorates it with
// bind()/view(). Always requests resolveLinkedFiles: true - readItem's
// `cache()` wrapper (reader/generic.ts) resolves to a no-op outside a React
// Server context (#react-cache-in-react-server → noop-cache.ts), so nothing
// in Astro memoizes a read; calling dry.collection(name).all() from a detail
// page just to find one slug would re-read (and re-stat) every entry in the
// collection on every request. Use this (via .entry()) instead.
async function readEntry(
  config: Config<any, any>,
  reader: Awaited<ReturnType<typeof createConfiguredReader>>,
  ref: EntryRef,
): Promise<Awaited<ReturnType<typeof attachEntrySpots>> | null> {
  if (!entryRefExists(config, ref)) return null;
  if (ref.type === "singleton") {
    const entry =
      ((await (reader.singletons as any)[ref.name]?.read({
        resolveLinkedFiles: true,
      })) as Record<string, unknown> | null | undefined) ?? {};
    return attachEntrySpots(config, reader, ref, entry);
  }
  const entry = (await (reader.collections as any)[ref.name]?.read(ref.slug, {
    resolveLinkedFiles: true,
  })) as Record<string, unknown> | null | undefined;
  if (entry == null) return null;
  return attachEntrySpots(config, reader, ref, entry);
}
