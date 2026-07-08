import { Fragment, ReactNode } from 'react';
import { tokenSchema } from '@keystar/ui/style';
import { HighlightLanguage } from './file-kind';

type Token = { text: string; type?: TokenType };
type TokenType = 'key' | 'string' | 'number' | 'keyword' | 'comment' | 'punctuation';

// reuses the same color scale as the markdoc/document editor's code-block
// highlighting (`code-block-highlighting.ts`) so highlighted text looks
// consistent wherever it shows up in the app
const tokenStyle: Record<TokenType, { color: string; fontStyle?: string }> = {
  comment: { color: tokenSchema.color.foreground.neutralTertiary, fontStyle: 'italic' },
  key: { color: tokenSchema.color.scale.pink11 },
  string: { color: tokenSchema.color.scale.indigo9 },
  number: { color: tokenSchema.color.scale.green11 },
  keyword: { color: tokenSchema.color.scale.indigo11 },
  punctuation: { color: tokenSchema.color.foreground.neutralSecondary },
};

function tokenizeJson(code: string): Token[] {
  const tokens: Token[] = [];
  const re =
    /"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|\btrue\b|\bfalse\b|\bnull\b|[{}[\],:]|\s+|./gs;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code))) {
    const text = m[0];
    let type: TokenType | undefined;
    if (/^\s+$/.test(text)) {
      type = undefined;
    } else if (text[0] === '"') {
      const after = code.slice(m.index + text.length);
      type = /^\s*:/.test(after) ? 'key' : 'string';
    } else if (/^-?\d/.test(text)) {
      type = 'number';
    } else if (/^(true|false|null)$/.test(text)) {
      type = 'keyword';
    } else if (/^[{}[\],:]$/.test(text)) {
      type = 'punctuation';
    }
    tokens.push({ text, type });
  }
  return tokens;
}

function tokenizeYamlValue(value: string): Token[] {
  const leadingWs = value.match(/^\s*/)![0];
  const tokens: Token[] = leadingWs ? [{ text: leadingWs }] : [];
  const v = value.slice(leadingWs.length);
  if (!v) return tokens;
  if (v.startsWith('#')) {
    tokens.push({ text: v, type: 'comment' });
  } else if (/^(['"]).*\1$/.test(v)) {
    tokens.push({ text: v, type: 'string' });
  } else if (/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(v)) {
    tokens.push({ text: v, type: 'number' });
  } else if (/^(true|false|null|~|yes|no)$/i.test(v)) {
    tokens.push({ text: v, type: 'keyword' });
  } else if (v === '|' || v === '>' || v.startsWith('&') || v.startsWith('*')) {
    tokens.push({ text: v, type: 'punctuation' });
  } else {
    tokens.push({ text: v, type: 'string' });
  }
  return tokens;
}

function tokenizeYamlLine(line: string): Token[] {
  const tokens: Token[] = [];
  const leadingWs = line.match(/^\s*/)![0];
  if (leadingWs) tokens.push({ text: leadingWs });
  let rest = line.slice(leadingWs.length);

  if (rest === '---' || rest === '...') {
    tokens.push({ text: rest, type: 'punctuation' });
    return tokens;
  }

  const dashMatch = rest.match(/^-(\s+|$)/);
  if (dashMatch) {
    tokens.push({ text: dashMatch[0], type: 'punctuation' });
    rest = rest.slice(dashMatch[0].length);
  }

  if (rest.startsWith('#')) {
    tokens.push({ text: rest, type: 'comment' });
    return tokens;
  }

  const keyMatch = rest.match(/^([^:\s][^:]*?):(\s|$)/);
  if (keyMatch) {
    tokens.push({ text: keyMatch[1], type: 'key' });
    tokens.push({ text: ':', type: 'punctuation' });
    rest = rest.slice(keyMatch[1].length + 1);
    tokens.push(...tokenizeYamlValue(rest));
    return tokens;
  }

  tokens.push(...tokenizeYamlValue(rest));
  return tokens;
}

function tokenizeYaml(code: string): Token[] {
  const lines = code.split('\n');
  const tokens: Token[] = [];
  lines.forEach((line, i) => {
    tokens.push(...tokenizeYamlLine(line));
    if (i < lines.length - 1) tokens.push({ text: '\n' });
  });
  return tokens;
}

export function highlightCode(code: string, lang: HighlightLanguage): ReactNode {
  const tokens = lang === 'json' ? tokenizeJson(code) : tokenizeYaml(code);
  return tokens.map((token, i) =>
    token.type ? (
      <span key={i} style={tokenStyle[token.type]}>
        {token.text}
      </span>
    ) : (
      <Fragment key={i}>{token.text}</Fragment>
    )
  );
}
