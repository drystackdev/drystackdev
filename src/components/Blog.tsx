import { Badge } from "@/components/ui/badge"

type Post = {
  icon: string
  cat: string
  title: string
  excerpt: string
  meta: string
}

type BlogProps = {
  eyebrow?: string
  heading?: string
  ctaLabel?: string
  ctaHref?: string
  posts?: Post[]
}

const DEFAULT_POSTS: Post[] = [
  {
    icon: "solar:monitor-bold-duotone",
    cat: "Website",
    title: "5 lý do doanh nghiệp nhỏ cần website chuyên nghiệp 2024",
    excerpt: "Nhiều chủ doanh nghiệp vẫn nghĩ website là thứ xa xỉ. Nhưng thực tế ngược lại...",
    meta: "15 tháng 3, 2024 · 5 phút đọc",
  },
  {
    icon: "solar:palette-round-bold-duotone",
    cat: "Branding",
    title: "Branding là gì và tại sao quan trọng với mọi doanh nghiệp?",
    excerpt: "Branding không chỉ là logo hay màu sắc. Đó là toàn bộ cảm xúc khách hàng cảm nhận...",
    meta: "2 tháng 4, 2024 · 7 phút đọc",
  },
  {
    icon: "solar:graph-up-bold-duotone",
    cat: "SEO",
    title: "SEO On-page 2024: Checklist đầy đủ cho người mới",
    excerpt: "Tối ưu SEO không cần phức tạp. Với checklist này, bạn có thể tự làm ngay hôm nay...",
    meta: "18 tháng 4, 2024 · 8 phút đọc",
  },
]

export default function Blog({
  eyebrow = "BLOG",
  heading = "Kiến thức miễn phí từ DryStack",
  ctaLabel = "Xem tất cả",
  ctaHref = "/blog",
  posts = DEFAULT_POSTS,
}: BlogProps) {
  return (
    <section id="blog" style={{ scrollMarginTop: 100, position: "relative", zIndex: 10, marginTop: -48, borderRadius: "52px 52px 0 0", background: "#100b06", color: "#f5ece0", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.5)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 54, flexWrap: "wrap", gap: 24 }}>
          <div>
            <p className="ds-grad-text" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(28px,3.5vw,46px)", fontWeight: 800, letterSpacing: "-1px", lineHeight: 1.15 }}>{heading}</h2>
          </div>
          <a href={ctaHref} className="ds-link-gold" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#ffce6a", fontSize: 14, fontWeight: 600, padding: "12px 22px", borderRadius: 100, background: "linear-gradient(#140e07,#140e07) padding-box, linear-gradient(120deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent" }}>
            {ctaLabel} <iconify-icon icon="solar:arrow-right-linear" style={{ fontSize: 16 }} />
          </a>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 22 }}>
          {posts.map((p, i) => (
            <div key={i} data-fx="reveal" data-from="up" className="ds-card-dark2" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", background: "#181009", border: "1px solid rgba(255,200,90,0.08)", borderRadius: 18, overflow: "hidden", cursor: "pointer" }}>
              <div style={{ height: 158, background: "#0c0905", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,200,90,0.05) 1px, transparent 1px)", backgroundSize: "20px 20px" }} />
                <iconify-icon icon={p.icon} style={{ fontSize: 46, color: "rgba(255,180,60,0.25)", position: "relative" }} />
              </div>
              <div style={{ padding: "24px 26px" }}>
                <Badge className="ds-chip-cat">{p.cat}</Badge>
                <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 700, lineHeight: 1.4, margin: "14px 0 12px", letterSpacing: "-0.3px" }}>{p.title}</h3>
                <p style={{ fontSize: 13, color: "rgba(245,236,224,0.42)", marginBottom: 18, lineHeight: 1.6, fontWeight: 300 }}>{p.excerpt}</p>
                <div style={{ fontSize: 12, color: "rgba(245,236,224,0.3)" }}>{p.meta}</div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
