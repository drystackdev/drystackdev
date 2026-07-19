import { Fragment } from "react";
import { css } from "@keystar/ui/style";

// Fuse.js match indices: inclusive on both ends, per-key, not guaranteed
// sorted or non-overlapping.
export type MatchRange = readonly [number, number];

const markStyle = css({
  backgroundColor: "rgba(250, 204, 21, 0.45)",
  borderRadius: 2,
  padding: "0 1px",
  color: "inherit",
});

type Part = { text: string; isMatch: boolean };

function toParts(
  text: string,
  indices: readonly MatchRange[],
  windowStart: number,
  windowEnd: number,
): Part[] {
  const sorted = [...indices].sort((a, b) => a[0] - b[0]);
  const parts: Part[] = [];
  let cursor = windowStart;
  for (const [start, end] of sorted) {
    const clampedStart = Math.max(start, cursor);
    const clampedEnd = Math.min(end + 1, windowEnd);
    if (clampedEnd <= cursor) continue;
    if (clampedStart > cursor) {
      parts.push({ text: text.slice(cursor, clampedStart), isMatch: false });
    }
    parts.push({ text: text.slice(clampedStart, clampedEnd), isMatch: true });
    cursor = clampedEnd;
  }
  if (cursor < windowEnd) {
    parts.push({ text: text.slice(cursor, windowEnd), isMatch: false });
  }
  return parts;
}

function renderParts(parts: Part[]) {
  return parts.map((part, i) =>
    part.isMatch ? (
      <mark key={i} className={markStyle}>
        {part.text}
      </mark>
    ) : (
      <Fragment key={i}>{part.text}</Fragment>
    ),
  );
}

// Full text, every match highlighted - used by the content preview dialog,
// which has room to show the whole body.
export function HighlightedText(props: {
  text: string;
  indices?: readonly MatchRange[];
}) {
  if (!props.indices?.length) return <>{props.text}</>;
  return <>{renderParts(toParts(props.text, props.indices, 0, props.text.length))}</>;
}

// A window around the first match, biased toward showing what comes after
// it rather than centering: the cell clamps to 2 lines, which cuts from the
// end, so keeping little context *before* the match is what keeps the match
// itself from landing past the clamp on a long snippet.
export function HighlightedSnippet(props: {
  text: string;
  indices: readonly MatchRange[];
  leadingChars?: number;
  trailingChars?: number;
}) {
  const { text, indices, leadingChars = 12, trailingChars = 40 } = props;
  if (!indices.length) return <>{text}</>;
  const sorted = [...indices].sort((a, b) => a[0] - b[0]);
  const first = sorted[0];
  const windowStart = Math.max(0, first[0] - leadingChars);
  const windowEnd = Math.min(text.length, first[1] + 1 + trailingChars);
  return (
    <>
      {windowStart > 0 && "…"}
      {renderParts(toParts(text, indices, windowStart, windowEnd))}
      {windowEnd < text.length && "…"}
    </>
  );
}
