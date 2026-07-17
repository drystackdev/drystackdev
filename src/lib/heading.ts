// brand.name is a `fields.content()` value (bold-only HTML, see
// drystack.config.ts) - this strips every tag to get a plain string for
// contexts that can't render HTML (<title>, JSON-LD `name`, aria-labels).
export function htmlToPlainText(html: string): string {
  return html.replace(/<[^>]+>/g, "");
}
