import * as React from "react"

type NavLink = { href: string; id: string; label: string }

type NavProps = {
  links?: NavLink[]
  ctaLabel?: string
  ctaHref?: string
}

const DEFAULT_LINKS: NavLink[] = [
  { href: "/#about", id: "about", label: "Giới thiệu" },
  { href: "/#services", id: "services", label: "Dịch vụ" },
  { href: "/#projects", id: "projects", label: "Dự án" },
  { href: "/#team", id: "team", label: "Đội ngũ" },
  { href: "/#pricing", id: "pricing", label: "Giá cả" },
  { href: "/blog", id: "blog", label: "Bài Viết" },
]

// Frosted pill navigation + mobile menu.
export default function Nav({
  links = DEFAULT_LINKS,
  ctaLabel = "Liên hệ",
  ctaHref = "/#contact",
}: NavProps) {
  const [menuOpen, setMenuOpen] = React.useState(false)
  const navWrapRef = React.useRef<HTMLDivElement>(null)
  const underlineRef = React.useRef<HTMLSpanElement>(null)

  // Khi đang ở một trang riêng (vd /blog), scrollspy của trang chủ không chạy,
  // nên tự đánh dấu link khớp với pathname hiện tại là active.
  const path = React.useSyncExternalStore(
    () => () => {},
    () => window.location.pathname,
    () => "",
  )
  const isPageLink = (href: string) => href.startsWith("/") && !href.startsWith("/#") && href !== "/"
  const isActivePage = (href: string) =>
    isPageLink(href) && (path === href || path === href + "/" || path.startsWith(`${href}/`))

  // Close the menu if the viewport grows back to desktop width.
  React.useEffect(() => {
    const onResize = () => {
      if (window.innerWidth >= 820) setMenuOpen(false)
    }
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  // ── Sliding underline that follows the hovered link, resting on the
  //    scrollspy-active link (set via [data-active] in the layout FX engine). ──
  React.useEffect(() => {
    const navWrap = navWrapRef.current
    const underline = underlineRef.current
    if (!navWrap || !underline) return

    const linkEls = Array.from(navWrap.querySelectorAll<HTMLElement>("[data-navlink]"))
    let hovering = false

    const moveTo = (link: HTMLElement | null) => {
      if (!link) {
        underline.style.opacity = "0"
        return
      }
      underline.style.opacity = "1"
      underline.style.left = link.offsetLeft + "px"
      underline.style.width = link.offsetWidth + "px"
    }
    const activeLink = () => linkEls.find((l) => l.hasAttribute("data-active")) || null
    const settle = () => {
      if (!hovering) moveTo(activeLink())
    }

    const enterHandlers = linkEls.map((l) => {
      const h = () => { hovering = true; moveTo(l) }
      l.addEventListener("mouseenter", h)
      return h
    })
    const onLeave = () => { hovering = false; settle() }
    navWrap.addEventListener("mouseleave", onLeave)

    // React to scrollspy changes (data-active toggled by the FX engine).
    const obs = new MutationObserver(settle)
    linkEls.forEach((l) => obs.observe(l, { attributes: true, attributeFilter: ["data-active"] }))

    window.addEventListener("resize", settle)
    window.addEventListener("load", settle)
    settle()

    return () => {
      linkEls.forEach((l, i) => l.removeEventListener("mouseenter", enterHandlers[i]))
      navWrap.removeEventListener("mouseleave", onLeave)
      obs.disconnect()
      window.removeEventListener("resize", settle)
      window.removeEventListener("load", settle)
    }
  }, [links])

  return (
    <>
      <nav style={{ position: "fixed", top: 16, left: "50%", transform: "translateX(-50%)", width: "min(1180px, calc(100% - 28px))", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "space-between", padding: "11px 14px 11px 22px", borderRadius: 100, background: "rgba(22,15,8,0.55)", backdropFilter: "blur(20px) saturate(1.4)", WebkitBackdropFilter: "blur(20px) saturate(1.4)", border: "1px solid rgba(255,200,90,0.16)", boxShadow: "0 10px 40px rgba(0,0,0,0.4)" }}>
        <a href="/" style={{ display: "flex", alignItems: "center", gap: 10, fontFamily: "var(--font-heading)", fontWeight: 800, fontSize: 20, letterSpacing: "-0.5px" }}>
          <div style={{ width: 32, height: 32, borderRadius: 9, display: "flex", alignItems: "center", justifyContent: "center", background: "linear-gradient(#1a1206,#1a1206) padding-box, linear-gradient(135deg,#ffd24a,#ff8a3d) border-box", border: "1.5px solid transparent" }}>
            <iconify-icon icon="solar:layers-bold-duotone" style={{ fontSize: 18, color: "#ffb13d" }} />
          </div>
          <span><span className="ds-grad-text">Dry</span>Stack<span style={{ color: "rgba(245,236,224,0.45)", fontWeight: 600 }}>.dev</span></span>
        </a>

        {/* Desktop links */}
        <div ref={navWrapRef} className="ds-desktop-nav" style={{ position: "relative", alignItems: "center", gap: 8 }}>
          <span ref={underlineRef} className="ds-underline" />
          {links.map((l) => {
            const active = isActivePage(l.href)
            return (
              <a key={l.id} href={l.href} data-navlink={l.id} {...(active ? { "data-active": "" } : {})} className="ds-navlink" style={{ fontSize: 14, fontWeight: 500, color: active ? "#ffce6a" : "rgba(245,236,224,0.7)", padding: "8px 14px", borderRadius: 100 }}>
                {l.label}
              </a>
            )
          })}
          <a href={ctaHref} style={{ position: "relative", display: "inline-flex", alignItems: "center", padding: 1.5, borderRadius: 100, overflow: "hidden", marginLeft: 6 }}>
            <span style={{ position: "absolute", top: "50%", left: "50%", width: "260%", height: "700%", background: "conic-gradient(from 0deg, transparent 0deg 300deg, #fff 335deg, #ffe7a8 350deg, transparent 360deg)", animation: "spin 3s linear infinite", pointerEvents: "none" }} />
            <span style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 6, background: "#ffab2e", color: "#1a1206", padding: "9px 18px", borderRadius: 100, fontSize: 13, fontWeight: 700 }}>
              {ctaLabel} <iconify-icon icon="solar:arrow-right-up-linear" style={{ fontSize: 15 }} />
            </span>
          </a>
        </div>

        {/* Mobile hamburger */}
        <button aria-label="Mở menu" className="ds-mobile-nav" onClick={() => setMenuOpen(true)} style={{ width: 42, height: 42, borderRadius: "50%", border: "1px solid rgba(255,200,90,0.2)", background: "rgba(255,200,90,0.07)", color: "#ffb13d", alignItems: "center", justifyContent: "center", cursor: "pointer" }}>
          <iconify-icon icon="solar:hamburger-menu-linear" style={{ fontSize: 22 }} />
        </button>
      </nav>

      {/* Mobile menu */}
      {menuOpen && (
        <div>
          <div onClick={() => setMenuOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 998, background: "rgba(10,7,3,0.55)", backdropFilter: "blur(8px)", WebkitBackdropFilter: "blur(8px)", animation: "ds-menu-fade 0.25s ease both" }} />
          <div style={{ position: "fixed", top: 100, left: "50%", transform: "translateX(-50%)", width: "min(1180px, calc(100% - 28px))", zIndex: 999, background: "rgba(22,15,8,0.96)", backdropFilter: "blur(24px)", WebkitBackdropFilter: "blur(24px)", border: "1px solid rgba(255,200,90,0.16)", borderRadius: 22, padding: 14, display: "flex", flexDirection: "column", gap: 4, boxShadow: "0 24px 60px rgba(0,0,0,0.6)", animation: "ds-menu-pop 0.32s cubic-bezier(0.2,0.8,0.2,1) both", transformOrigin: "top center" }}>
            {links.map((l, i) => (
              <a key={l.id} href={l.href} onClick={() => setMenuOpen(false)} className="ds-mnavlink" style={{ fontSize: 15, fontWeight: 500, color: isActivePage(l.href) ? "#ffce6a" : "rgba(245,236,224,0.85)", padding: "14px 16px", borderRadius: 14, animation: "ds-menu-item 0.3s ease both", animationDelay: `${0.06 + i * 0.04}s` }}>
                {l.label}
              </a>
            ))}
            <a href={ctaHref} onClick={() => setMenuOpen(false)} style={{ textAlign: "center", background: "#ffab2e", color: "#1a1206", padding: 14, borderRadius: 14, fontSize: 15, fontWeight: 700, marginTop: 4, animation: "ds-menu-item 0.3s ease both", animationDelay: `${0.06 + links.length * 0.04}s` }}>
              Liên hệ ngay
            </a>
          </div>
        </div>
      )}
    </>
  )
}
