import * as React from "react"

type AboutProps = {
  eyebrow?: string
  heading?: React.ReactNode
  paragraphs?: React.ReactNode[]
  points?: string[]
}

const DEFAULT_POINTS = [
  "Tư vấn miễn phí, báo giá trong 24h",
  "Giao sản phẩm đúng deadline cam kết",
  "Hỗ trợ sau bàn giao, bảo hành dài hạn",
]

const DEFAULT_HEADING = (
  <>
    Thương hiệu mạnh
    <br />
    bắt đầu từ đây
  </>
)

const DEFAULT_PARAGRAPHS: React.ReactNode[] = [
  "DryStack là team freelance chuyên thiết kế website và branding cho doanh nghiệp vừa và nhỏ trên toàn quốc. Mọi doanh nghiệp đều xứng đáng có thương hiệu đẳng cấp — dù ngân sách lớn hay nhỏ.",
  <>
    Với phương châm <strong style={{ color: "#1a1206", fontWeight: 700 }}>"Giá rẻ, chất lượng đỉnh"</strong>, chúng tôi đã đồng hành cùng hơn 50 doanh nghiệp.
  </>,
]

// About — light section with rotating accent, 3D mouse-track card, and staggered reveal text.
export default function About({
  eyebrow = "VỀ CHÚNG TÔI",
  heading = DEFAULT_HEADING,
  paragraphs = DEFAULT_PARAGRAPHS,
  points = DEFAULT_POINTS,
}: AboutProps) {
  const cardRef = React.useRef<HTMLDivElement>(null)
  const shineRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const card = cardRef.current
    const shine = shineRef.current
    if (!card || !shine) return

    const onMove = (e: MouseEvent) => {
      const r = card.getBoundingClientRect()
      const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
      const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)

      const rotX = (-dy * 9).toFixed(2)
      const rotY = (dx * 9).toFixed(2)

      card.style.transition = "transform 0.12s ease-out, box-shadow 0.12s ease-out"
      card.style.transform = `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(1.025)`
      card.style.boxShadow = `0 40px 80px rgba(26,18,6,0.18), ${-dx * 8}px ${-dy * 8}px 28px rgba(255,160,50,0.10)`

      const sx = ((e.clientX - r.left) / r.width * 100).toFixed(1)
      const sy = ((e.clientY - r.top) / r.height * 100).toFixed(1)
      shine.style.background = `radial-gradient(circle at ${sx}% ${sy}%, rgba(255,255,255,0.22) 0%, rgba(255,220,120,0.06) 40%, transparent 65%)`
      shine.style.opacity = "1"
    }

    const onLeave = () => {
      card.style.transition = "transform 0.55s cubic-bezier(0.2,0.8,0.2,1), box-shadow 0.55s"
      card.style.transform = ""
      card.style.boxShadow = ""
      shine.style.opacity = "0"
    }

    card.addEventListener("mousemove", onMove)
    card.addEventListener("mouseleave", onLeave)
    return () => {
      card.removeEventListener("mousemove", onMove)
      card.removeEventListener("mouseleave", onLeave)
    }
  }, [])

  return (
    <section id="about" style={{ scrollMarginTop: 100, position: "relative", zIndex: 2, marginTop: -48, background: "#faf5ec", color: "#1a1206", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.35)", borderRadius: "32px 32px 0 0" }}>
      <div data-fx="parallax" data-speed="0.45" style={{ position: "absolute", top: 30, right: -30, fontFamily: "var(--font-heading)", fontSize: "clamp(120px,18vw,210px)", fontWeight: 800, color: "rgba(26,18,6,0.035)", letterSpacing: "-10px", lineHeight: 0.8, pointerEvents: "none", whiteSpace: "nowrap" }}>
        ABOUT
      </div>
      <div style={{ maxWidth: 1180, margin: "0 auto", position: "relative" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(310px,1fr))", gap: 64, alignItems: "center" }}>

          {/* LEFT: 3D mouse-track card */}
          <div data-fx="reveal" data-from="right" style={{ opacity: 0, transform: "translateX(90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter", position: "relative" }}>
            <div data-fx="rotate" data-rot="-25" style={{ position: "absolute", top: -24, left: -24, width: 120, height: 120, borderRadius: 28, background: "linear-gradient(135deg,#ffd24a,#ff8a3d)", opacity: 0.85, zIndex: 0 }} />
            <div ref={cardRef} style={{ position: "relative", zIndex: 1, background: "#ffffff", borderRadius: 26, padding: "clamp(36px,4vw,52px) clamp(30px,3.5vw,46px)", boxShadow: "0 30px 70px rgba(26,18,6,0.12)", overflow: "hidden", transformOrigin: "center center", willChange: "transform", transition: "transform 0.18s ease-out, box-shadow 0.18s ease-out", cursor: "default" }}>
              {/* shine overlay */}
              <div ref={shineRef} style={{ position: "absolute", inset: 0, borderRadius: 26, pointerEvents: "none", opacity: 0, transition: "opacity 0.3s", zIndex: 10 }} />

              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 22 }}>
                <div style={{ width: 40, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(#1a1206,#1a1206) padding-box, linear-gradient(135deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent", flexShrink: 0 }}>
                  <iconify-icon icon="solar:layers-bold-duotone" style={{ fontSize: 22, color: "#ffb13d" }} />
                </div>
                <div style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 800, letterSpacing: "-0.5px", lineHeight: 1, color: "#1a1206" }}>
                  <span style={{ background: "linear-gradient(120deg,#e8920c,#ff6a2d)", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent" }}>Dry</span>Stack<span style={{ color: "rgba(26,18,6,0.35)", fontWeight: 600 }}>.dev</span>
                </div>
              </div>
              <div className="ds-grad-text-light" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 10 }}>✦ EST. 2022 · TOÀN QUỐC</div>
              <p style={{ fontSize: 15, color: "rgba(26,18,6,0.6)", lineHeight: 1.7, maxWidth: 300 }}>Team freelance tận tâm, chuyên xây dựng thương hiệu số cho doanh nghiệp Việt với giá phải chăng.</p>
              <div style={{ marginTop: 34, height: 1, background: "linear-gradient(90deg, rgba(255,140,50,0.5), transparent)" }} />
              <div style={{ marginTop: 20, display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 8, height: 8, background: "#ff8a3d", borderRadius: "50%", animation: "blink 2.5s infinite" }} />
                <span style={{ fontSize: 13, color: "rgba(26,18,6,0.5)" }}>Đang nhận dự án mới</span>
              </div>
            </div>
          </div>

          {/* RIGHT: single reveal block */}
          <div data-fx="reveal" data-from="left" style={{ opacity: 0, transform: "translateX(-90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }}>
            <p className="ds-grad-text-light" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 16 }}>{eyebrow}</p>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,3.8vw,48px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.15, marginBottom: 24, color: "#1a1206" }}>{heading}</h2>
            {paragraphs.map((p, i) => (
              <p key={i} style={{ fontSize: 16, color: "rgba(26,18,6,0.62)", lineHeight: 1.82, marginBottom: i === paragraphs.length - 1 ? 38 : 18 }}>{p}</p>
            ))}
            <div style={{ display: "flex", flexDirection: "column", gap: 15 }}>
              {points.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <iconify-icon icon="solar:check-circle-bold" style={{ fontSize: 24, color: "#ff8a3d", flexShrink: 0 }} />
                  <span style={{ fontSize: 15, color: "rgba(26,18,6,0.75)" }}>{p}</span>
                </div>
              ))}
            </div>
          </div>

        </div>
      </div>
    </section>
  )
}
