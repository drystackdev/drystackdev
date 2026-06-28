import * as React from "react"

const stats = [
  { label: "Dự án hoàn thành", display: "0+" },
  { label: "Khách hàng tin tưởng", display: "0+" },
  { label: "Tỷ lệ hài lòng", display: "0%" },
  { label: "Năm kinh nghiệm", display: "0+" },
]

const texts = ["Thương Hiệu Đỉnh", "Website Pro", "Logo Ấn Tượng", "Nội Dung SEO"]

export default function Hero() {
  const typedRef = React.useRef<HTMLSpanElement>(null)

  // Typewriter
  React.useEffect(() => {
    let ti = 0, ci = 0, deleting = false
    let timer: ReturnType<typeof setTimeout>

    const tick = () => {
      const node = typedRef.current
      if (!node) { timer = setTimeout(tick, 200); return }
      const cur = texts[ti]
      if (deleting) {
        ci--
        node.textContent = cur.substring(0, ci)
        if (ci === 0) { deleting = false; ti = (ti + 1) % texts.length }
        timer = setTimeout(tick, 70)
      } else {
        ci++
        node.textContent = cur.substring(0, ci)
        if (ci === cur.length) { deleting = true; timer = setTimeout(tick, 2200) }
        else timer = setTimeout(tick, 105)
      }
    }
    timer = setTimeout(tick, 0)
    return () => clearTimeout(timer)
  }, [])

  return (
    <section style={{ position: "sticky", top: 0, height: "100vh", display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: "140px 24px 90px", overflow: "hidden", zIndex: 0 }}>

      {/* ── background layer ── */}
      <div style={{ position: "absolute", inset: 0, pointerEvents: "none", overflow: "hidden" }}>
        {/* dot grid */}
        <div style={{ position: "absolute", inset: 0, backgroundImage: "radial-gradient(rgba(255,200,90,0.05) 1px, transparent 1px)", backgroundSize: "34px 34px" }} />

        {/* rings: spin + breathe */}
        <div data-fx="heroRings" style={{ position: "absolute", inset: 0 }}>
          <div style={{ position: "absolute", inset: 0, animation: "ringBreathe 14s ease-in-out infinite" }}>
            <div style={{ position: "absolute", top: "50%", left: "50%", width: 720, height: 720, borderRadius: "50%", border: "1px solid transparent", background: "linear-gradient(#100b06,#100b06) padding-box, conic-gradient(from 0deg, transparent, rgba(255,180,60,0.35), transparent 40%) border-box", animation: "spin 38s linear infinite", maxWidth: "140vw", maxHeight: "140vw" }} />
            <div style={{ position: "absolute", top: "50%", left: "50%", width: 500, height: 500, borderRadius: "50%", border: "1px solid transparent", background: "linear-gradient(#100b06,#100b06) padding-box, conic-gradient(from 180deg, transparent, rgba(255,130,60,0.4), transparent 35%) border-box", animation: "spinR 26s linear infinite", maxWidth: "110vw", maxHeight: "110vw" }} />
            <div style={{ position: "absolute", top: "50%", left: "50%", width: 920, height: 920, borderRadius: "50%", border: "1px dashed rgba(255,200,90,0.07)", animation: "spin 60s linear infinite", maxWidth: "170vw", maxHeight: "170vw" }} />
          </div>
        </div>

        {/* glow blobs */}
        <div style={{ position: "absolute", top: "14%", left: "10%", width: 380, height: 380, background: "radial-gradient(circle, rgba(255,160,50,0.10) 0%, transparent 65%)", borderRadius: "50%", animation: "floatY 18s ease-in-out infinite" }} />
        <div style={{ position: "absolute", bottom: "12%", right: "10%", width: 440, height: 440, background: "radial-gradient(circle, rgba(255,120,50,0.09) 0%, transparent 65%)", borderRadius: "50%", animation: "floatY2 22s ease-in-out infinite 3s" }} />

        {/* floating shapes: outer div drifts out to either side via JS scroll-fx,
            inner div keeps the CSS floatY bob — kept on separate elements because a
            CSS animation that touches `transform` always wins over an inline style
            set on the same element, which silently killed the scroll drift before */}
        <div data-fx="drift" data-dx="140" data-dy="-60" data-drot="35" data-op="1" style={{ position: "absolute", top: "22%", right: "13%", width: 64, height: 64 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: 18, background: "linear-gradient(#100b06,#100b06) padding-box, linear-gradient(135deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent", animation: "floatY 7s ease-in-out infinite" }} />
        </div>
        <div data-fx="drift" data-dx="-150" data-dy="50" data-drot="-30" data-op="1" style={{ position: "absolute", bottom: "24%", left: "9%", width: 48, height: 48 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", border: "1.5px solid rgba(255,150,60,0.4)", animation: "floatY2 9s ease-in-out infinite 1.2s" }} />
        </div>
        <div data-fx="drift" data-dx="160" data-dy="40" data-drot="40" data-op="1" style={{ position: "absolute", top: "64%", right: "18%", width: 34, height: 34 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: 8, background: "rgba(255,170,60,0.12)", animation: "floatY 5.5s ease-in-out infinite 0.7s" }} />
        </div>
        <div data-fx="drift" data-dx="-120" data-dy="-70" data-drot="-25" data-op="0.45" style={{ position: "absolute", top: "34%", left: "15%", width: 88, height: 88 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: 22, background: "linear-gradient(#100b06,#100b06) padding-box, linear-gradient(135deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent", animation: "floatY2 11s ease-in-out infinite 2.5s" }} />
        </div>
        <div data-fx="drift" data-dx="130" data-dy="60" data-drot="-20" data-op="0.8" style={{ position: "absolute", bottom: "18%", right: "23%", width: 66, height: 66 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: "50%", border: "1px solid rgba(255,170,60,0.18)", animation: "floatY 8s ease-in-out infinite 1.8s" }} />
        </div>
        <div data-fx="drift" data-dx="110" data-dy="-40" data-drot="25" data-op="1" style={{ position: "absolute", top: "52%", right: "7%", width: 50, height: 50 }}>
          <div style={{ width: "100%", height: "100%", borderRadius: 14, background: "rgba(255,170,60,0.06)", border: "1px solid rgba(255,170,60,0.12)", animation: "floatY2 6.5s ease-in-out infinite 3.2s" }} />
        </div>

        {/* twinkling particles */}
        <div style={{ position: "absolute", top: "18%", left: "24%", width: 5, height: 5, borderRadius: "50%", background: "#ffce6a", animation: "twinkle 3s ease-in-out infinite" }} />
        <div style={{ position: "absolute", top: "30%", right: "28%", width: 4, height: 4, borderRadius: "50%", background: "#ff9a3d", animation: "twinkle 4s ease-in-out infinite 1s" }} />
        <div style={{ position: "absolute", bottom: "32%", left: "32%", width: 6, height: 6, borderRadius: "50%", background: "#ffce6a", animation: "twinkle 3.5s ease-in-out infinite 0.5s" }} />
        <div style={{ position: "absolute", top: "46%", left: "14%", width: 4, height: 4, borderRadius: "50%", background: "#ffb13d", animation: "twinkle 5s ease-in-out infinite 1.5s" }} />
        <div style={{ position: "absolute", bottom: "22%", right: "34%", width: 5, height: 5, borderRadius: "50%", background: "#ff9a3d", animation: "twinkle 4.5s ease-in-out infinite 2s" }} />
        <div style={{ position: "absolute", top: "60%", right: "12%", width: 4, height: 4, borderRadius: "50%", background: "#ffce6a", animation: "twinkle 3.2s ease-in-out infinite 0.8s" }} />
      </div>

      {/* ── content ── */}
      <div style={{ position: "relative", zIndex: 1, maxWidth: 940, margin: "0 auto" }}>

        {/* badge + headline: rise + fade on scroll */}
        <div data-fx="heroRise">
          <div className="hero-in">
            {/* badge */}
            <div style={{ display: "inline-flex", alignItems: "center", gap: 8, borderRadius: 100, padding: "7px 16px", marginBottom: 32, fontSize: 12, fontWeight: 600, letterSpacing: "1.5px", textTransform: "uppercase", color: "#ffc46a", background: "linear-gradient(#160f08,#160f08) padding-box, linear-gradient(120deg,#ffd24a,#ff8a3d) border-box", border: "1px solid transparent" }}>
              <span style={{ width: 6, height: 6, background: "#ffb13d", borderRadius: "50%", animation: "blink 2s infinite" }} />
              Freelance Team · Nhận dự án toàn quốc
            </div>

            {/* stacked headlines */}
            <div style={{ position: "relative" }}>
              <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(40px,6.5vw,82px)", fontWeight: 700, lineHeight: 1.04, letterSpacing: "-2.5px", color: "rgba(245,236,224,0.65)", WebkitMaskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 90%)", maskImage: "linear-gradient(to bottom, rgba(0,0,0,1) 30%, rgba(0,0,0,0) 90%)", margin: 0 }}>
                Biến Ý Tưởng Thành
              </h1>
              <h1 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(50px,7.5vw,92px)", fontWeight: 800, lineHeight: 1.08, letterSpacing: "-2.5px", marginTop: "-0.55em", marginBottom: 32, minHeight: "1.1em", position: "relative", zIndex: 2, filter: "drop-shadow(0 4px 18px rgba(0,0,0,0.85)) drop-shadow(0 2px 6px rgba(0,0,0,0.6))" }}>
                <span ref={typedRef} style={{ background: "linear-gradient(110deg,#ffe08a,#ffae3d,#ff7a3d,#ffae3d)", backgroundSize: "200% auto", WebkitBackgroundClip: "text", backgroundClip: "text", WebkitTextFillColor: "transparent", color: "transparent", animation: "shimmer 3.5s linear infinite" }} />
                <span style={{ display: "inline-block", width: 4, height: "0.78em", background: "#ffae3d", marginLeft: 3, verticalAlign: "middle", animation: "blink 1s step-end infinite" }} />
              </h1>
            </div>
          </div>
        </div>

        {/* description + CTAs */}
        <div className="hero-in hero-in-2">
          <p style={{ fontSize: "clamp(15px,1.8vw,19px)", color: "rgba(245,236,224,0.6)", maxWidth: 580, margin: "0 auto 46px", lineHeight: 1.75, fontWeight: 300 }}>
            Website · Logo · Branding · SEO — Dịch vụ chuyên nghiệp, giá cả phải chăng dành cho doanh nghiệp Việt. Chỉ từ <strong style={{ color: "#ffce6a", fontWeight: 600 }}>2.000.000đ</strong>.
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 14, flexWrap: "wrap", marginBottom: 76 }}>
            <a href="#services" className="ds-lift2" style={{ position: "relative", display: "inline-flex", alignItems: "center", padding: 2, borderRadius: 100, overflow: "hidden", boxShadow: "0 10px 40px rgba(255,150,40,0.25)" }}>
              <span style={{ position: "absolute", top: "50%", left: "50%", width: "220%", height: "700%", background: "conic-gradient(from 0deg, transparent 0deg 300deg, #fff 335deg, #ffe7a8 350deg, transparent 360deg)", animation: "spin 3.2s linear infinite", pointerEvents: "none" }} />
              <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 8, background: "#ffab2e", color: "#1a1206", padding: "15px 30px", borderRadius: 100, fontSize: 15, fontWeight: 700 }}>
                Xem Dịch Vụ <iconify-icon icon="solar:arrow-right-linear" style={{ fontSize: 18 }}></iconify-icon>
              </span>
            </a>
            <a href="#contact" className="ds-lift2" style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#ffce6a", padding: "16px 32px", borderRadius: 100, fontSize: 15, fontWeight: 600, background: "linear-gradient(#140e07,#140e07) padding-box, linear-gradient(120deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent" }}>
              Liên Hệ Ngay
            </a>
          </div>
        </div>

        {/* stats: sink + fade on scroll */}
        <div data-fx="heroSink">
          <div className="hero-in hero-in-3" style={{ display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 12, maxWidth: 760, margin: "0 auto" }}>
            {stats.map((stat) => (
              <div key={stat.label} style={{ padding: "24px 8px", borderRadius: 18, background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,200,90,0.08)" }}>
                <div data-counter className="ds-grad-text" style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(26px,3.5vw,42px)", fontWeight: 800, lineHeight: 1, marginBottom: 8, letterSpacing: "-1px" }}>
                  {stat.display}
                </div>
                <div style={{ fontSize: 12, color: "rgba(245,236,224,0.5)" }}>{stat.label}</div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  )
}
