// In-memory, page-session cache of the last-known resolved HTML for each
// content_ref pointer (keyed by its `ref` edit-key string, e.g.
// "singleton::demo::content" - see edit-sync.ts's editKey). Populated by
// useReferencedContentHtml whenever a live resolution completes, and read
// back by VEI's InlineContentEditors when a content field's ProseMirror view
// unmounts (edit mode toggled off).
//
// Needed because html/serialize.ts always writes a content_ref node back out
// as an empty `<section data-ref-content="...">` placeholder (see that
// file's own comment: resolved content must never be persisted to storage).
// Without this cache, toggling VEI edit mode off would flash that empty
// placeholder onto the live page until a full reload re-ran the server-side
// resolver (packages/astro/src/content-ref-resolve.ts) - including for a ref
// the user just repointed via the popover, which the server has never
// resolved at all.
const resolvedHtmlByRef = new Map<string, string>();

export function cacheReferencedContentHtml(ref: string, html: string): void {
  resolvedHtmlByRef.set(ref, html);
}

// Mirrors content-ref-resolve.ts's CONTENT_REF_PLACEHOLDER scan/splice, but
// reading from this client-side cache instead of a server reader - same
// empty-section wire format (schema.tsx's content_ref toDOM, html/serialize.ts),
// so the two stay interchangeable. A ref with no cache entry yet (never
// resolved on this page) is left as the empty placeholder, same as today.
const CONTENT_REF_PLACEHOLDER =
  /<section data-ref-content="([^"]*)">\s*<\/section>/g;

export function fillContentRefPlaceholdersFromCache(html: string): string {
  if (!html.includes("data-ref-content=")) return html;
  return html.replace(CONTENT_REF_PLACEHOLDER, (match, ref: string) => {
    const cached = resolvedHtmlByRef.get(ref);
    return cached === undefined
      ? match
      : `<section data-ref-content="${ref}">${cached}</section>`;
  });
}
