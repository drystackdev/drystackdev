import * as React from "react"

type Plan = {
  name: string
  price: React.ReactNode
  unit: string
  features: string[]
  ctaLabel: string
  ctaHref?: string
  featured?: boolean
  /** reveal direction handled by the global FX engine */
  from?: "right" | "up" | "left"
  /** starting angle for the rotating accent border (non-featured) */
  accentFrom?: number
}

type PricingProps = {
  eyebrow?: string
  heading?: string
  subtitle?: string
  badge?: string
  plans?: Plan[]
}

const DEFAULT_PLANS: Plan[] = [
  {
    name: "STARTER",
    price: <>2 <span style={{ fontSize: 22 }}>triệu</span></>,
    unit: "đồng / dự án",
    features: ["Website Landing Page", "Responsive & Mobile-first", "SSL miễn phí", "SEO cơ bản", "Bảo hành 1 tháng"],
    ctaLabel: "Bắt đầu ngay",
    from: "right",
    accentFrom: 0,
  },
  {
    name: "PRO",
    price: <>5 <span style={{ fontSize: 22 }}>triệu</span></>,
    unit: "đồng / dự án",
    features: ["Website đa trang (5–10 trang)", "Logo + Brand cơ bản", "CMS Dashboard đầy đủ", "SEO On-page chuyên sâu", "Automation Testing", "Bảo hành 3 tháng"],
    ctaLabel: "Chọn gói Pro",
    featured: true,
    from: "up",
  },
  {
    name: "ENTERPRISE",
    price: <span style={{ fontSize: 32 }}>Thương lượng</span>,
    unit: "tùy quy mô dự án",
    features: ["Trọn gói Web + Logo + Brand", "SEO Content 3 tháng", "Social Media Kit đầy đủ", "Tư vấn chiến lược thương hiệu", "Priority support 12 tháng", "Bảo hành 12 tháng"],
    ctaLabel: "Liên hệ tư vấn",
    from: "left",
    accentFrom: 180,
  },
]

const revealInit = (from: Plan["from"]): React.CSSProperties => {
  if (from === "right") return { opacity: 0, transform: "translateX(90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }
  if (from === "left") return { opacity: 0, transform: "translateX(-90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }
  return { opacity: 0, transform: "translateY(40px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }
}

function StandardCard({ plan }: { plan: Plan }) {
  return (
    <div data-fx="reveal" data-from={plan.from} style={{ ...revealInit(plan.from), position: "relative", borderRadius: 23, padding: 2, overflow: "hidden" }}>
      <div style={{ position: "absolute", top: "50%", left: "50%", width: "160%", height: "160%", background: `conic-gradient(from ${plan.accentFrom ?? 0}deg, transparent 0deg 280deg, rgba(255,210,74,0.9) 320deg, rgba(255,138,61,0.7) 345deg, transparent 360deg)`, animation: "spin 5s linear infinite", pointerEvents: "none" }} />
      <div style={{ position: "relative", background: "#181009", borderRadius: 21, padding: "38px 34px", display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 700, letterSpacing: "2px", color: "rgba(245,236,224,0.45)", textTransform: "uppercase", marginBottom: 12 }}>{plan.name}</div>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 42, fontWeight: 800, letterSpacing: "-2px", lineHeight: 1, marginBottom: 4 }}>{plan.price}</div>
        <div style={{ fontSize: 13, color: "rgba(245,236,224,0.38)", marginBottom: 30 }}>{plan.unit}</div>
        <div style={{ height: 1, background: "rgba(255,200,90,0.1)", marginBottom: 30 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 13, marginBottom: 32 }}>
          {plan.features.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "rgba(245,236,224,0.72)" }}>
              <iconify-icon icon="solar:check-circle-bold" style={{ fontSize: 18, color: "#ffae3d" }} /> {f}
            </div>
          ))}
        </div>
        <a href={plan.ctaHref ?? "#contact"} className="ds-link-gold" style={{ display: "block", textAlign: "center", padding: 14, borderRadius: 12, fontSize: 14, fontWeight: 600, color: "#ffce6a", background: "linear-gradient(#181009,#181009) padding-box, linear-gradient(120deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent" }}>{plan.ctaLabel}</a>
      </div>
    </div>
  )
}

