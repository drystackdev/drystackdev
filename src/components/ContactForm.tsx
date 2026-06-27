import * as React from "react"

import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const STORAGE_KEY = "drystack_contact"
const services = [
  "Thiết kế Website",
  "Thiết kế Logo",
  "Branding Package",
  "Viết bài SEO",
  "Combo nhiều dịch vụ",
]

type FormData = {
  fService: string
  fDesc: string
  fName: string
  fPhone: string
  fEmail: string
}

const empty: FormData = { fService: "", fDesc: "", fName: "", fPhone: "", fEmail: "" }

// Spinning conic-gradient submit button (matches the design's CTA treatment).
function SpinButton({ children, type = "submit" }: { children: React.ReactNode; type?: "submit" | "button" }) {
  return (
    <button
      type={type}
      className="ds-lift1"
      style={{
        position: "relative",
        flex: 1,
        padding: 2,
        border: "none",
        borderRadius: 13,
        overflow: "hidden",
        background: "transparent",
        cursor: "pointer",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: "50%",
          left: "50%",
          width: "200%",
          height: "700%",
          background:
            "conic-gradient(from 0deg, transparent 0deg 300deg, #fff 335deg, #ffe7a8 350deg, transparent 360deg)",
          animation: "spin 3s linear infinite",
          pointerEvents: "none",
        }}
      />
      <span
        style={{
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          width: "100%",
          padding: 14,
          background: "#ffab2e",
          color: "#1a1206",
          borderRadius: 11,
          fontSize: 15,
          fontWeight: 700,
        }}
      >
        {children}
      </span>
    </button>
  )
}

export default function ContactForm() {
  const [data, setData] = React.useState<FormData>(empty)
  const [step, setStep] = React.useState<1 | 2>(1)
  const [submitted, setSubmitted] = React.useState(false)

  // Load any previously saved draft.
  React.useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY)
      if (raw) setData({ ...empty, ...JSON.parse(raw) })
    } catch {
      /* ignore */
    }
  }, [])

  const save = (patch: Partial<FormData>) => {
    setData((prev) => {
      const next = { ...prev, ...patch }
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      } catch {
        /* ignore */
      }
      return next
    })
  }

  const goStep2 = (e: React.FormEvent) => {
    e.preventDefault()
    setStep(2)
  }
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    try {
      localStorage.removeItem(STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setSubmitted(true)
  }

  const cardStyle: React.CSSProperties = {
    background: "#fff",
    borderRadius: 20,
    padding: "clamp(28px,3.5vw,40px)",
    display: "flex",
    flexDirection: "column",
    gap: 18,
    boxShadow: "0 20px 50px rgba(26,18,6,0.08)",
  }

  if (submitted) {
    return (
      <div style={{ background: "#fff", borderRadius: 20, padding: "60px 40px", textAlign: "center", boxShadow: "0 20px 50px rgba(26,18,6,0.08)" }}>
        <iconify-icon icon="solar:check-circle-bold" style={{ fontSize: 60, color: "#ff8a3d" }}></iconify-icon>
        <h3 style={{ fontFamily: "var(--font-heading)", fontSize: 26, fontWeight: 800, margin: "18px 0 14px", color: "#1a1206" }}>
          Đã gửi thành công!
        </h3>
        <p style={{ fontSize: 16, color: "rgba(26,18,6,0.58)", lineHeight: 1.7 }}>
          Cảm ơn bạn đã liên hệ! DryStack sẽ phản hồi trong vòng 24h. Hẹn gặp bạn sớm nhé! 🚀
        </p>
      </div>
    )
  }

  if (step === 1) {
    return (
      <form onSubmit={goStep2} style={cardStyle}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
          <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#ffab2e", color: "#1a1206", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>1</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: "#1a1206" }}>Bạn cần gì?</span>
          <span style={{ marginLeft: "auto", fontSize: 12, color: "rgba(26,18,6,0.35)" }}>Bước 1 / 2</span>
        </div>
        <div>
          <Label className="ds-label">Dịch vụ quan tâm</Label>
          <Select value={data.fService} onValueChange={(v) => save({ fService: (v as string) ?? "" })}>
            <SelectTrigger className="ds-field">
              <SelectValue placeholder="Chọn dịch vụ..." />
            </SelectTrigger>
            <SelectContent>
              {services.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label className="ds-label">Mô tả dự án</Label>
          <Textarea
            required
            className="ds-field"
            value={data.fDesc}
            onChange={(e) => save({ fDesc: e.target.value })}
            placeholder="Mô tả ngắn về dự án, ngân sách, deadline..."
            rows={5}
            style={{ resize: "vertical", lineHeight: 1.6 }}
          />
        </div>
        <SpinButton>
          Tiếp tục <iconify-icon icon="solar:arrow-right-linear" style={{ fontSize: 18 }}></iconify-icon>
        </SpinButton>
      </form>
    )
  }

  return (
    <form onSubmit={handleSubmit} style={cardStyle}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 2 }}>
        <span style={{ width: 26, height: 26, borderRadius: "50%", background: "#ffab2e", color: "#1a1206", fontSize: 13, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>2</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#1a1206" }}>Thông tin liên hệ</span>
        <span style={{ marginLeft: "auto", fontSize: 12, color: "rgba(26,18,6,0.35)" }}>Bước 2 / 2</span>
      </div>
      <div style={{ background: "#faf6ef", borderRadius: 12, padding: "14px 16px", fontSize: 13, color: "rgba(26,18,6,0.6)", lineHeight: 1.6 }}>
        <strong style={{ color: "#1a1206" }}>{data.fService}</strong> — {data.fDesc}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(140px,1fr))", gap: 16 }}>
        <div>
          <Label className="ds-label">Tên của bạn</Label>
          <Input type="text" required className="ds-field" value={data.fName} onChange={(e) => save({ fName: e.target.value })} />
        </div>
        <div>
          <Label className="ds-label">Số điện thoại</Label>
          <Input type="tel" required className="ds-field" value={data.fPhone} onChange={(e) => save({ fPhone: e.target.value })} />
        </div>
      </div>
      <div>
        <Label className="ds-label">Email</Label>
        <Input type="email" required placeholder="email@cty.com" className="ds-field" value={data.fEmail} onChange={(e) => save({ fEmail: e.target.value })} />
      </div>
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        <Button
          type="button"
          onClick={() => setStep(1)}
          className="ds-btn-back"
          style={{
            flexShrink: 0,
            height: "auto",
            padding: "14px 20px",
            border: "1px solid rgba(26,18,6,0.14)",
            background: "#faf6ef",
            borderRadius: 13,
            fontSize: 14,
            fontWeight: 600,
            color: "rgba(26,18,6,0.6)",
          }}
        >
          <iconify-icon icon="solar:arrow-left-linear" style={{ fontSize: 17, verticalAlign: "middle" }}></iconify-icon>
        </Button>
        <SpinButton>
          Gửi yêu cầu <iconify-icon icon="solar:arrow-right-linear" style={{ fontSize: 18 }}></iconify-icon>
        </SpinButton>
      </div>
    </form>
  )
}
