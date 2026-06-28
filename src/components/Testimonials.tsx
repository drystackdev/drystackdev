import * as React from "react"
import { Card } from "@/components/ui/card"
import Globe from "@/components/Globe"

type Review = {
  quote: string
  initials: string
  avatarBg: string
  avatarColor: string
  name: string
  role: string
  from: "right" | "up" | "left"
}

type TestimonialsProps = {
  eyebrow?: string
  heading?: string
  reviews?: Review[]
}

const DEFAULT_REVIEWS: Review[] = [
  {
    quote: "DryStack giúp spa của mình có website đẹp hơn hẳn mong đợi. Giá rất hợp lý, team chuyên nghiệp và giao đúng hẹn. Khách cứ khen website đẹp liên tục!",
    initials: "NH",
    avatarBg: "#ff8a3d",
    avatarColor: "#fff",
    name: "Nguyễn Thị Hoa",
    role: "Chủ Spa Beauty by Linh",
    from: "right",
  },
  {
    quote: "Code sạch, UX tốt, SEO hiệu quả rõ rệt sau 2 tháng. Traffic tăng 3 lần. Đặc biệt khâu kiểm thử rất kỹ, web chạy mượt không lỗi. Sẽ hợp tác dài lâu!",
    initials: "TN",
    avatarBg: "#ffab2e",
    avatarColor: "#1a1206",
    name: "Trần Văn Nam",
    role: "CEO · TechViet Solutions",
    from: "up",
  },
  {
    quote: "Logo và bộ nhận diện nhà hàng giờ trông cực chuyên nghiệp. Giá chỉ 3 triệu mà chất lượng tưởng mấy chục triệu. Quá xứng đáng!",
    initials: "LM",
    avatarBg: "#e8920c",
    avatarColor: "#fff",
    name: "Lê Thị Mai",
    role: "Chủ Nhà Hàng Phở Hà Nội",
    from: "left",
  },
]

const initialStyle = (from: string): React.CSSProperties => {
  if (from === "right") return { opacity: 0, transform: "translateX(90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }
  if (from === "left") return { opacity: 0, transform: "translateX(-90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }
  return { opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter" }
}

export default function Testimonials({
  eyebrow = "ĐÁNH GIÁ",
  heading = "Khách hàng nói gì về chúng tôi",
  reviews = DEFAULT_REVIEWS,
}: TestimonialsProps) {
  return (
    <section style={{ scrollMarginTop: 100, position: "relative", zIndex: 8, marginTop: -48, borderRadius: "52px 52px 0 0", background: "#faf5ec", color: "#1a1206", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.35)" }}>
      <div data-fx="parallax" data-speed="0.45" style={{ position: "absolute", top: 50, right: -30, fontFamily: "var(--font-heading)", fontSize: "clamp(100px,15vw,180px)", fontWeight: 800, color: "rgba(26,18,6,0.03)", letterSpacing: "-9px", lineHeight: 0.8, pointerEvents: "none", whiteSpace: "nowrap" }}>
        REVIEWS
      </div>

      {/* Globe background */}
      <div style={{ position: "absolute", bottom: -60, right: -80, width: "min(560px,90vw)", height: "min(560px,90vw)", pointerEvents: "none", opacity: 0.55, zIndex: 0 }}>
        <Globe />
      </div>
      {/* fade mask so globe blends into section edges */}
      <div style={{ position: "absolute", inset: 0, background: "radial-gradient(ellipse 60% 80% at 100% 100%, transparent 30%, #faf5ec 72%)", pointerEvents: "none", zIndex: 1 }} />
      <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative", zIndex: 2 }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", textAlign: "center", marginBottom: 60 }}>
          <p className="ds-grad-text-light" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,4vw,52px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.12, color: "#1a1206" }}>{heading}</h2>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 22 }}>
          {reviews.map((r, i) => (
            <Card key={i} data-fx="reveal" data-from={r.from} className="ds-tcard" style={initialStyle(r.from)}>
              <div style={{ color: "#ffae3d", fontSize: 16, display: "flex", gap: 2 }}>
                {Array.from({ length: 5 }).map((_, si) => (
                  <iconify-icon key={si} icon="solar:star-bold" />
                ))}
              </div>
              <p style={{ fontSize: 15, color: "rgba(26,18,6,0.7)", lineHeight: 1.8, fontStyle: "italic" }}>{r.quote}</p>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: "auto", paddingTop: 18, borderTop: "1px solid rgba(26,18,6,0.07)" }}>
                <div style={{ width: 42, height: 42, background: r.avatarBg, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-heading)", fontSize: 14, fontWeight: 800, color: r.avatarColor }}>
                  {r.initials}
                </div>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: "#1a1206" }}>{r.name}</div>
                  <div style={{ fontSize: 12, color: "rgba(26,18,6,0.45)" }}>{r.role}</div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      </div>
    </section>
  )
}
