import ContactForm from "@/components/ContactForm"

type Info = {
  icon: string
  label: string
  value: string
  href?: string | null
}

type ContactProps = {
  eyebrow?: string
  heading?: string
  subtitle?: string
  infos?: Info[]
}

const DEFAULT_INFOS: Info[] = [
  { icon: "solar:letter-bold-duotone", label: "Email", value: "info@drystack.dev", href: "mailto:info@drystack.dev" },
  { icon: "solar:phone-rounded-bold-duotone", label: "Zalo / Phone", value: "0866 442 504", href: "https://zalo.me/0866442504" },
  { icon: "solar:map-point-wave-bold-duotone", label: "Phạm vi", value: "Nhận dự án toàn quốc", href: null },
]

export default function Contact({
  eyebrow = "LIÊN HỆ",
  heading = "Sẵn sàng bắt đầu dự án?",
  subtitle = "Điền form bên dưới hoặc nhắn tin trực tiếp. Chúng tôi phản hồi trong vòng 24h.",
  infos = DEFAULT_INFOS,
}: ContactProps) {
  return (
    <section id="contact" style={{ scrollMarginTop: 100, position: "relative", zIndex: 11, marginTop: -48, borderRadius: "52px 52px 0 0", background: "#faf5ec", color: "#1a1206", padding: "clamp(80px,10vw,130px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)", overflow: "hidden", boxShadow: "0 -24px 60px rgba(0,0,0,0.35)" }}>
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div data-fx="reveal" data-from="up" style={{ opacity: 0, transform: "translateY(48px) scale(0.95)", filter: "blur(8px)", willChange: "transform,opacity,filter", textAlign: "center", marginBottom: 60 }}>
          <p className="ds-grad-text-light" style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}>{eyebrow}</p>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(30px,4vw,52px)", fontWeight: 800, letterSpacing: "-1.2px", lineHeight: 1.12, marginBottom: 16, color: "#1a1206" }}>{heading}</h2>
          <p style={{ fontSize: 17, color: "rgba(26,18,6,0.55)", maxWidth: 500, margin: "0 auto", lineHeight: 1.7 }}>{subtitle}</p>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(290px,1fr))", gap: 48, alignItems: "start" }}>
          <div data-fx="reveal" data-from="right" style={{ opacity: 0, transform: "translateX(90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 22, marginBottom: 36 }}>
              {infos.map((info, i) => {
                const iconBox = (withTransition: boolean) => (
                  <div style={{ width: 46, height: 46, background: "#fff", borderRadius: 13, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0, boxShadow: "0 6px 18px rgba(26,18,6,0.06)", ...(withTransition ? { transition: "box-shadow 0.2s" } : {}) }}>
                    <iconify-icon icon={info.icon} style={{ fontSize: 24, color: "#ff8a3d" }} />
                  </div>
                )
                const label = (
                  <div style={{ fontSize: 12, color: "rgba(26,18,6,0.4)", letterSpacing: "1px", textTransform: "uppercase", marginBottom: 3 }}>{info.label}</div>
                )
                return info.href ? (
                  <a key={i} href={info.href} target={info.href.startsWith("http") ? "_blank" : undefined} rel={info.href.startsWith("http") ? "noopener noreferrer" : undefined} className="info-row" style={{ display: "flex", alignItems: "center", gap: 16, textDecoration: "none" }}>
                    {iconBox(true)}
                    <div>
                      {label}
                      <div className="info-value" style={{ fontSize: 15, color: "#1a1206", fontWeight: 600 }}>{info.value}</div>
                    </div>
                  </a>
                ) : (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 16 }}>
                    {iconBox(false)}
                    <div>
                      {label}
                      <div style={{ fontSize: 15, color: "#1a1206", fontWeight: 600 }}>{info.value}</div>
                    </div>
                  </div>
                )
              })}
            </div>
            <div style={{ background: "#fff", borderRadius: 16, padding: "22px 24px", boxShadow: "0 10px 30px rgba(26,18,6,0.06)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                <div style={{ width: 8, height: 8, background: "#ff8a3d", borderRadius: "50%", animation: "blink 2s infinite" }} />
                <span className="ds-grad-text-light" style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.5px" }}>PHẢN HỒI NHANH</span>
              </div>
              <p style={{ fontSize: 14, color: "rgba(26,18,6,0.6)", lineHeight: 1.6 }}>Thường phản hồi trong <strong style={{ color: "#1a1206", fontWeight: 700 }}>dưới 2 tiếng</strong> trong giờ làm việc (8h–21h, T2–CN)</p>
            </div>
          </div>
          <div data-fx="reveal" data-from="left" style={{ opacity: 0, transform: "translateX(-90px) scale(0.96)", filter: "blur(8px)", willChange: "transform,opacity,filter" }}>
            <ContactForm />
          </div>
        </div>
      </div>
    </section>
  )
}
