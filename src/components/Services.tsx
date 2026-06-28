import { Badge } from "@/components/ui/badge"

type Service = {
  icon: string
  title: string
  price: string
  desc: string
  tags: string[]
  hot?: boolean
}

type ServicesProps = {
  eyebrow?: string
  heading?: string
  subtitle?: string
  services?: Service[]
}

const DEFAULT_SERVICES: Service[] = [
  {
    icon: "solar:monitor-smartphone-bold-duotone",
    title: "Thiết kế Website",
    price: "Từ 2.000.000đ",
    desc: "Website chuyên nghiệp, responsive hoàn toàn, tốc độ tải nhanh, tích hợp SEO và CMS dễ quản lý.",
    tags: ["Responsive", "CMS", "SSL"],
    hot: false,
  },
  {
    icon: "solar:palette-bold-duotone",
    title: "Thiết kế Logo",
    price: "Từ 500.000đ",
    desc: "Logo độc đáo, đậm chất thương hiệu, phù hợp mọi nền tảng. Giao file vector AI, PDF, PNG.",
    tags: ["3 concept", "File AI/PDF", "Revision ∞"],
    hot: false,
  },
  {
    icon: "solar:layers-minimalistic-bold-duotone",
    title: "Branding Package",
    price: "Từ 3.000.000đ",
    desc: "Bộ nhận diện hoàn chỉnh: logo, màu sắc, typography, business card và brand guideline.",
    tags: ["Guideline", "Card", "Social Kit"],
    hot: true,
  },
  {
    icon: "solar:magnifer-zoom-in-bold-duotone",
    title: "Viết bài SEO",
    price: "Từ 200.000đ/bài",
    desc: "Nội dung chuẩn SEO, đúng ngữ nghĩa, thu hút người đọc và tối ưu để leo top Google bền vững.",
    tags: ["Keyword", "On-page", "1000–2000 từ"],
    hot: false,
  },
]

export default function Services({
  eyebrow = "DỊCH VỤ",
  heading = "Chúng tôi làm được gì cho bạn?",
  subtitle = "Từ website đến thương hiệu hoàn chỉnh — tất cả dưới một mái nhà với giá cực hợp lý.",
  services = DEFAULT_SERVICES,
}: ServicesProps) {
  return (
    <section id="services" style={{ scrollMarginTop: 100, position: "relative", zIndex: 3, marginTop: -48, borderRadius: "32px 32px 0 0", background: "#100b06", color: "#f5ece0", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.5)" }}>
      <div data-fx="parallax" data-speed="-0.4" style={{ position: "absolute", top: 50, left: -30, fontFamily: "var(--font-heading)", fontSize: "clamp(110px,16vw,200px)", fontWeight: 800, color: "rgba(255,255,255,0.022)", letterSpacing: "-9px", lineHeight: 0.8, pointerEvents: "none", whiteSpace: "nowrap" }}>
        SERVICES
      </div>
      <div style={{ maxWidth: 1180, margin: "0 auto", position: "relative" }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", textAlign: "center", marginBottom: 64 }}>
          <p className="ds-grad-text" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,4vw,52px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.12, marginBottom: 18 }}>{heading}</h2>
          <p style={{ fontSize: 17, color: "rgba(245,236,224,0.52)", maxWidth: 540, margin: "0 auto", lineHeight: 1.7, fontWeight: 300 }}>{subtitle}</p>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 22 }}>
          {services.map((s, i) => (
            <div
              key={i}
              data-fx="reveal"
              data-from="up"
              data-out="1"
              className="ds-lift5"
              style={{
                flex: "1 1 220px",
                maxWidth: 290,
                opacity: 0,
                transform: "translateY(60px) scale(0.96)",
                filter: "blur(8px)",
                willChange: "transform,opacity,filter",
                borderRadius: 22,
                padding: "32px 28px",
                ...(s.hot
                  ? { position: "relative", overflow: "hidden", background: "linear-gradient(#181009,#181009) padding-box, linear-gradient(160deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent" }
                  : { background: "linear-gradient(#181009,#181009) padding-box, linear-gradient(160deg, rgba(255,200,90,0.25), rgba(255,255,255,0.04)) border-box", border: "1px solid transparent" }),
              }}
            >
              {s.hot && (
                <div style={{ position: "absolute", top: 18, right: 18, background: "#ffab2e", color: "#1a1206", fontSize: 10, fontWeight: 800, letterSpacing: "1.5px", padding: "4px 10px", borderRadius: 100 }}>
                  HOT
                </div>
              )}
              <div style={{ width: 56, height: 56, borderRadius: 16, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 26, background: `rgba(255,170,60,${s.hot ? "0.12" : "0.1"})`, border: `1px solid rgba(255,170,60,${s.hot ? "0.25" : "0.2"})` }}>
                <iconify-icon icon={s.icon} style={{ fontSize: 30, color: "#ffb13d" }} />
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 8, marginBottom: 14 }}>
                <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 20, fontWeight: 700, letterSpacing: "-0.5px" }}>{s.title}</h3>
                <Badge className="ds-chip-price">{s.price}</Badge>
              </div>
              <p style={{ fontSize: 15, color: "rgba(245,236,224,0.55)", lineHeight: 1.75, marginBottom: 26, fontWeight: 300 }}>{s.desc}</p>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {s.tags.map((t, ti) => (
                  <Badge key={ti} className="ds-chip">{t}</Badge>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
