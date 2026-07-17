import { AiFieldSpec, renderSkeleton } from "./schema-to-yaml";

export const AI_SIZES = ["short", "medium", "long", "xlong"] as const;
export type AiSize = (typeof AI_SIZES)[number];

// Word targets shown in the UI and stated to the model, paired with the token
// ceiling the request needs to fit the result. The ceiling is deliberately
// generous relative to the word target: Vietnamese tokenizes less densely
// than English, and HTML markup costs tokens the word count doesn't see.
export const SIZE_SPECS: Record<
  AiSize,
  { words: string; maxTokens: number; label: string }
> = {
  short: { words: "khoảng 500 từ", maxTokens: 2000, label: "Ngắn" },
  medium: { words: "khoảng 1000 từ", maxTokens: 4000, label: "Vừa" },
  long: { words: "khoảng 2000 từ", maxTokens: 8000, label: "Dài" },
  xlong: { words: "từ 3000 từ trở lên", maxTokens: 16000, label: "Rất dài" },
};

export function isAiSize(value: unknown): value is AiSize {
  return (AI_SIZES as readonly unknown[]).includes(value);
}

export function buildSystemPrompt(args: {
  lang: string;
  entryDescription: string;
  targets: AiFieldSpec[];
  hasContentField: boolean;
  size: AiSize;
}): string {
  const { lang, entryDescription, targets, hasContentField, size } = args;

  const rules = [
    "Chỉ xuất YAML thô. Không bọc trong ```yaml, không thêm lời dẫn, không giải thích trước hay sau.",
    'Chỉ xuất đúng những key được liệt kê ở phần "CẦN ĐIỀN", theo ĐÚNG thứ tự đã liệt kê. Không thêm key nào khác.',
    "Mọi chuỗi nhiều dòng phải dùng block scalar `|`.",
    'Không lặp lại hay xuất các key ở phần "NGỮ CẢNH" - chúng đã có sẵn.',
    `Toàn bộ nội dung viết bằng ngôn ngữ: ${lang}.`,
  ];
  if (hasContentField) {
    rules.push(
      `Với field HTML: viết nội dung dài ${SIZE_SPECS[size].words}. Xuất HTML fragment, không có <html>, <body> hay <img>.`,
    );
  }

  return [
    `Bạn là trợ lý viết nội dung cho một CMS. Bạn đang điền dữ liệu cho: ${entryDescription}.`,
    "",
    "QUY TẮC BẮT BUỘC:",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    "",
    "CẦN ĐIỀN (đúng thứ tự này):",
    renderSkeleton(targets),
    "",
    "Ví dụ định dạng đầu ra:",
    "ten_key_ngan: Giá trị một dòng",
    "ten_key_dai: |",
    "  Dòng thứ nhất.",
    "  Dòng thứ hai.",
    "ten_key_danh_sach:",
    "  - mục thứ nhất",
    "  - mục thứ hai",
    "ten_key_danh_sach_object:",
    "  - ten_truong: Giá trị",
    "    mo_ta: |",
    "      Mô tả nhiều dòng.",
  ].join("\n");
}

export function buildUserPrompt(args: {
  context: Record<string, string>;
  description: string;
}): string {
  const { context, description } = args;
  const lines: string[] = [...renderContextBlock(context)];

  lines.push("YÊU CẦU:");
  lines.push(description.trim() || "Viết nội dung phù hợp với ngữ cảnh trên.");

  return lines.join("\n");
}

/**
 * The other fields of the entry, as background. Shared by both routes: a
 * rewrite wants the same "make it fit what's already here" grounding a fresh
 * generation does, and the model shouldn't have to learn two layouts for the
 * same information.
 */
function renderContextBlock(context: Record<string, string>): string[] {
  const contextEntries = Object.entries(context).filter(([, v]) => v?.trim());
  if (!contextEntries.length) return [];
  const lines = [
    "NGỮ CẢNH (dữ liệu đã có, dùng để viết cho khớp, đừng xuất lại):",
  ];
  for (const [key, value] of contextEntries) {
    lines.push(`${key}: ${value}`);
  }
  lines.push("");
  return lines;
}

/**
 * The rewrite route's counterpart to `buildSystemPrompt`.
 *
 * The output contract is the opposite shape: one bare HTML fragment rather
 * than keyed YAML, because the unit here is a range of the document, not a
 * field. That's also why there's no `size` - the length target comes from the
 * passage the user selected and whatever they asked for, not from a preset.
 */
export function buildRewriteSystemPrompt(args: {
  lang: string;
  entryDescription: string;
  htmlTags: readonly string[];
}): string {
  const { lang, entryDescription, htmlTags } = args;

  const rules = [
    "Chỉ xuất HTML fragment đã sửa. Không bọc trong ```html, không thêm lời dẫn, không giải thích trước hay sau.",
    `Chỉ dùng các thẻ: ${htmlTags.join(", ")}. Không xuất <html>, <body> hay <img>.`,
    "Chỉ viết lại đúng đoạn được đưa. Không thêm mở bài, không thêm kết luận, không viết nối sang phần nội dung xung quanh.",
    `Giữ nguyên ngôn ngữ: ${lang}.`,
    "Nếu yêu cầu không nói gì về độ dài, giữ độ dài xấp xỉ đoạn gốc.",
  ];

  return [
    `Bạn là trợ lý biên tập nội dung cho một CMS. Bạn đang sửa một đoạn trong: ${entryDescription}.`,
    "",
    "QUY TẮC BẮT BUỘC:",
    ...rules.map((r, i) => `${i + 1}. ${r}`),
  ].join("\n");
}

export function buildRewriteUserPrompt(args: {
  context: Record<string, string>;
  selection: string;
  description: string;
}): string {
  const { context, selection, description } = args;
  const lines: string[] = [...renderContextBlock(context)];

  lines.push("ĐOẠN CẦN SỬA:");
  lines.push(selection);
  lines.push("");
  lines.push("YÊU CẦU:");
  lines.push(description.trim() || "Viết lại đoạn trên cho tốt hơn.");

  return lines.join("\n");
}

/**
 * How many tokens a rewrite may spend, derived from the passage rather than a
 * preset: "make this shorter" on a paragraph and "expand this" on a whole
 * section have wildly different budgets, and only the selection knows which.
 *
 * The multiplier is deliberately loose - Vietnamese tokenizes less densely
 * than English, HTML markup costs tokens the text doesn't show, and asking to
 * expand a short passage still needs room to breathe (hence the floor).
 */
export function rewriteMaxTokens(selectionChars: number): number {
  return Math.min(16_000, Math.max(2_000, selectionChars));
}
