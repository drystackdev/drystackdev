import TeamCarousel from "@/components/TeamCarousel"

type TeamProps = {
  eyebrow?: string
  heading?: string
}

export default function Team({
  eyebrow = "ĐỘI NGŨ",
  heading = "Con người đằng sau DryStack",
}: TeamProps) {
  return (
    <section id="team" style={{ scrollMarginTop: 100, position: "relative", zIndex: 6, marginTop: -48, borderRadius: "52px 52px 0 0", background: "#faf5ec", color: "#1a1206", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.35)" }}>
      <div data-fx="parallax" data-speed="-0.4" style={{ position: "absolute", top: 60, left: -30, fontFamily: "var(--font-heading)", fontSize: "clamp(110px,16vw,200px)", fontWeight: 800, color: "rgba(26,18,6,0.03)", letterSpacing: "-9px", lineHeight: 0.8, pointerEvents: "none", whiteSpace: "nowrap" }}>
        TEAM
      </div>
      <div style={{ maxWidth: 1180, margin: "0 auto", position: "relative" }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", textAlign: "center", marginBottom: 60 }}>
          <p className="ds-grad-text-light" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,4vw,52px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.12, color: "#1a1206" }}>{heading}</h2>
        </div>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter" }}>
          <TeamCarousel />
        </div>
      </div>
    </section>
  )
}
