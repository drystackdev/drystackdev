import * as React from "react"

import {
  Carousel,
  CarouselContent,
  CarouselItem,
  type CarouselApi,
} from "@/components/ui/carousel"

type Member = {
  role: string
  name: string
  desc: string
  icon: string
  tags: string[]
}

const members: Member[] = [
  {
    role: "FOUNDER · DEV",
    name: "Minh Tuấn",
    desc: "Full-stack dev 4+ năm. Chuyên Next.js, Astro, Strapi.",
    icon: "solar:code-bold",
    tags: ["Next.js", "Astro", "Strapi"],
  },
  {
    role: "UI/UX · BRANDING",
    name: "Hồng Anh",
    desc: "Designer chuyên logo, brand identity & Figma.",
    icon: "solar:pen-new-square-bold",
    tags: ["Figma", "Illustrator", "Branding"],
  },
  {
    role: "SEO · CONTENT",
    name: "Văn Đức",
    desc: "SEO 3+ năm, leo top Google & tăng organic traffic.",
    icon: "solar:graph-up-bold",
    tags: ["SEO", "SEMrush", "Content"],
  },
  {
    role: "QA · AUTOMATION",
    name: "Thu Trang",
    desc: "Automation testing Playwright & Cypress. Đảm bảo chất lượng.",
    icon: "solar:bug-bold",
    tags: ["Playwright", "Cypress", "QA"],
  },
]

