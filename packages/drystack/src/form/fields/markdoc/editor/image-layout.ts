// Shared helpers for the in-editor image node's explicit size (width/height)
// and float/center layout. Used by the HTML serializer/parser (persisted
// `style`/`data-align` on the `<img>`) and the React node view so the editor
// preview matches the published output. Only the HTML-backed `content` field
// exposes the UI for these; markdoc/mdx leave the attrs at their `null` default.

export type ImageAlign = 'left' | 'right' | 'center';

const IMAGE_ALIGN_VALUES = new Set<ImageAlign>(['left', 'right', 'center']);

export function normalizeImageAlign(
  value: string | null | undefined
): ImageAlign | null {
  return value && IMAGE_ALIGN_VALUES.has(value as ImageAlign)
    ? (value as ImageAlign)
    : null;
}

export type ImageLayoutAttrs = {
  width: number | null;
  height: number | null;
  align: ImageAlign | null;
};

// CSS declarations (kebab-case) rendering an image's explicit size + layout.
export function imageLayoutStyleEntries(
  attrs: ImageLayoutAttrs
): [string, string][] {
  const entries: [string, string][] = [];
  if (attrs.width != null) entries.push(['width', `${attrs.width}px`]);
  if (attrs.height != null) entries.push(['height', `${attrs.height}px`]);
  if (attrs.width != null || attrs.height != null) {
    entries.push(['object-fit', 'contain']);
  }
  if (attrs.align === 'left') {
    entries.push(
      ['float', 'left'],
      ['margin-inline-end', '1em'],
      ['margin-block-end', '0.5em']
    );
  } else if (attrs.align === 'right') {
    entries.push(
      ['float', 'right'],
      ['margin-inline-start', '1em'],
      ['margin-block-end', '0.5em']
    );
  } else if (attrs.align === 'center') {
    entries.push(['display', 'block'], ['margin-inline', 'auto']);
  }
  return entries;
}

export function imageLayoutStyleString(attrs: ImageLayoutAttrs): string {
  return imageLayoutStyleEntries(attrs)
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

export function parseImageSize(value: string | null | undefined): number | null {
  if (!value) return null;
  const n = parseFloat(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

// Reads width/height/align back off an `<img>` (inline `style` first, then the
// `width`/`height`/`data-align` attributes). `data-align` is our own round-trip
// marker; `float` is also honoured so foreign pasted HTML still aligns.
export function imageLayoutFromElement(el: HTMLElement): ImageLayoutAttrs {
  const width =
    parseImageSize(el.style.width) ?? parseImageSize(el.getAttribute('width'));
  const height =
    parseImageSize(el.style.height) ??
    parseImageSize(el.getAttribute('height'));
  let align = normalizeImageAlign(el.getAttribute('data-align'));
  if (!align) {
    const float = el.style.float;
    if (float === 'left' || float === 'right') align = float;
  }
  return { width, height, align };
}
