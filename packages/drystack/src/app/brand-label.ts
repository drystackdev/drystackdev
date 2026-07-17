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

const DEFAULT_BRANCH_PREFIX = "drystack/";

// `branchPrefix` is the config's storage.branchPrefix (undefined ⇒ default);
// callers pass it directly so this stays free of any config-type import.
//
// The ref carries the timestamp and nothing else - no login, no name. Who owns
// a brand is answered by the author of its tip commit (Ref_base in
// shell/data.tsx), never by parsing the ref. Second precision is all that keeps
// refs unique: two brands created in the same second collide, and createRef
// fails rather than silently sharing a branch - callers retry (useEnsureBrandAtRoot)
// or surface a toast (NewBranchButton).
export function formatBrandRef(
  branchPrefix: string | undefined,
  date: Date,
): string {
  const { YYYY, MM, DD, HH, mm, ss } = timestampParts(date);
  const prefix = branchPrefix ?? DEFAULT_BRANCH_PREFIX;
  return `${prefix}${YYYY}-${MM}-${DD}-${HH}${mm}${ss}`;
}

// Whether a ref is one of ours. Callers pass the config's prefix rather than
// hardcoding it, so the default lives here alone.
export function isBrandRef(
  ref: string,
  branchPrefix: string | undefined,
): boolean {
  return ref.startsWith(branchPrefix ?? DEFAULT_BRANCH_PREFIX);
}

// The display form of a brand ref: strips the prefix and renders the timestamp
// the way a Vietnamese-locale reader expects ("17/07/2026 17:14:29") rather
// than the ref's sortable machine form. Anything that isn't a brand ref - the
// default branch, or a branch created outside drystack - has no timestamp to
// reformat and is returned unchanged.
const BRAND_REF_TIMESTAMP = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/;
export function brandRefDisplayLabel(
  ref: string,
  branchPrefix: string | undefined,
): string {
  const prefix = branchPrefix ?? DEFAULT_BRANCH_PREFIX;
  if (!ref.startsWith(prefix)) return ref;
  const rest = ref.slice(prefix.length);
  const match = BRAND_REF_TIMESTAMP.exec(rest);
  if (!match) return rest;
  const [, YYYY, MM, DD, HH, mm, ss] = match;
  return `${DD}/${MM}/${YYYY} ${HH}:${mm}:${ss}`;
}

// The display form of a brand label: drops the leading date/time so the UI
// shows just "name - role". A label produced by anything other than
// formatBrandLabel (e.g. the useBrandGuard fallback that stores the raw branch
// name) won't match and is returned unchanged.
const BRAND_DATE_PREFIX = /^\d{4}-\d{2}-\d{2} - \d{2}:\d{2}:\d{2} - /;
export function brandDisplayLabel(label: string): string {
  return label.replace(BRAND_DATE_PREFIX, "");
}
