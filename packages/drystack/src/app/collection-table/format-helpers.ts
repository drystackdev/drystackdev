export function formatDateValue(value: string): string {
  const date = new Date(value.includes("T") ? value : `${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

export function formatDatetimeValue(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatNumberValue(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

// fields.content() stores its value as an HTML string (see
// parseToEditorStateHTML in form/fields/content/index.tsx) - strip tags so
// the table can show plain-text word/character counts and a readable preview
// instead of raw markup, without pulling in a full HTML parser
export function stripHtmlForPreview(raw: string): string {
  return raw
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function countWordsAndChars(plainText: string): {
  wordCount: number;
  charCount: number;
} {
  if (!plainText) return { wordCount: 0, charCount: 0 };
  return {
    wordCount: plainText.split(/\s+/).length,
    charCount: plainText.length,
  };
}

// `fields.content()` precomputes { wordCount, charCount } at save time (see
// form/fields/content/index.tsx) so the table can show a summary without
// fetching the (now separate) HTML file - but `markdoc.inline()` still
// stores its value as a raw string inline, so this accepts either shape.
export function summarizeContent(
  value: string | { wordCount: number; charCount: number } | undefined | null,
): string {
  const counts =
    typeof value === "string"
      ? countWordsAndChars(stripHtmlForPreview(value))
      : value;
  if (!counts || (!counts.wordCount && !counts.charCount)) return "Empty";
  const { wordCount, charCount } = counts;
  const charLabel =
    charCount >= 1000
      ? `${(charCount / 1000).toFixed(1)}k characters`
      : `${charCount} characters`;
  return `${charLabel} - ${wordCount} word${wordCount === 1 ? "" : "s"}`;
}
