import { keyframes } from "@keystar/ui/style";

/**
 * The AI gradient palette - the one place in the admin that isn't monochrome.
 *
 * The glyphs paint it as an SVG gradient and the Magic write button as a CSS
 * one, so it can't live in either: the two have to walk the same colours or
 * the button and the icon sitting inside it read as two different features.
 */
export const AI_GRADIENT_STOPS = ["#8b5cf6", "#ec4899", "#06b6d4"];

/** One full trip through the palette, shared by the glyph and the button. */
export const AI_GRADIENT_DURATION = "6s";

// The first colour is repeated at the end so scrolling a full width lands back
// on the colour it started from - without it the loop snaps at the seam.
const SWEEP = `linear-gradient(120deg, ${[...AI_GRADIENT_STOPS, AI_GRADIENT_STOPS[0]].join(", ")})`;

const scroll = keyframes({ to: { backgroundPosition: "200% center" } });

/**
 * The palette as a CSS background that drifts sideways forever.
 *
 * Spread onto anything that paints a background - a border ring, or text via
 * `background-clip: text`. The element gets twice its own width of gradient so
 * there's always more colour off-screen to scroll in.
 */
export const aiGradientSweep = {
  backgroundImage: SWEEP,
  backgroundSize: "200% auto",
  animation: `${scroll} ${AI_GRADIENT_DURATION} linear infinite`,
  // Decorative motion - it carries no information the colour doesn't.
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;