export default function TeamCarousel() {
  const [api, setApi] = React.useState<CarouselApi>()
  const [selected, setSelected] = React.useState(0)

  // Keep the active slide / dots in sync.
  React.useEffect(() => {
    if (!api) return
    const onSelect = () => setSelected(api.selectedScrollSnap())
    onSelect()
    api.on("select", onSelect)
    api.on("reInit", onSelect)
    return () => {
      api.off("select", onSelect)
      api.off("reInit", onSelect)
    }
  }, [api])

  // Coverflow: tilt + scale + dim each card based on its distance from centre,
  // so the carousel reads as a rotating ring of cards.
  React.useEffect(() => {
    if (!api) return
    const root = api.rootNode()
    const update = () => {
      const rootRect = root.getBoundingClientRect()
      const center = rootRect.left + rootRect.width / 2
      root.querySelectorAll<HTMLElement>(".cf-item").forEach((item) => {
        const tilt = item.querySelector<HTMLElement>(".cf-tilt")
        if (!tilt) return
        const r = item.getBoundingClientRect()
        const c = r.left + r.width / 2
        const d = r.width ? (c - center) / r.width : 0 // distance in card-widths
        const cl = Math.max(-1.8, Math.min(1.8, d))
        const abs = Math.min(Math.abs(cl), 1)
        // tilt + scale + dim on the inner wrapper (embla owns the item transform)
        tilt.style.setProperty("--cf-rot", (cl * -24).toFixed(2) + "deg")
        tilt.style.setProperty("--cf-scale", (1 - abs * 0.14).toFixed(3))
        tilt.style.opacity = (1 - Math.min(Math.abs(cl), 1.5) * 0.42).toFixed(3)
        // z-index on the item so the centred card overlaps its neighbours
        item.style.zIndex = String(100 - Math.round(Math.abs(cl) * 10))
        // flip hover only available on the active (centre) card
        const card = item.querySelector<HTMLElement>(".team-card")
        if (card) {
          if (Math.abs(cl) < 0.35) card.classList.add("is-active")
          else card.classList.remove("is-active")
        }
      })
    }
    update()
    // run once more after layout/fonts settle so the tilt shows before the
    // first auto-advance (embla hasn't fired a scroll event yet on mount).
    const t1 = requestAnimationFrame(update)
    const t2 = setTimeout(update, 250)
    api.on("scroll", update)
    api.on("reInit", update)
    api.on("resize", update)
    return () => {
      cancelAnimationFrame(t1)
      clearTimeout(t2)
      api.off("scroll", update)
      api.off("reInit", update)
      api.off("resize", update)
    }
  }, [api])

  // Auto-advance every 4.2s, pause while hovering (so the flipped back can be read).
  React.useEffect(() => {
    if (!api) return
    let timer: ReturnType<typeof setInterval>
    const start = () => {
      timer = setInterval(() => api.scrollNext(), 4200)
    }
    const stop = () => clearInterval(timer)
    const root = api.rootNode()
    start()
    const onLeave = () => {
      stop()
      start()
    }
    root.addEventListener("mouseenter", stop)
    root.addEventListener("mouseleave", onLeave)
    return () => {
      stop()
      root.removeEventListener("mouseenter", stop)
      root.removeEventListener("mouseleave", onLeave)
    }
  }, [api])

  return (
    <div>
      <Carousel
        setApi={setApi}
        opts={{ loop: true, align: "center" }}
        className="w-full"
      >
        <CarouselContent className="py-[80px]">
          {members.map((m) => (
            <CarouselItem key={m.name} className="cf-item basis-auto pl-[26px]">
              <div className="cf-tilt">
                <div className="team-card">
                  <div className="team-flip">
                  {/* front */}
                  <div
                    className="team-front"
                    style={{
                      background: "#fff",
                      padding: "40px 32px",
                      textAlign: "center",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      justifyContent: "center",
                      boxShadow: "0 24px 60px rgba(26,18,6,0.11)",
                    }}
                  >
                    <div
                      style={{
                        width: 88,
                        height: 88,
                        borderRadius: "50%",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        marginBottom: 18,
                        background: "#1a1206",
                        boxShadow: "0 8px 28px rgba(255,170,60,0.22)",
                      }}
                    >
                      <iconify-icon icon={m.icon} style={{ fontSize: 40, color: "#ffb13d" }}></iconify-icon>
                    </div>
                    <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "2.5px", color: "#e8920c", textTransform: "uppercase", marginBottom: 8 }}>
                      {m.role}
                    </div>
                    <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 22, fontWeight: 800, marginBottom: 10, color: "#1a1206" }}>
                      {m.name}
                    </h3>
                    <p style={{ fontSize: 13, color: "rgba(26,18,6,0.52)", lineHeight: 1.65, maxWidth: 280 }}>{m.desc}</p>
                    <div style={{ marginTop: 18, fontSize: 11, color: "rgba(26,18,6,0.35)", letterSpacing: "1px" }}>HOVER ĐỂ XEM ẢNH →</div>
                  </div>
                  {/* back */}
                  <div className="team-back" style={{ background: "linear-gradient(160deg,#1a1206,#2d1d0a)" }}>
                    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", opacity: 0.12 }}>
                      <iconify-icon icon="solar:user-rounded-bold" style={{ fontSize: 180, color: "#ffb13d" }}></iconify-icon>
                    </div>
                    <div
                      className="team-back-info"
                      style={{
                        position: "absolute",
                        left: 0,
                        right: 0,
                        bottom: 0,
                        padding: 28,
                        textAlign: "center",
                        background: "linear-gradient(to top, rgba(26,18,6,0.95) 60%, transparent)",
                      }}
                    >
                      <div style={{ fontFamily: "monospace", fontSize: 10, letterSpacing: "2px", color: "#ffae3d", textTransform: "uppercase", marginBottom: 6 }}>
                        {m.role}
                      </div>
                      <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 800, color: "#fff", marginBottom: 8 }}>{m.name}</h3>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                        {m.tags.map((t) => (
                          <span
                            key={t}
                            style={{
                              fontSize: 11,
                              color: "rgba(255,200,90,0.8)",
                              padding: "4px 10px",
                              borderRadius: 100,
                              background: "rgba(255,170,60,0.12)",
                              border: "1px solid rgba(255,170,60,0.2)",
                            }}
                          >
                            {t}
                          </span>
                        ))}
                      </div>
                    </div>
                    </div>
                  </div>
                </div>
              </div>
            </CarouselItem>
          ))}
        </CarouselContent>
      </Carousel>

      {/* Dots (summary indicator below the cards) */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", justifyContent: "center", marginTop: 26 }}>
        {members.map((m, i) => (
          <div key={m.name} className="team-dot" data-active={i === selected} onClick={() => api?.scrollTo(i)} />
        ))}
      </div>
    </div>
  )
}
