import { useId } from "react";

import { css, keyframes } from "@keystar/ui/style";

import { AI_GRADIENT_DURATION, AI_GRADIENT_STOPS as STOPS } from "./ai-gradient";

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
    animation: `${cycle(offset)} ${AI_GRADIENT_DURATION} ease-in-out infinite`,
    // Decorative motion - it carries no information the colour doesn't.
    "@media (prefers-reduced-motion: reduce)": { animation: "none" },
  });

const stopA = stopStyle(0);
const stopB = stopStyle(1);

const TWINKLE_DURATION_MS = 3000;

// Sparkles dim and shrink rather than vanish: at the floor the star is still
// faintly there, so the glyph never looks like it lost a piece.
const twinkle = keyframes({
  "0%, 100%": { opacity: 1, transform: "scale(1)" },
  "50%": { opacity: 0.2, transform: "scale(0.65)" },
});

/**
 * Motion for one sparkle of a multi-part glyph.
 *
 * The negative delay starts each star part-way through the loop, so they're
 * already spread across the cycle on the very first frame instead of pulsing
 * in unison and only drifting apart later - and with them out of phase, at
 * least one star is always near full opacity.
 */
const twinkleStyles = (index: number, count: number) => ({
  animation: `${twinkle} ${TWINKLE_DURATION_MS}ms ease-in-out infinite`,
  animationDelay: `-${Math.round((index * TWINKLE_DURATION_MS) / count)}ms`,
  // Scale each star about its own centre. Without `fill-box` the origin is the
  // whole 24x24 viewBox, and the outlying sparkles would swing toward the
  // middle as they shrink instead of staying put.
  transformBox: "fill-box" as const,
  transformOrigin: "center",
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
});

/**
 * A filled glyph painted with the animated AI gradient.
 *
 * Pass an array of path data to animate the parts independently - each entry
 * twinkles out of phase with the others. A single string renders one static
 * path; splitting a glyph is only worth it when the parts read as separate
 * marks (the sparkles), not for every shape in the icon.
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
export function AiGlyph(props: { d: string | readonly string[] }) {
  // The gradient is referenced by id, and several of these can be mounted at
  // once (one per field). A shared id would leave every icon pointing at
  // whichever <defs> happened to render first - and repainting when that one
  // unmounted.
  const id = `drystack-ai-gradient-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;

  const paths = typeof props.d === "string" ? [props.d] : props.d;
  const isAnimated = paths.length > 1;

  return (
    <>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={STOPS[0]} className={stopA} />
          <stop offset="100%" stopColor={STOPS[1]} className={stopB} />
        </linearGradient>
      </defs>
      {paths.map((d, i) => (
        <path
          key={d}
          d={d}
          fill="currentColor"
          stroke="none"
          className={css({
            fill: `url(#${id})`,
            ...(isAnimated ? twinkleStyles(i, paths.length) : null),
            'button:disabled &, [aria-disabled="true"] &': {
              fill: "currentColor",
              // Inert means still, too - a disabled button that keeps
              // twinkling reads as though it's working.
              animation: "none",
              opacity: 1,
              transform: "none",
            },
          })}
        />
      ))}
    </>
  );
}
