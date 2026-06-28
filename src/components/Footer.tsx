import type * as React from "react"

type Link = { href: string; label: string }
type Social = { icon: string; label: string; href: string }

type FooterProps = {
  description?: string
  serviceLinks?: Link[]
  companyLinks?: Link[]
  socials?: Social[]
  copyright?: string
  credit?: string
}

const DEFAULT_SERVICE_LINKS: Link[] = [
  { href: "#services", label: "Thiết kế Website" },
  { href: "#services", label: "Thiết kế Logo" },
  { href: "#services", label: "Branding" },
  { href: "#services", label: "Viết bài SEO" },
]
const DEFAULT_COMPANY_LINKS: Link[] = [
  { href: "#about", label: "Về chúng tôi" },
  { href: "#team", label: "Đội ngũ" },
  { href: "#projects", label: "Dự án" },
  { href: "#blog", label: "Blog" },
]
const DEFAULT_SOCIALS: Social[] = [
  { icon: "logos:facebook", label: "Facebook", href: "https://facebook.com/drystack" },
  { icon: "logos:tiktok-icon", label: "TikTok", href: "https://tiktok.com/@drystack" },
  { icon: "logos:telegram", label: "Telegram", href: "https://t.me/drystack" },
  { icon: "simple-icons:zalo", label: "Zalo", href: "https://zalo.me/0866442504" },
]

const colTitle: React.CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "rgba(245,236,224,0.35)", marginBottom: 18 }

export default function Footer({
  description = "Team freelance chuyên thiết kế website & branding cho doanh nghiệp Việt. Giá rẻ, chất lượng đỉnh.",
  serviceLinks = DEFAULT_SERVICE_LINKS,
  companyLinks = DEFAULT_COMPANY_LINKS,
  socials = DEFAULT_SOCIALS,
  copyright = "© 2024 DryStack. All rights reserved.",
  credit = "Made by Thanh Khan in Việt Nam",
}: FooterProps) {
  return (
    <footer style={{ position: "relative", zIndex: 12, marginTop: -48, borderRadius: "52px 52px 0 0", borderTop: "1px solid rgba(255,200,90,0.08)", padding: "90px clamp(20px,5vw,40px) 40px", background: "#0a0703", boxShadow: "0 -24px 60px rgba(0,0,0,0.5)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))", gap: 44, marginBottom: 52 }}>
          <div style={{ minWidth: 220 }}>
            <div style={{ display: "flex", alignItems: "center", fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.5px", marginBottom: 16 }}>
              <div style={{ width: 30, height: 30, borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(#1a1206,#1a1206) padding-box, linear-gradient(135deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent", marginRight: 10 }}>
                <iconify-icon icon="solar:layers-bold-duotone" style={{ fontSize: 16, color: "#ffb13d" }} />
              </div>
              <span className="ds-grad-text">Dry</span>Stack<span style={{ color: "rgba(245,236,224,0.4)", fontWeight: 600 }}>.dev</span>
            </div>
            <p style={{ fontSize: 14, color: "rgba(245,236,224,0.42)", lineHeight: 1.75, maxWidth: 260, fontWeight: 300, marginBottom: 22 }}>{description}</p>
            <div style={{ display: "flex", gap: 10 }}>
              {socials.map((s, i) => (
                <a key={i} href={s.href} target="_blank" rel="noopener noreferrer" className="ds-social" aria-label={s.label} style={{ width: 38, height: 38, background: "rgba(255,200,90,0.06)", border: "1px solid rgba(255,200,90,0.12)", borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <iconify-icon icon={s.icon} style={{ fontSize: 18 }} />
                </a>
              ))}
            </div>
          </div>
          <div>
            <div style={colTitle}>DỊCH VỤ</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {serviceLinks.map((l, i) => (
                <a key={i} href={l.href} className="ds-flink">{l.label}</a>
              ))}
            </div>
          </div>
          <div>
            <div style={colTitle}>CÔNG TY</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {companyLinks.map((l, i) => (
                <a key={i} href={l.href} className="ds-flink">{l.label}</a>
              ))}
            </div>
          </div>
          <div>
            <div style={colTitle}>LIÊN HỆ</div>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              <a href="mailto:info@drystack.dev" className="ds-flink">info@drystack.dev</a>
              <a href="tel:0866442504" className="ds-flink">0866 442 504</a>
              <span style={{ fontSize: 14, color: "rgba(245,236,224,0.52)", fontWeight: 300 }}>Toàn quốc, Việt Nam</span>
              <a href="#pricing" className="ds-link-gold" style={{ fontSize: 14, fontWeight: 500, color: "#ffce6a" }}>Xem bảng giá →</a>
            </div>
          </div>
        </div>
        <div style={{ borderTop: "1px solid rgba(255,200,90,0.07)", paddingTop: 26, display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
          <p style={{ fontSize: 13, color: "rgba(245,236,224,0.3)", fontWeight: 300 }}>{copyright}</p>
          <p style={{ fontSize: 13, color: "rgba(245,236,224,0.3)", fontWeight: 300 }}>{credit}</p>
        </div>
      </div>
    </footer>
  )
}
