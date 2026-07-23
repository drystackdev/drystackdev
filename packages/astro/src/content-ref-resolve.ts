import type { Config, ComponentSchema } from "@drystack/core";
import { REDIRECTS_SINGLETON_KEY } from "@drystack/core";
import { parseEditKey } from "@drystack/core/edit-sync";
import type { EntryRef } from "@drystack/core/path-utils";
import { listTopLevelContentFields } from "@drystack/core/content-is-content-field";
import {
  parseRedirectEntries,
  resolveRedirectSingleHop,
  urlForSlugFromPreviewUrl,
  slugFromPreviewUrlMatch,
} from "@drystack/core/redirects";
import type { createConfiguredReader } from "./reader";

type Reader = Awaited<ReturnType<typeof createConfiguredReader>>;

// Matches exactly the empty placeholder html/serialize.ts always writes for
// a `content_ref` node (see schema.tsx) - never anything with children, so
// this is safe and unambiguous as a plain string scan (no HTML parser
// needed, matching how the rest of this file already treats content HTML as
// opaque text - see readItem's reader.parse in form/fields/content/index.tsx).
const CONTENT_REF_PLACEHOLDER = /<section data-ref-content="([^"]*)">\s*<\/section>/g;

// A production build has no "current branch" the way the admin app does
// (the reader just reads whatever it's configured against - see reader.ts) -
// assume "main" when substituting a previewUrl template's `{branch}` token
// for a redirect lookup. Only matters for a collection whose previewUrl
// actually uses `{branch}`; every other collection is unaffected.
const BUILD_BRANCH = "main";

const redirectEntriesCache = new WeakMap<
  Config<any, any>,
  Promise<ReturnType<typeof parseRedirectEntries>>
>();

function getRedirectEntries(config: Config<any, any>, reader: Reader) {
  let cached = redirectEntriesCache.get(config);
  if (!cached) {
    cached = (async () => {
      const singleton = (reader.singletons as any)[REDIRECTS_SINGLETON_KEY];
      const value = await singleton?.read();
      return parseRedirectEntries(value);
    })();
    redirectEntriesCache.set(config, cached);
  }
  return cached;
}

async function readEntryForRef(
  config: Config<any, any>,
  reader: Reader,
  ref: EntryRef,
): Promise<Record<string, unknown> | null> {
  if (ref.type === "singleton") {
    return (
      ((await (reader.singletons as any)[ref.name]?.read({
        resolveLinkedFiles: true,
      })) as Record<string, unknown> | null | undefined) ?? null
    );
  }
  return (
    ((await (reader.collections as any)[ref.name]?.read(ref.slug, {
      resolveLinkedFiles: true,
    })) as Record<string, unknown> | null | undefined) ?? null
  );
}

// Resolves one content-ref pointer to the current HTML of its target field,
// following a single-hop redirect if the collection entry was renamed (see
// redirects.ts's appendRedirect - chains never exceed one hop by
// construction). Returns undefined when the source is truly gone (deleted,
// or renamed with no previewUrl declared to redirect from) - the caller
// renders that as an empty section, never as an error.
async function resolveOneRef(
  config: Config<any, any>,
  reader: Reader,
  ref: EntryRef,
  field: string,
): Promise<string | undefined> {
  const entry = await readEntryForRef(config, reader, ref);
  if (entry) {
    const html = entry[field];
    return typeof html === "string" ? html : undefined;
  }
  if (ref.type !== "collection") return undefined;
  const previewUrl = config.collections?.[ref.name]?.previewUrl;
  if (!previewUrl) return undefined;
  const entries = await getRedirectEntries(config, reader);
  const fromUrl = urlForSlugFromPreviewUrl(previewUrl, ref.slug, BUILD_BRANCH);
  const toUrl = resolveRedirectSingleHop(entries, fromUrl);
  if (!toUrl) return undefined;
  const newSlug = slugFromPreviewUrlMatch(previewUrl, BUILD_BRANCH, toUrl);
  if (!newSlug) return undefined;
  const redirected = await readEntryForRef(config, reader, {
    type: "collection",
    name: ref.name,
    slug: newSlug,
  });
  const html = redirected?.[field];
  return typeof html === "string" ? html : undefined;
}

// Finds every `content_ref` placeholder in `entry`'s own top-level content
// fields and splices in the current HTML of whatever it points at - the
// build-time half of "always the latest, never a copy taken at insert time"
// (the editor does the same live, see ContentRefNodeView). Mutates `entry`
// in place; called from dry.ts's attachEntrySpots before bind()/view() see
// the entry, so both the plain prop and .bind()/.view()'s .value() get the
// resolved string.
//
// No recursion/cycle guard needed: the "Import content" picker (see
// app/content-ref/ContentRefPickerDialog.tsx) only ever offers a field whose
// HTML doesn't already contain a content-ref placeholder, so a resolved
// target's HTML is guaranteed ref-free by construction - nesting one level
// deep is simply not a value that can exist in storage.
export async function resolveContentRefsInEntry(
  config: Config<any, any>,
  reader: Reader,
  schema: Record<string, ComponentSchema>,
  entry: Record<string, unknown>,
): Promise<void> {
  for (const field of listTopLevelContentFields(schema)) {
    const html = entry[field];
    if (typeof html !== "string" || !html.includes("data-ref-content=")) {
      continue;
    }
    const matches = [...html.matchAll(CONTENT_REF_PLACEHOLDER)];
    if (!matches.length) continue;
    const resolved = await Promise.all(
      matches.map(async (match) => {
        const parsed = parseEditKey(match[1]);
        if (!parsed) return "";
        const ref: EntryRef =
          parsed.type === "singleton"
            ? { type: "singleton", name: parsed.name }
            : { type: "collection", name: parsed.name, slug: parsed.slug };
        return (await resolveOneRef(config, reader, ref, parsed.field)) ?? "";
      }),
    );
    let result = "";
    let lastIndex = 0;
    matches.forEach((match, i) => {
      result += html.slice(lastIndex, match.index);
      result += `<section data-ref-content="${match[1]}">${resolved[i]}</section>`;
      lastIndex = match.index! + match[0].length;
    });
    result += html.slice(lastIndex);
    entry[field] = result;
  }
}
