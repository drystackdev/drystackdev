import { AiFieldSpec, renderSkeleton } from './schema-to-yaml';

export const AI_SIZES = ['short', 'medium', 'long', 'xlong'] as const;
export type AiSize = (typeof AI_SIZES)[number];

// Word targets shown in the UI and stated to the model, paired with the token
// ceiling the request needs to fit the result. The ceiling is deliberately
// generous relative to the word target: Vietnamese tokenizes less densely
// than English, and HTML markup costs tokens the word count doesn't see.
export const SIZE_SPECS: Record<
  AiSize,
  { words: string; maxTokens: number; label: string }
> = {
  short: { words: 'khoảng 500 từ', maxTokens: 2000, label: 'Ngắn' },
  medium: { words: 'khoảng 1000 từ', maxTokens: 4000, label: 'Vừa' },
  long: { words: 'khoảng 2000 từ', maxTokens: 8000, label: 'Dài' },
  xlong: { words: 'từ 3000 từ trở lên', maxTokens: 16000, label: 'Rất dài' },
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
    'Chỉ xuất YAML thô. Không bọc trong ```yaml, không thêm lời dẫn, không giải thích trước hay sau.',
    'Chỉ xuất đúng những key được liệt kê ở phần "CẦN ĐIỀN", theo ĐÚNG thứ tự đã liệt kê. Không thêm key nào khác.',
    'Mọi chuỗi nhiều dòng phải dùng block scalar `|`.',
    'Không lặp lại hay xuất các key ở phần "NGỮ CẢNH" — chúng đã có sẵn.',
    `Toàn bộ nội dung viết bằng ngôn ngữ: ${lang}.`,
  ];
  if (hasContentField) {
    rules.push(
      `Với field HTML: viết nội dung dài ${SIZE_SPECS[size].words}. Xuất HTML fragment, không có <html>, <body> hay <img>.`
    );
  }

  return [
    `Bạn là trợ lý viết nội dung cho một CMS. Bạn đang điền dữ liệu cho: ${entryDescription}.`,
    '',
    'QUY TẮC BẮT BUỘC:',
    ...rules.map((r, i) => `${i + 1}. ${r}`),
    '',
    'CẦN ĐIỀN (đúng thứ tự này):',
    renderSkeleton(targets),
    '',
    'Ví dụ định dạng đầu ra:',
    'ten_key_ngan: Giá trị một dòng',
    'ten_key_dai: |',
    '  Dòng thứ nhất.',
    '  Dòng thứ hai.',
    'ten_key_danh_sach:',
    '  - mục thứ nhất',
    '  - mục thứ hai',
    'ten_key_danh_sach_object:',
    '  - ten_truong: Giá trị',
    '    mo_ta: |',
    '      Mô tả nhiều dòng.',
  ].join('\n');
}

export function buildUserPrompt(args: {
  context: Record<string, string>;
  description: string;
}): string {
  const { context, description } = args;
  const lines: string[] = [];

  const contextEntries = Object.entries(context).filter(([, v]) => v?.trim());
  if (contextEntries.length) {
    lines.push('NGỮ CẢNH (dữ liệu đã có, dùng để viết cho khớp, đừng xuất lại):');
    for (const [key, value] of contextEntries) {
      lines.push(`${key}: ${value}`);
    }
    lines.push('');
  }

  lines.push('YÊU CẦU:');
  lines.push(description.trim() || 'Viết nội dung phù hợp với ngữ cảnh trên.');

  return lines.join('\n');
}
