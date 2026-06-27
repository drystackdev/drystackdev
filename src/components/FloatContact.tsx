import * as React from "react"

const actions = [
  { href: "tel:0866442504", icon: "solar:phone-bold", label: "Gọi điện", bg: "#25d366" },
  { href: "https://zalo.me/0866442504", icon: "simple-icons:zalo", label: "Zalo", bg: "#0068ff", external: true },
  { href: "mailto:info@drystack.dev", icon: "solar:letter-bold", label: "Email", bg: "#ff8a3d" },
  { href: "https://facebook.com/drystack", icon: "logos:facebook", label: "Facebook", bg: "#1877f2", external: true },
]

export default function FloatContact() {
  const [visible, setVisible] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const about = document.getElementById("about")
    if (!about) return
    const check = () => {
      setVisible(about.getBoundingClientRect().top < window.innerHeight * 0.85)
    }
    window.addEventListener("scroll", check, { passive: true })
    check()
    return () => window.removeEventListener("scroll", check)
  }, [])

  // Close on outside click
  React.useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const fab = document.getElementById("float-contact-root")
      if (fab && !fab.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("click", handler)
    return () => document.removeEventListener("click", handler)
  }, [open])

  // Close when hidden
  React.useEffect(() => { if (!visible) setOpen(false) }, [visible])

  return (
    <div
      id="float-contact-root"
      style={{
        position: "fixed",
        bottom: 30,
        right: 20,
        zIndex: 1100,
        display: "flex",
        flexDirection: "column",
        alignItems: "end",
        gap: 10,
        opacity: visible ? 1 : 0,
        pointerEvents: visible ? "auto" : "none",
        transition: "opacity 0.35s",
      }}
    >
      {/* action buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "end" }}>
        {actions.map((a, i) => (
          <a
            key={a.label}
            href={a.href}
            target={a.external ? "_blank" : undefined}
            rel={a.external ? "noopener noreferrer" : undefined}
            aria-label={a.label}
            onClick={() => setTimeout(() => setOpen(false), 120)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              textDecoration: "none",
              opacity: open ? 1 : 0,
              transform: open ? "translateY(0) scale(1)" : "translateY(12px) scale(0.85)",
              transition: `opacity 0.22s ${open ? (actions.length - 1 - i) * 60 : 0}ms, transform 0.22s ${open ? (actions.length - 1 - i) * 60 : 0}ms`,
              pointerEvents: open ? "auto" : "none",
            }}
          >
            <span style={{
              background: "rgba(10,7,3,0.82)",
              color: "#f5ece0",
              fontSize: 12,
              fontWeight: 600,
              padding: "5px 11px",
              borderRadius: 100,
              whiteSpace: "nowrap",
              backdropFilter: "blur(8px)",
              letterSpacing: "0.3px",
            }}>
              {a.label}
            </span>
            <div style={{
              width: 46,
              height: 46,
              borderRadius: "50%",
              background: a.bg,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 4px 16px rgba(0,0,0,0.28)",
              flexShrink: 0,
            }}>
              <iconify-icon icon={a.icon} style={{ fontSize: 22, color: "#fff" }}></iconify-icon>
            </div>
          </a>
        ))}
      </div>

      {/* main toggle button */}
      <button
        aria-label={open ? "Đóng" : "Mở liên hệ nhanh"}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          border: "none",
          cursor: "pointer",
          position: "relative",
          padding: 2,
          background: "transparent",
          overflow: "hidden",
        }}
      >
        <span style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "220%",
          height: "700%",
          background: "conic-gradient(from 0deg, transparent 0deg 300deg, #fff 335deg, #ffe7a8 350deg, transparent 360deg)",
          animation: "spin 3s linear infinite",
          animationDelay: "-2s",
          pointerEvents: "none",
        }} />
        <span style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          background: "#ffab2e",
          borderRadius: "50%",
        }}>
          <iconify-icon
            icon={open ? "solar:close-circle-bold" : "solar:phone-bold"}
            style={{ fontSize: 24, color: "#1a1206", transition: "transform 0.3s", transform: open ? "rotate(90deg)" : "rotate(0deg)" }}
          ></iconify-icon>
        </span>
      </button>
    </div>
  )
}
