type Tip = {
  icon: string
  title: string
  desc: string
}

type KnowledgeProps = {
  eyebrow?: string
  heading?: string
  subtitle?: string
  tips?: Tip[]
}

const DEFAULT_TIPS: Tip[] = [
  {
    icon: "solar:rocket-2-bold",
    title: "Tối ưu tốc độ tải",
    desc: "Nén ảnh, lazy-load và CDN giúp giữ website luôn dưới 2 giây — tăng trải nghiệm và SEO.",
  },
  {
    icon: "solar:palette-bold",
    title: "Bảng màu thương hiệu",
    desc: "Chọn 2–3 màu chủ đạo và dùng nhất quán trên mọi điểm chạm để khách dễ ghi nhớ.",
  },
  {
    icon: "solar:pen-new-square-bold",
    title: "Content chuyển đổi",
    desc: "Tiêu đề rõ ràng, CTA mạnh, nói lợi ích trước khi nói tính năng để tăng tỉ lệ chốt.",
  },
  {
    icon: "solar:bug-bold",
    title: "Kiểm thử trước khi launch",
    desc: "Test đa thiết bị và automation testing để website chạy mượt, không lỗi khi lên sóng.",
  },
]

export default function Knowledge({
  eyebrow = "KIẾN THỨC",
  heading = "Chia sẻ kinh nghiệm thực chiến",
  subtitle = "Những bài học rút ra từ hơn 50 dự án thực tế — giúp bạn tránh sai lầm và làm tốt hơn.",
  tips = DEFAULT_TIPS,
}: KnowledgeProps) {
  return (
    <section id="kien-thuc" style={{ scrollMarginTop: 100, position: "relative", zIndex: 9, marginTop: -48, borderRadius: "52px 52px 0 0", background: "#100b06", color: "#f5ece0", padding: "clamp(80px,10vw,120px) clamp(20px,5vw,40px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.5)" }}>
      <div data-fx="parallax" data-speed="-0.4" style={{ position: "absolute", top: 50, left: -30, fontFamily: "var(--font-heading)", fontSize: "clamp(110px,16vw,200px)", fontWeight: 800, color: "rgba(255,255,255,0.022)", letterSpacing: "-9px", lineHeight: 0.8, pointerEvents: "none", whiteSpace: "nowrap" }}>
        KNOWLEDGE
      </div>
      <div style={{ maxWidth: 1180, margin: "0 auto", position: "relative" }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", textAlign: "center", marginBottom: 56 }}>
          <p className="ds-grad-text" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,4vw,52px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.12, marginBottom: 16 }}>{heading}</h2>
          <p style={{ fontSize: 17, color: "rgba(245,236,224,0.52)", maxWidth: 560, margin: "0 auto", lineHeight: 1.7, fontWeight: 300 }}>{subtitle}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: 20 }}>
          {tips.map((t, i) => (
            <div key={i} data-fx="reveal" data-from="up" className="ds-card-dark2" style={{ opacity: 0, transform: "translateY(50px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter", background: "#181009", border: "1px solid rgba(255,200,90,0.08)", borderRadius: 18, padding: "32px 28px" }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 20, background: "rgba(255,170,60,0.1)", border: "1px solid rgba(255,170,60,0.2)" }}>
                <iconify-icon icon={t.icon} style={{ fontSize: 28, color: "#ffb13d" }} />
              </div>
              <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 700, marginBottom: 10, letterSpacing: "-0.3px" }}>{t.title}</h3>
              <p style={{ fontSize: 13, color: "rgba(245,236,224,0.5)", lineHeight: 1.65, fontWeight: 300 }}>{t.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
