// The outer frame always stays the toolbar's normal icon color - only the
// "A" glyph tints to reflect the active mark's color (or `currentColor` when
// there's no selection, a mix of colors, or no color set).
export function textColorIcon(activeColor?: string) {
  return (
    <g strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}>
      <rect x="3.75" y="3.75" width="16.5" height="16.5" rx="4" />
      <path
        stroke={activeColor ?? "currentColor"}
        d="m8.25 16l1.34-3.063m0 0h4.82m-4.82 0l2.051-4.694a.386.386 0 0 1 .718 0l2.052 4.694m0 0L15.75 16"
      />
    </g>
  );
}
