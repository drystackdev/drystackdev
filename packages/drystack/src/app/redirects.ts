// 301 redirect map shared by the CMS write path (updating.tsx) and the build
// step (packages/astro reads REDIRECTS_FILE_PATH to emit dist/_redirects).
//
// The map is stored as a singleton (see the `__redirects` entry `config()`
// injects in ../config.tsx) so it goes through the same commit/`/update`
// machinery as any other content - one file, both storage kinds, and a free
// editing UI in the CMS. The singleton is library-owned, not something a
// site author declares, so this directory name is the single source of
// truth for where the file lives - `../config.tsx` points the injected
// singleton's `path` at the same constant, so the two can't drift apart.
export const REDIRECTS_DIR = "redirects";
export const REDIRECTS_FILE_PATH = `${REDIRECTS_DIR}/index.yaml`;

export type RedirectEntry = {
  from: string;
  to: string;
};

// Public URLs only ever differ here by a trailing slash; normalise so `/blog/a`
// and `/blog/a/` compare equal and we never emit a self-redirect that differs
// only by that slash.
export function normalizeRedirectPath(path: string): string {
  const trimmed = path.trim();
  if (!trimmed) return trimmed;
  const noTrailing = trimmed.replace(/\/+$/, "");
  return noTrailing === "" ? "/" : noTrailing;
}

// Coerce whatever the YAML `entries` value is into a clean RedirectEntry[].
// Tolerant of a hand-edited or empty file: anything without a usable from/to is
// dropped rather than throwing.
export function parseRedirectEntries(value: unknown): RedirectEntry[] {
  if (!value || typeof value !== "object") return [];
  const raw = (value as { entries?: unknown }).entries;
  if (!Array.isArray(raw)) return [];
  const result: RedirectEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const from = normalizeRedirectPath(String((item as any).from ?? ""));
    const to = normalizeRedirectPath(String((item as any).to ?? ""));
    if (!from || !to) continue;
    result.push({ from, to });
  }
  return result;
}

// Add a `from → to` redirect, keeping the table flat (never a chain) and never
// shadowing a live page.
//
// Worked example - the user's `bai-viet-1 → doi-ten-1 → doi-ten-2`:
//   start:            []
//   append A→B:       [A→B]
//   append B→C:       [A→C, B→C]   (A→B is *rewritten*, not chained)
// so a hit on the oldest URL A resolves to the newest URL C in a single hop.
//
// Reuse of an old URL is handled too - appending X→A drops any stale `A→…`
// entry, because a redirect out of A would otherwise hide the freshly-created
// page now living at A.
export function appendRedirect(
  entries: RedirectEntry[],
  incoming: { from: string; to: string },
): RedirectEntry[] {
  const from = normalizeRedirectPath(incoming.from);
  const to = normalizeRedirectPath(incoming.to);
  if (!from || !to) return entries;

  // 1. Collapse chains: any entry currently pointing at `from` should now point
  //    straight at the new destination.
  let next = entries.map((entry) =>
    normalizeRedirectPath(entry.to) === from ? { ...entry, to } : entry,
  );

  // 2. The new destination is a live page again - drop any redirect *out of*
  //    it so it isn't shadowed, and drop the entry we're about to (re)write.
  next = next.filter(
    (entry) =>
      normalizeRedirectPath(entry.from) !== to &&
      normalizeRedirectPath(entry.from) !== from,
  );

  // 3. Record the redirect itself - unless it collapsed into a self-redirect
  //    (e.g. the URL was renamed back to its original), in which case there is
  //    nothing to redirect.
  if (from !== to) {
    next.push({ from, to });
  }

  // 4. Final safety sweep: no self-redirects, no duplicate sources (last write
  //    wins), stable order.
  const seen = new Set<string>();
  const out: RedirectEntry[] = [];
  for (const entry of next) {
    const nFrom = normalizeRedirectPath(entry.from);
    const nTo = normalizeRedirectPath(entry.to);
    if (!nFrom || !nTo || nFrom === nTo || seen.has(nFrom)) continue;
    seen.add(nFrom);
    out.push({ ...entry, from: nFrom, to: nTo });
  }
  return out;
}

// Single-hop lookup against the redirect table - sufficient because
// appendRedirect's own write-time invariant guarantees chains never exceed
// one hop (see its worked example above), so there is nothing to walk.
// Returns undefined when `fromPath` has no redirect (a live page, or an
// unrelated path).
export function resolveRedirectSingleHop(
  entries: RedirectEntry[],
  fromPath: string,
): string | undefined {
  const normalized = normalizeRedirectPath(fromPath);
  const match = entries.find(
    (entry) => normalizeRedirectPath(entry.from) === normalized,
  );
  return match ? normalizeRedirectPath(match.to) : undefined;
}

// Forward direction of a collection's `previewUrl` template substitution -
// centralized here since both the redirect resolver below and ItemPage.tsx's
// own rename-confirmation copy need the identical substitution to agree on
// what a slug's public URL is.
export function urlForSlugFromPreviewUrl(
  previewUrl: string,
  slug: string,
  branch: string,
): string {
  return previewUrl.replace("{slug}", slug).replace("{branch}", branch);
}

// Reverse of urlForSlugFromPreviewUrl: recovers the slug embedded in `url` by
// a previewUrl template that already has `branch` baked in. Returns undefined
// if `url` doesn't actually match the template's prefix/suffix, or the
// template has no `{slug}` token to invert - true only for a malformed
// config, since every realistic collection previewUrl has exactly one.
export function slugFromPreviewUrlMatch(
  previewUrl: string,
  branch: string,
  url: string,
): string | undefined {
  const withBranch = previewUrl.replace("{branch}", branch);
  const slugIndex = withBranch.indexOf("{slug}");
  if (slugIndex === -1) return undefined;
  const prefix = withBranch.slice(0, slugIndex);
  const suffix = withBranch.slice(slugIndex + "{slug}".length);
  if (!url.startsWith(prefix) || !url.endsWith(suffix)) return undefined;
  const middle = url.slice(prefix.length, url.length - suffix.length);
  return middle || undefined;
}

// Render the redirect table to a Cloudflare `_redirects` file body. One
// `from to 301` line per entry; static entries only, so ordering is not
// load-bearing beyond dedupe.
export function serializeRedirectsFile(entries: RedirectEntry[]): string {
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const entry of entries) {
    const from = normalizeRedirectPath(entry.from);
    const to = normalizeRedirectPath(entry.to);
    if (!from || !to || from === to || seen.has(from)) continue;
    seen.add(from);
    lines.push(`${from} ${to} 301`);
  }
  return lines.join("\n");
}