function FeaturedCard({ plan, badge }: { plan: Plan; badge: string }) {
  return (
    <div data-fx="reveal" data-from={plan.from} style={{ ...revealInit(plan.from), position: "relative", borderRadius: 22, padding: 2, overflow: "hidden", zIndex: 2 }}>
      <div style={{ position: "absolute", top: "50%", left: "50%", width: "170%", height: "170%", background: "conic-gradient(from 0deg, transparent 0deg 250deg, #ffd24a 300deg, #ff7a3d 330deg, #ffe7a8 348deg, transparent 360deg)", animation: "spin 4s linear infinite", pointerEvents: "none" }} />
      <div style={{ position: "relative", background: "#15100a", borderRadius: 20, padding: "38px 34px", display: "flex", flexDirection: "column", height: "100%" }}>
        <div style={{ position: "absolute", top: -2, left: "50%", transform: "translateX(-50%)", background: "#ffab2e", color: "#1a1206", fontSize: 11, fontWeight: 800, letterSpacing: "2px", padding: "5px 18px", borderRadius: "0 0 12px 12px", whiteSpace: "nowrap" }}>{badge}</div>
        <div className="ds-grad-text" style={{ fontFamily: "var(--font-heading)", fontSize: 13, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", marginBottom: 12, marginTop: 8 }}>{plan.name}</div>
        <div style={{ fontFamily: "var(--font-heading)", fontSize: 42, fontWeight: 800, letterSpacing: "-2px", lineHeight: 1, marginBottom: 4 }}>{plan.price}</div>
        <div style={{ fontSize: 13, color: "rgba(245,236,224,0.38)", marginBottom: 30 }}>{plan.unit}</div>
        <div style={{ height: 1, background: "rgba(255,200,90,0.18)", marginBottom: 30 }} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 13, marginBottom: 32 }}>
          {plan.features.map((f, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "rgba(245,236,224,0.85)" }}>
              <iconify-icon icon="solar:check-circle-bold" style={{ fontSize: 18, color: "#ffae3d" }} /> {f}
            </div>
          ))}
        </div>
        <a href={plan.ctaHref ?? "#contact"} className="ds-btn-pro" style={{ display: "block", textAlign: "center", padding: 15, background: "#ffab2e", borderRadius: 12, fontSize: 14, fontWeight: 700, color: "#1a1206" }}>{plan.ctaLabel}</a>
      </div>
    </div>
  )
}

export default function Pricing({
  eyebrow = "GIÁ CẢ",
  heading = "Minh bạch, không phát sinh",
  subtitle = "Chọn gói phù hợp với nhu cầu của bạn. Tất cả đều có thể tùy chỉnh.",
  badge = "✦ PHỔ BIẾN NHẤT",
  plans = DEFAULT_PLANS,
}: PricingProps) {
  return (
    <section id="pricing" style={{ scrollMarginTop: 100, position: "relative", zIndex: 7, marginTop: -48, borderRadius: "52px 52px 0 0", background: "#100b06", color: "#f5ece0", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.5)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", textAlign: "center", marginBottom: 60 }}>
          <p className="ds-grad-text" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,4vw,52px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.12, marginBottom: 16 }}>{heading}</h2>
          <p style={{ fontSize: 17, color: "rgba(245,236,224,0.5)", maxWidth: 500, margin: "0 auto", fontWeight: 300, lineHeight: 1.7 }}>{subtitle}</p>
        </div>
        <div className="pricing-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1.15fr 1fr", gap: 22, alignItems: "center" }}>
          {plans.map((plan, i) =>
            plan.featured ? <FeaturedCard key={i} plan={plan} badge={badge} /> : <StandardCard key={i} plan={plan} />
          )}
        </div>
      </div>
    </section>
  )
}
