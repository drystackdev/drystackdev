import * as React from "react"

type MarqueeProps = {
  words?: string[]
}

const DEFAULT_WORDS = [
  "THIẾT KẾ WEBSITE",
  "THIẾT KẾ LOGO",
  "BRANDING",
  "VIẾT BÀI SEO",
  "UI/UX DESIGN",
  "AUTOMATION TESTING",
]

// Infinite horizontal marquee of service keywords.
export default function Marquee({ words = DEFAULT_WORDS }: MarqueeProps) {
  // Duplicated once so the -50% translate loops seamlessly.
  const items = [...words, ...words]

  return (
    <div style={{ overflow: "hidden", padding: "18px 0", borderTop: "1px solid rgba(255,200,90,0.08)", borderBottom: "1px solid rgba(255,200,90,0.08)", background: "var(--color-ds-dark)", position: "relative", zIndex: 1, marginTop: "-30vh" }}>
      <div style={{ display: "flex", gap: 46, width: "max-content", animation: "marquee 26s linear infinite", alignItems: "center" }}>
        {items.map((w, i) => (
          <React.Fragment key={i}>
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 12, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", color: "rgba(245,236,224,0.3)", whiteSpace: "nowrap" }}>
              {w}
            </span>
            <iconify-icon icon="solar:star-bold" style={{ color: i % 2 === 0 ? "#ffae3d" : "#ff8a3d", fontSize: 13 }} />
          </React.Fragment>
        ))}
      </div>
    </div>
  )
}
