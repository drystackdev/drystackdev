import type {
  ArrayField,
  Collection,
  Config,
  ComponentSchema,
  DotPathForComponentSchema,
  ObjectField,
  Singleton,
} from "@drystack/core";
import type { EntryWithResolvedLinkedFiles } from "@drystack/core/reader";
import { getSyncableFieldKind, isAssetKind } from "@drystack/core/edit-sync";
import { createConfiguredReader } from "./reader";
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
  // github mode, the dry-map payload) for nothing.
  "data-dry-value"?: string;
  // Set only by .view() - marks a spot as a read-only mirror (still live-
  // synced, never made editable). Absent entirely for a .bind() spot, not
  // `false`, so the DOM attribute itself is only ever present when true.
  "data-dry-readonly"?: true;
};

export type DryMapEntry = DryItem;

// Populated as .bind()/.view() resolve spots during `astro build`'s
// prerender pass (storage.kind === 'github' only - see readSingleton below),
// read back whole by the astro:build:done hook in index.ts and flushed to a
// static asset (gated behind GitHub auth by the `github/dry-map` route,
// generic.ts) - so production HTML never carries plaintext
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

function getOrCreateDryId(singletonName: string, entry: DryMapEntry): string {
  // A .bind() and a .view() of the *same* field share `data-dry` but must
  // never share an id - they carry different data-dry-readonly - so the
  // dedup key folds that in too. Two .bind()s (or two .view()s) of the same
  // field still collapse to one id, same as before.
  const spotKey = `${entry["data-dry"]}::${entry["data-dry-readonly"] ? "view" : "bind"}`;
  const existing = dryIdBySpotKey.get(spotKey);
  if (existing) return existing;
  const n = dryIdCounters.get(singletonName) ?? 0;
  dryIdCounters.set(singletonName, n + 1);
  const id = `d:${singletonName}:${n}`;
  dryIdBySpotKey.set(spotKey, id);
  dryMapRegistry.set(id, entry);
  persistDryMapEntry(id, entry);
  return id;
}

type SchemaOf<S> = S extends Singleton<infer Schema> ? Schema : never;

// Every valid dry.bind()/dry.view() path into a singleton - one segment per
// top-level field, recursing into each field's own shape via
// DotPathForComponentSchema (form/api.tsx) so array-of-object,
// object-of-object, array-of-array, etc. all get real autocomplete/type-
// checking here. readSingleton()'s bind()/view() below (via resolveDrySpot)
// walk the schema the same way at runtime, so every path this type accepts
// actually resolves - see plan/de-quy-object.md.
type DryFieldPath<S> = {
  [Key in keyof SchemaOf<S> & string]:
    | Key
    | `${Key}.${DotPathForComponentSchema<SchemaOf<S>[Key]>}`;
}[keyof SchemaOf<S> & string];

// What .bind()/.view() actually return: the spread-able DOM attrs (or, in
// github mode, the opaque id stand-in - see readSingleton) plus a non-
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

/**
 * Server-side helper for visual DOM editing.
 *
 * Usage:
 *   const dry = createDry(config);
 *   const home = await dry.singleton('home');
 *   <h1 {...home.bind('heading')}>{home.bind('heading').value()}</h1>
 *
 * Safe to construct once and share across the whole app (e.g. one shared
 * module-level instance imported everywhere) - .singleton() never caches a
 * resolved value across calls, so sharing the returned object only shares
 * the (stateless) reader wiring, never stale content. See createConfiguredReader.
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
} {
  const readerPromise = createConfiguredReader(config);
  return {
    async singleton(name) {
      const reader = await readerPromise;
      return readSingleton(config, reader, name) as any;
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
// syncable at all" (edit-sync.ts).
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

async function readSingleton(
  config: Config<any, any>,
  reader: Awaited<ReturnType<typeof createConfiguredReader>>,
  name: string,
): Promise<DrySingleton> {
  const entry = ((await (reader.singletons as any)[name]?.read({
    resolveLinkedFiles: true,
  })) ?? {}) as Record<string, unknown>;
  const schema = config.singletons![name].schema as Record<
    string,
    ComponentSchema
  >;
  const result: DrySingleton = { ...entry } as DrySingleton;

  // Attaches a non-enumerable `value()` to `attrs` so it survives an
  // `{...}` spread untouched (spread only copies own-enumerable props) while
  // still being callable as `demo.bind('name').value()`.
  function withValue<T extends object>(attrs: T, value: unknown): T & { value(): unknown } {
    Object.defineProperty(attrs, "value", {
      enumerable: false,
      value: () => value,
    });
    return attrs as T & { value(): unknown };
  }

  // Shared by bind()/view() - resolves `field` against the schema/entry and
  // builds its DOM attrs, differing only in whether `data-dry-readonly` is
  // set. Shared with the admin's edit-sync effects (SingletonPage.tsx) so
  // both surfaces recognize the same fields the same way. Any path
  // DotPathForComponentSchema type-checks resolves here - flat fields, any
  // depth of fields.array/fields.object nesting (array-of-object,
  // object-of-array, array-of-object-of-array, a standalone top-level
  // fields.object, …) - see plan/de-quy-object.md.
  function makeSpot(field: string, readonly: boolean) {
    const [baseField, ...rest] = field.split(".");
    const resolved = resolveDrySpot(schema[baseField], entry[baseField], rest);
    if (!resolved) {
      console.warn(
        `[drystack] dry(): "${field}" on singleton "${name}" could not be resolved against the schema - skipping data-dry attribute.`,
      );
      return withValue({}, undefined);
    }
    const attrs: DryItem = {
      "data-dry": `singleton::${name}::${field}`,
      "data-dry-kind": resolved.kind,
    };
    if (isAssetKind(resolved.kind)) {
      attrs["data-dry-value"] = assetValue(resolved.value);
    }
    if (readonly) attrs["data-dry-readonly"] = true;
    // GitHub-mode pages are statically prerendered and served byte-identical
    // to every visitor - emitting the real attrs would bake the full field
    // path/kind/value into public production HTML. Route them through an
    // opaque id instead; the real attrs are only handed back, post-auth, by
    // the dry-map API route (see generic.ts) and patched onto the DOM by
    // the editor client. Local mode never ships to production (confirmed
    // dev-only), so it keeps the direct/legible attrs.
    if (config.storage.kind === "github") {
      return withValue(
        { "data-dry-id": getOrCreateDryId(name, attrs) },
        resolved.value,
      );
    }
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
  return result;
}
