import * as React from "react"

type TocItem = { id: string; heading: string }

type BlogTocProps = {
  items: TocItem[]
}

// Mục lục bài viết: sidebar sticky bên phải trên desktop, nút nổi (float button)
// mở drawer từ dưới lên trên mobile. Active heading được xác định bằng scrollspy
// (so vị trí các heading với mép trên viewport) — dùng chung 1 hook cho cả hai.
export default function BlogToc({ items }: BlogTocProps) {
  const [active, setActive] = React.useState(items[0]?.id ?? "")
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    const headingEls = items.map((i) => document.getElementById(i.id)).filter((el): el is HTMLElement => !!el)
    if (!headingEls.length) return

    const onScroll = () => {
      let current = headingEls[0].id
      for (const el of headingEls) {
        if (el.getBoundingClientRect().top - 140 <= 0) current = el.id
      }
      setActive(current)
    }
    onScroll()
    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onScroll)
    return () => {
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onScroll)
    }
  }, [items])

  const scrollToHeading = (id: string) => {
    const el = document.getElementById(id)
    if (el) {
      const y = el.getBoundingClientRect().top + window.scrollY - 110
      window.scrollTo({ top: y, behavior: "smooth" })
    }
    setOpen(false)
  }

  if (items.length < 2) return null

  return (
    <>
      {/* Desktop: sidebar sticky bên phải */}
      <nav aria-label="Mục lục bài viết" className="ds-toc-desktop" style={{ position: "sticky", top: 120 }}>
        <p style={{ fontSize: 11, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", color: "rgba(26,18,6,0.4)", marginBottom: 16 }}>
          Mục lục
        </p>
        <ul style={{ display: "flex", flexDirection: "column", gap: 4, listStyle: "none", margin: 0, padding: 0 }}>
          {items.map((item) => {
            const on = active === item.id
            return (
              <li key={item.id}>
                <button
                  onClick={() => scrollToHeading(item.id)}
                  style={{
                    display: "block",
                    width: "100%",
                    textAlign: "left",
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "7px 12px",
                    borderRadius: 10,
                    fontSize: 13,
                    lineHeight: 1.5,
                    fontWeight: on ? 700 : 500,
                    color: on ? "#1a1206" : "rgba(26,18,6,0.5)",
                    borderLeft: on ? "2px solid #ffab2e" : "2px solid transparent",
                    transition: "color .2s, border-color .2s",
                  }}
                >
                  {item.heading}
                </button>
              </li>
            )
          })}
        </ul>
      </nav>

      {/* Mobile: nút nổi + drawer */}
      <div className="ds-toc-mobile">
        <button
          aria-label="Mở mục lục"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          style={{
            position: "fixed",
            bottom: 30,
            left: 20,
            zIndex: 1090,
            width: 52,
            height: 52,
            borderRadius: "50%",
            border: "none",
            cursor: "pointer",
            background: "#ffab2e",
            boxShadow: "0 8px 24px rgba(26,18,6,0.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <iconify-icon icon={open ? "solar:close-circle-bold" : "solar:list-bold"} style={{ fontSize: 24, color: "#1a1206" }} />
        </button>

        {open && (
          <div
            onClick={() => setOpen(false)}
            style={{ position: "fixed", inset: 0, zIndex: 1080, background: "rgba(10,7,3,0.45)", backdropFilter: "blur(4px)" }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: "fixed",
                left: 0,
                right: 0,
                bottom: 0,
                maxHeight: "70vh",
                overflowY: "auto",
                background: "#faf5ec",
                borderRadius: "20px 20px 0 0",
                // padding-bottom đủ lớn để nội dung không bị che bởi nút float (đặt
                // fixed bottom:30, cao 52px) đang nằm chồng lên góc trái drawer này.
                padding: "20px 22px calc(96px + env(safe-area-inset-bottom))",
                boxShadow: "0 -16px 48px rgba(0,0,0,0.25)",
              }}
            >
              <div style={{ width: 36, height: 4, borderRadius: 100, background: "rgba(26,18,6,0.15)", margin: "0 auto 18px" }} />
              <p style={{ fontSize: 12, fontWeight: 700, letterSpacing: "1.5px", textTransform: "uppercase", color: "rgba(26,18,6,0.4)", marginBottom: 14 }}>
                Mục lục
              </p>
              <ul style={{ display: "flex", flexDirection: "column", gap: 2, listStyle: "none", margin: 0, padding: 0 }}>
                {items.map((item) => {
                  const on = active === item.id
                  return (
                    <li key={item.id}>
                      <button
                        onClick={() => scrollToHeading(item.id)}
                        style={{
                          display: "block",
                          width: "100%",
                          textAlign: "left",
                          background: on ? "rgba(255,170,60,0.12)" : "none",
                          border: "none",
                          cursor: "pointer",
                          padding: "12px 14px",
                          borderRadius: 12,
                          fontSize: 14,
                          fontWeight: on ? 700 : 500,
                          color: on ? "#1a1206" : "rgba(26,18,6,0.6)",
                        }}
                      >
                        {item.heading}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
