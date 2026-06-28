import * as React from "react"
import { Badge } from "@/components/ui/badge"

type Project = {
  initials: string
  title: string
  type: string
  tagsText: string
}

type ProjectsProps = {
  eyebrow?: string
  heading?: React.ReactNode
  ctaLabel?: string
  ctaHref?: string
  projects?: Project[]
}

const DEFAULT_PROJECTS: Project[] = [
  { initials: "NK", title: "Nha Khoa Smile", type: "Website + Logo", tagsText: "Next.js · Figma · SEO" },
  { initials: "PH", title: "Phở Hà Nội", type: "Website + Branding", tagsText: "Astro · Strapi" },
  { initials: "TV", title: "TechViet Solutions", type: "Website Doanh Nghiệp", tagsText: "React · Node.js · GraphQL" },
  { initials: "BL", title: "Beauty by Linh", type: "Website + Branding", tagsText: "Next.js · Figma" },
  { initials: "GF", title: "GreenFarm Store", type: "E-Commerce Website", tagsText: "Astro · Strapi · SEO" },
  { initials: "LT", title: "LogiTrans Việt", type: "Website + Branding", tagsText: "React · Tailwind" },
]

const DEFAULT_HEADING = (
  <>
    Những gì chúng tôi
    <br />
    đã làm
  </>
)

export default function Projects({
  eyebrow = "DỰ ÁN",
  heading = DEFAULT_HEADING,
  ctaLabel = "Xem tất cả",
  ctaHref = "#contact",
  projects = DEFAULT_PROJECTS,
}: ProjectsProps) {
  return (
    <section id="projects" style={{ scrollMarginTop: 100, position: "relative", marginTop: -48, borderRadius: "52px 52px 0 0", background: "#100b06", color: "#f5ece0", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.5)", zIndex: 5 }}>
      <div data-fx="parallax" data-speed="0.45" style={{ position: "absolute", top: 50, right: -30, fontFamily: "var(--font-heading)", fontSize: "clamp(110px,16vw,200px)", fontWeight: 800, color: "rgba(255,255,255,0.022)", letterSpacing: "-9px", lineHeight: 0.8, pointerEvents: "none", whiteSpace: "nowrap" }}>
        WORK
      </div>
      <div style={{ maxWidth: 1180, margin: "0 auto", position: "relative" }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 54, flexWrap: "wrap", gap: 24 }}>
          <div>
            <p className="ds-grad-text" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
            <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,4vw,52px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.12 }}>{heading}</h2>
          </div>
          <a href={ctaHref} className="ds-link-gold" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#ffce6a", fontSize: 14, fontWeight: 600, padding: "12px 22px", borderRadius: 100, background: "linear-gradient(#140e07,#140e07) padding-box, linear-gradient(120deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent" }}>
            {ctaLabel} <iconify-icon icon="solar:arrow-right-linear" style={{ fontSize: 16 }} />
          </a>
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: 20 }}>
          {projects.map((p, i) => (
            <div key={i} data-fx="reveal" data-from="up" className="ds-card-dark" style={{ flex: "1 1 270px", maxWidth: 380, opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", background: "#181009", border: "1px solid rgba(255,200,90,0.08)", borderRadius: 18, overflow: "hidden", cursor: "pointer" }}>
              <div style={{ height: 185, background: "#0c0905", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
                <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,200,90,0.05) 1px, transparent 1px)", backgroundSize: "22px 22px" }} />
                <div className="ds-grad-text" style={{ fontFamily: "var(--font-heading)", fontSize: 54, fontWeight: 800, letterSpacing: "-2px", position: "relative", opacity: 0.5 }}>
                  {p.initials}
                </div>
                <div style={{ position: "absolute", bottom: 12, left: 14, fontFamily: "monospace", fontSize: 10, color: "rgba(255,200,90,0.3)", letterSpacing: "1.5px", textTransform: "uppercase" }}>
                  [ screenshot ]
                </div>
              </div>
              <div style={{ padding: "22px 24px" }}>
                <Badge className="ds-chip-type" style={{ marginBottom: "11px" }}>{p.type}</Badge>
                <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 19, fontWeight: 700, marginBottom: 7, letterSpacing: "-0.3px" }}>{p.title}</h3>
                <p style={{ fontSize: 12, color: "rgba(245,236,224,0.4)", letterSpacing: "0.5px" }}>{p.tagsText}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
