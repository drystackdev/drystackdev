import * as React from "react"

type Feature = { icon: string; label: string }

type TechCloudProps = {
  eyebrow?: string
  heading?: React.ReactNode
  body?: React.ReactNode
  features?: Feature[]
  icons?: string[]
  security?: Security
}

const DEFAULT_FEATURES: Feature[] = [
  { icon: "solar:bolt-bold", label: "Tốc độ tải < 2s" },
  { icon: "logos:cloudflare-icon", label: "Bảo mật Cloudflare" },
  { icon: "solar:graph-new-up-bold", label: "Chuẩn SEO" },
]

const DEFAULT_ICONS = [
  "logos:react", "logos:nextjs-icon", "logos:astro-icon", "logos:strapi-icon",
  "logos:typescript-icon", "logos:tailwindcss-icon", "logos:nodejs-icon", "logos:graphql",
  "logos:figma", "logos:vitejs", "logos:vercel-icon", "logos:playwright",
  "logos:javascript", "logos:git-icon", "logos:cloudflare-icon",
]

const DEFAULT_HEADING = (
  <>
    Tech stack hiện đại,
    <br />
    hiệu năng tối ưu
  </>
)

const DEFAULT_BODY = (
  <>
    Chúng tôi dùng các công nghệ mới nhất: <strong style={{ color: "#1a1206" }}>React, Astro, Next.js, Strapi, TypeScript, Tailwind</strong> — cho website nhanh, an toàn và dễ mở rộng.
  </>
)

type Security = {
  title: string
  desc: React.ReactNode
  points: string[]
}

const DEFAULT_SECURITY: Security = {
  title: "Bảo mật hiện đại với Cloudflare",
  desc: (
    <>
      Mọi website đều được đăng ký và bảo vệ qua <strong style={{ color: "#1a1206" }}>Cloudflare</strong> — chống tấn công DDoS, mã hóa SSL miễn phí và tăng tốc toàn cầu qua CDN.
    </>
  ),
  points: [
    "SSL/TLS mã hóa đầu cuối",
    "Tường lửa & chống DDoS 24/7",
    "CDN toàn cầu, cache thông minh",
  ],
}

// Tech stack — light section with a 3D rotating icon cloud (logos:* via Iconify).
export default function TechCloud({
  eyebrow = "CÔNG NGHỆ",
  heading = DEFAULT_HEADING,
  body = DEFAULT_BODY,
  features = DEFAULT_FEATURES,
  icons = DEFAULT_ICONS,
  security = DEFAULT_SECURITY,
}: TechCloudProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    // 3D spherical icon cloud — ported from the design's _initCloud / _cloudTick.
    const wrap = wrapRef.current
    if (!wrap) return

    type CloudItem = { el: HTMLDivElement; x: number; y: number; z: number }
    const N = icons.length
    const cloud: CloudItem[] = icons.map((ic, i) => {
      const phi = Math.acos(-1 + (2 * i + 1) / N)
      const theta = Math.sqrt(N * Math.PI) * phi
      const x = Math.sin(phi) * Math.cos(theta)
      const y = Math.sin(phi) * Math.sin(theta)
      const z = Math.cos(phi)
      const el = document.createElement("div")
      el.style.cssText =
        "position:absolute; top:50%; left:50%; width:48px; height:48px; margin:-24px 0 0 -24px; display:flex; align-items:center; justify-content:center; border-radius:14px; background:rgba(255,255,255,0.7); box-shadow:0 6px 18px rgba(26,18,6,0.12); will-change:transform,opacity;"
      el.innerHTML = '<iconify-icon icon="' + ic + '" style="font-size:30px;"></iconify-icon>'
      wrap.appendChild(el)
      return { el, x, y, z }
    })

    let ry = 0
    let raf = 0
    const tick = () => {
      ry += 0.0038
      const R = wrap.clientWidth / 2 - 30
      const sinY = Math.sin(ry), cosY = Math.cos(ry)
      const tilt = 0.42, sinX = Math.sin(tilt), cosX = Math.cos(tilt)
      for (const p of cloud) {
        const x = p.x * cosY - p.z * sinY
        const z = p.x * sinY + p.z * cosY
        const y = p.y
        const y2 = y * cosX - z * sinX
        const z2 = y * sinX + z * cosX
        const scale = (z2 + 1.7) / 2.7
        p.el.style.transform =
          "translate3d(" + (x * R).toFixed(1) + "px," + (y2 * R).toFixed(1) + "px,0) scale(" + scale.toFixed(3) + ")"
        p.el.style.opacity = (0.4 + 0.6 * scale).toFixed(3)
        p.el.style.zIndex = String(Math.round(scale * 100))
      }
      raf = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(raf)
      cloud.forEach((p) => p.el.remove())
    }
  }, [icons])

  return (
    <section id="stack" style={{ scrollMarginTop: 100, position: "relative", zIndex: 4, marginTop: -48, borderRadius: "52px 52px 0 0", background: "#faf5ec", color: "#1a1206", padding: "clamp(80px,10vw,120px) clamp(20px,5vw,40px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.35)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto", display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 50, alignItems: "center" }}>
        <div data-fx="reveal" data-from="right" style={{ opacity: 0, transform: "translateX(90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }}>
          <p className="ds-grad-text-light" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 16 }}>{eyebrow}</p>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(28px,3.6vw,46px)", fontWeight: 800, letterSpacing: "-1px", lineHeight: 1.14, marginBottom: 20, color: "#1a1206" }}>{heading}</h2>
          <p style={{ fontSize: 16, color: "rgba(26,18,6,0.62)", lineHeight: 1.8, marginBottom: 28 }}>{body}</p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {features.map((f, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#1a1206", padding: "8px 16px", borderRadius: 100, background: "#fff", boxShadow: "0 6px 18px rgba(26,18,6,0.06)" }}>
                <iconify-icon icon={f.icon} style={{ color: "#ff8a3d", fontSize: 16 }} /> {f.label}
              </span>
            ))}
          </div>

          {/* Cloudflare security info */}
          <div style={{ marginTop: 28, background: "#fff", borderRadius: 16, padding: "22px 24px", boxShadow: "0 8px 24px rgba(26,18,6,0.07)", border: "1px solid rgba(255,140,50,0.12)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 12 }}>
              <div style={{ width: 40, height: 40, borderRadius: 11, display: "flex", alignItems: "center", justifyContent: "center", background: "rgba(255,140,50,0.1)", flexShrink: 0 }}>
                <iconify-icon icon="logos:cloudflare-icon" style={{ fontSize: 24 }} />
              </div>
              <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 17, fontWeight: 700, letterSpacing: "-0.3px", color: "#1a1206" }}>{security.title}</h3>
            </div>
            <p style={{ fontSize: 14, color: "rgba(26,18,6,0.62)", lineHeight: 1.7, marginBottom: 16 }}>{security.desc}</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {security.points.map((p, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 14, color: "rgba(26,18,6,0.75)" }}>
                  <iconify-icon icon="solar:shield-check-bold" style={{ fontSize: 18, color: "#ff8a3d", flexShrink: 0 }} /> {p}
                </div>
              ))}
            </div>
          </div>
        </div>
        <div data-fx="reveal" data-from="left" style={{ opacity: 0, transform: "translateX(-90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter", display: "flex", justifyContent: "center" }}>
          <div ref={wrapRef} style={{ position: "relative", width: "min(420px,80vw)", height: "min(420px,80vw)", perspective: "1000px" }} />
        </div>
      </div>
    </section>
  )
}
