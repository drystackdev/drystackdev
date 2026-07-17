import { useId } from "react";

import { css, keyframes } from "@keystar/ui/style";

// The AI icons are the one place in the admin that isn't monochrome: the
// shifting gradient is what marks "this button writes for you" at a glance.
// Both AI icons share it, so the two buttons read as the same feature.
const STOPS = ["#8b5cf6", "#ec4899", "#06b6d4"];

// Each stop walks the same colours, offset by one, so the gradient is never
// flat - the two ends are always a different colour on the way somewhere else.
const cycle = (offset: number) =>
  keyframes(
    Object.fromEntries(
      // The last frame repeats the first, or the loop would jump on restart.
      [...STOPS, STOPS[0]].map((_, i) => [
        `${(i / STOPS.length) * 100}%`,
        { stopColor: STOPS[(i + offset) % STOPS.length] },
      ]),
    ),
  );

const stopStyle = (offset: number) =>
  css({
    animation: `${cycle(offset)} 6s ease-in-out infinite`,
    // Decorative motion - it carries no information the colour doesn't.
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  });

const stopA = stopStyle(0);
const stopB = stopStyle(1);

/**
 * A filled glyph painted with the animated AI gradient.
 *
 * `Icon` styles its <svg> with `fill: none; stroke: currentColor` for the
 * stroke-based icon set it ships; these glyphs are filled, so they flip both.
 * Without `stroke="none"` the 2px stroke would outline every sparkle.
 *
 * The `fill` attribute stays `currentColor` as a fallback - a class beats a
 * presentation attribute, so the gradient wins wherever it resolves, and a
 * disabled button (whose whole point is looking inert) drops back to the
 * dimmed text colour rather than staying brightly animated.
 */
export function AiGlyph(props: { d: string }) {
  // The gradient is referenced by id, and several of these can be mounted at
  // once (one per field). A shared id would leave every icon pointing at
  // whichever <defs> happened to render first - and repainting when that one
  // unmounted.
  const id = `drystack-ai-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={STOPS[0]} className={stopA} />
          <stop offset="100%" stopColor={STOPS[1]} className={stopB} />
        </linearGradient>
      </defs>
      <path
        d={props.d}
        fill="currentColor"
        stroke="none"
        className={css({
          fill: `url(#${id})`,
          'button:disabled &, [aria-disabled="true"] &': {
            fill: "currentColor",
          },
        })}
      />
    </>
  );
}
