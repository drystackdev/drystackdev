// Incremental YAML reader for the generate stream.
//
// js-yaml can only parse a complete document, so it can't drive a UI that
// fills in as tokens arrive. This reads the shape the prompt pins down
// instead: top-level `key:` lines at column 0, in the order the skeleton
// listed them. That ordering is what makes "field finished" detectable at
// all — a key is done the moment the *next* one starts.
//
// Scalars stream character by character. Arrays and objects don't: their
// lines are buffered and handed to js-yaml once the block closes, so a
// half-written list never reaches the form (and a partially-typed item never
// shows up as a real one).

import { load } from 'js-yaml';

export type AiStreamEvent =
  | { type: 'field-start'; key: string }
  // Scalars only — the growing text so far, for live display.
  | { type: 'field-progress'; key: string; text: string }
  // `raw` is the YAML-parsed value: a string for scalars, an array/object for
  // block kinds.
  | { type: 'field-done'; key: string; raw: unknown }
  | { type: 'error'; message: string };

type Pending = {
  key: string;
  /** the `foo:` line's own remainder, plus every line under it */
  lines: string[];
  /** `key: |` — a block scalar, so the body is text, not structure */
  isBlockScalar: boolean;
  /** first line was `key:` with nothing after it — could be a list/map */
  isBlock: boolean;
};

const TOP_LEVEL_KEY = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/;

export class AiStreamParser {
  #buffer = '';
  #pending: Pending | undefined;
  #emit: (event: AiStreamEvent) => void;
  #known: Set<string>;

  constructor(knownKeys: string[], emit: (event: AiStreamEvent) => void) {
    this.#known = new Set(knownKeys);
    this.#emit = emit;
  }

  write(chunk: string) {
    this.#buffer += chunk;
    let newlineIndex: number;
    while ((newlineIndex = this.#buffer.indexOf('\n')) !== -1) {
      const line = this.#buffer.slice(0, newlineIndex);
      this.#buffer = this.#buffer.slice(newlineIndex + 1);
      this.#line(line);
    }
    // A block scalar's last line sits unterminated in the buffer until its
    // newline arrives. Show it appended to the lines already read — emitting
    // the buffer alone would momentarily blank out everything above it.
    if (this.#pending?.isBlockScalar && this.#buffer) {
      this.#progress(this.#dedent([...this.#pending.lines, this.#buffer]));
    }
  }

  /** Flushes the trailing line and closes the final field. */
  end() {
    if (this.#buffer.trim()) {
      this.#line(this.#buffer);
      this.#buffer = '';
    }
    this.#finish();
  }

  #line(rawLine: string) {
    // Models wrap YAML in a code fence often enough to be worth absorbing
    // rather than failing on.
    const fenced = rawLine.trim();
    if (fenced === '```' || fenced.startsWith('```')) return;

    const match = TOP_LEVEL_KEY.exec(rawLine);
    // Only a match at column 0 with a key we asked for starts a new field —
    // otherwise `desc: foo` nested inside a list item would be mistaken for a
    // top-level key and truncate the array being built.
    if (match && this.#known.has(match[1])) {
      this.#finish();
      const [, key, rest] = match;
      const trimmed = rest.trim();
      this.#pending = {
        key,
        lines: [],
        isBlockScalar: trimmed === '|' || trimmed === '|-' || trimmed === '|+',
        isBlock: trimmed === '',
      };
      this.#emit({ type: 'field-start', key });
      if (trimmed && !this.#pending.isBlockScalar) {
        // `key: value` — a one-liner, complete as soon as it's seen.
        this.#pending.lines.push(rest);
        this.#progress(trimmed);
      }
      return;
    }

    if (!this.#pending) return;
    this.#pending.lines.push(rawLine);
    if (this.#pending.isBlockScalar) {
      this.#progress(this.#dedent(this.#pending.lines));
    }
  }

  #progress(text: string) {
    if (!this.#pending) return;
    this.#emit({ type: 'field-progress', key: this.#pending.key, text });
  }

  #finish() {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = undefined;

    if (pending.isBlockScalar) {
      this.#emit({
        type: 'field-done',
        key: pending.key,
        raw: this.#dedent(pending.lines),
      });
      return;
    }

    if (!pending.isBlock) {
      this.#emit({
        type: 'field-done',
        key: pending.key,
        raw: pending.lines.join('\n').trim(),
      });
      return;
    }

    // A structural block: hand the whole thing to js-yaml at once. Anything
    // malformed drops just this field — a model that botched one list
    // shouldn't cost the user every other field in the response.
    const text = `${pending.key}:\n${pending.lines.join('\n')}`;
    try {
      const parsed = load(text) as Record<string, unknown>;
      this.#emit({ type: 'field-done', key: pending.key, raw: parsed?.[pending.key] });
    } catch (err) {
      this.#emit({
        type: 'error',
        message: `Không đọc được YAML của "${pending.key}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      });
    }
  }

  // Block scalar bodies are indented relative to their key; the indentation is
  // YAML framing, not part of the value. Measured from the first non-empty
  // line so nested HTML keeps its own relative shape.
  #dedent(lines: string[]): string {
    const first = lines.find(l => l.trim());
    if (!first) return '';
    const indent = first.length - first.trimStart().length;
    return lines
      .map(l => (l.length >= indent ? l.slice(indent) : l.trimStart()))
      .join('\n')
      .replace(/\s+$/, '');
  }
}
