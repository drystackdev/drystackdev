// Pure brand ref/label generation + display helpers. No React/IO, no config
// runtime import - so both the admin app (brand.tsx) and the visual editor
// (VEI, packages/astro/src/editor) can generate matching brand refs/labels and
// render a date-stripped label. See brand.tsx for the "brand" concept.

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function timestampParts(date: Date) {
  return {
    YYYY: date.getFullYear(),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };
}

export function formatBrandLabel(
  date: Date,
  name: string,
  role: string,
): string {
  const { YYYY, MM, DD, HH, mm, ss } = timestampParts(date);
  return `${YYYY}-${MM}-${DD} - ${HH}:${mm}:${ss} - ${name} - ${role}`;
}

// Allowlist (keep only [a-z0-9-]) rather than denylisting git's invalid-ref
// characters (see branch-selection.tsx) - strictly safer, since it can't miss
// a character git rejects, and it also collapses sequences like ".." or
// trailing ".lock" that a denylist would need to special-case.
function sanitizeRefSegment(input: string): string {
  const s = input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // strip diacritics, e.g. Vietnamese names
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  return s || "editor";
}

// `branchPrefix` is the config's storage.branchPrefix (undefined ⇒ default);
// callers pass it directly so this stays free of any config-type import.
export function formatBrandRef(
  branchPrefix: string | undefined,
  date: Date,
  login: string,
): string {
  const { YYYY, MM, DD, HH, mm, ss } = timestampParts(date);
  const prefix = branchPrefix ?? "drystack/";
  return `${prefix}${YYYY}-${MM}-${DD}-${HH}${mm}${ss}-${sanitizeRefSegment(login)}`;
}

// The display form of a brand label: drops the leading date/time so the UI
// shows just "name - role". A label produced by anything other than
// formatBrandLabel (e.g. the useBrandGuard fallback that stores the raw branch
// name) won't match and is returned unchanged.
const BRAND_DATE_PREFIX = /^\d{4}-\d{2}-\d{2} - \d{2}:\d{2}:\d{2} - /;
export function brandDisplayLabel(label: string): string {
  return label.replace(BRAND_DATE_PREFIX, "");
}
