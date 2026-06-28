import * as React from "react"

type Feature = { icon: string; label: string }

type TechCloudProps = {
  eyebrow?: string
  heading?: React.ReactNode
  /** Lines cycled by the typewriter: "Công nghệ — bài toán nó giải quyết" */
  techLines?: string[]
  /** Short Cloudflare security note shown above the feature chips */
  securityNote?: React.ReactNode
  features?: Feature[]
  icons?: string[]
}

const DEFAULT_FEATURES: Feature[] = [
  { icon: "solar:bolt-bold", label: "Tốc độ tải < 2s" },
  { icon: "solar:shield-check-bold", label: "Bảo mật Cloudflare" },
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

// Mỗi dòng: tên công nghệ + lợi ích thực tế cho doanh nghiệp (dễ hiểu, không thuật ngữ).
const DEFAULT_TECH_LINES = [
  "React — giao diện mượt mà, giữ chân khách hàng lâu hơn",
  "Astro — website tải nhanh, thân thiện Google, dễ lên top",
  "Next.js — nền tảng vững chắc, mở rộng thoải mái khi lớn mạnh",
  "Strapi — tự cập nhật nội dung, không cần biết lập trình",
  "TypeScript — code chặt chẽ, ít lỗi, vận hành bền bỉ",
  "Tailwind — thiết kế đẹp & đồng nhất, ra mắt nhanh",
  "Cloudflare — bảo mật & chống tấn công, an tâm 24/7",
]

const DEFAULT_SECURITY_NOTE = (
  <>
    Mọi website đều được đăng ký & bảo vệ qua <strong style={{ color: "#1a1206" }}>Cloudflare</strong>: chống DDoS, SSL miễn phí và tăng tốc CDN toàn cầu.
  </>
)

// Tech stack — light section with a 3D rotating icon cloud (logos:* via Iconify).
export default function TechCloud({
  eyebrow = "CÔNG NGHỆ",
  heading = DEFAULT_HEADING,
  techLines = DEFAULT_TECH_LINES,
  securityNote = DEFAULT_SECURITY_NOTE,
  features = DEFAULT_FEATURES,
  icons = DEFAULT_ICONS,
}: TechCloudProps) {
  const wrapRef = React.useRef<HTMLDivElement>(null)
  const typedRef = React.useRef<HTMLSpanElement>(null)

  // Typewriter cycling through techLines.
  React.useEffect(() => {
    let li = 0, ci = 0, deleting = false
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      const node = typedRef.current
      if (!node) { timer = setTimeout(tick, 200); return }
      const cur = techLines[li]
      if (deleting) {
        ci--
        node.textContent = cur.substring(0, ci)
        if (ci === 0) { deleting = false; li = (li + 1) % techLines.length }
        timer = setTimeout(tick, 30)
      } else {
        ci++
        node.textContent = cur.substring(0, ci)
        if (ci === cur.length) { deleting = true; timer = setTimeout(tick, 2400) }
        else timer = setTimeout(tick, 45)
      }
    }
    timer = setTimeout(tick, 0)
    return () => clearTimeout(timer)
  }, [techLines])

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
      // width+height equal keeps every logo in a uniform 30×30 box (avoids wide logos like Cloudflare looking bigger).
      el.innerHTML = '<iconify-icon icon="' + ic + '" width="30" height="30" style="font-size:30px;"></iconify-icon>'
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

          {/* Typewriter: công nghệ + bài toán nó giải quyết */}
          <p style={{ fontSize: 16, color: "rgba(26,18,6,0.62)", lineHeight: 1.8, marginBottom: 14, minHeight: "3.6em" }}>
            <span ref={typedRef} style={{ color: "#1a1206", fontWeight: 600 }} />
            <span style={{ display: "inline-block", width: 2, height: "1.05em", background: "#ff8a3d", marginLeft: 2, verticalAlign: "text-bottom", animation: "blink 1s step-end infinite" }} />
          </p>

          {/* Cloudflare security note (small, ngắn gọn) */}
          <p style={{ display: "flex", alignItems: "flex-start", gap: 8, fontSize: 13, color: "rgba(26,18,6,0.55)", lineHeight: 1.6, marginBottom: 26 }}>
            <iconify-icon icon="solar:shield-check-bold" style={{ fontSize: 17, color: "#ff8a3d", flexShrink: 0, marginTop: 1 }} />
            <span>{securityNote}</span>
          </p>

          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {features.map((f, i) => (
              <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: "#1a1206", padding: "8px 16px", borderRadius: 100, background: "#fff", boxShadow: "0 6px 18px rgba(26,18,6,0.06)" }}>
                <iconify-icon icon={f.icon} width="16" height="16" style={{ color: "#ff8a3d", fontSize: 16 }} /> {f.label}
              </span>
            ))}
          </div>
        </div>
        <div data-fx="reveal" data-from="left" style={{ opacity: 0, transform: "translateX(-90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter", display: "flex", justifyContent: "center" }}>
          <div ref={wrapRef} style={{ position: "relative", width: "min(420px,80vw)", height: "min(420px,80vw)", perspective: "1000px" }} />
        </div>
      </div>
    </section>
  )
}
