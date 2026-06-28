import * as React from "react"
import { Badge } from "@/components/ui/badge"
import { POSTS, formatDateVi, type Post } from "@/lib/posts"

type BlogListProps = {
  eyebrow?: string
  heading?: string
  subheading?: string
  posts?: Post[]
}

export default function BlogList({
  eyebrow = "BLOG",
  heading = "Tất cả bài viết",
  subheading = "Kiến thức miễn phí về website, branding, SEO và marketing cho doanh nghiệp Việt.",
  posts = POSTS,
}: BlogListProps) {
  const [query, setQuery] = React.useState("")
  const [activeCat, setActiveCat] = React.useState("Tất cả")
  const [authorFilter, setAuthorFilter] = React.useState<string | null>(null)
  const [tagFilter, setTagFilter] = React.useState<string | null>(null)

  // Đọc ?author=... và ?tag=... từ URL (khi tới từ link tác giả/từ khoá trên
  // trang chi tiết bài viết) để lọc sẵn ngay khi vào trang.
  React.useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const author = params.get("author")
    const tag = params.get("tag")
    if (author) setAuthorFilter(author)
    if (tag) setTagFilter(tag)
  }, [])

  const clearAuthorFilter = () => {
    setAuthorFilter(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("author")
    window.history.replaceState({}, "", url)
  }
  const clearTagFilter = () => {
    setTagFilter(null)
    const url = new URL(window.location.href)
    url.searchParams.delete("tag")
    window.history.replaceState({}, "", url)
  }

  const cats = React.useMemo(() => {
    return ["Tất cả", ...Array.from(new Set(posts.map((p) => p.cat)))]
  }, [posts])

  // Lọc theo search + category + tác giả + từ khoá (chạy hoàn toàn ở client).
  // Search cũng khớp theo tags, không chỉ title/excerpt/category.
  const filtered = React.useMemo(() => {
    const q = query.trim().toLowerCase()
    return posts
      .filter((p) => activeCat === "Tất cả" || p.cat === activeCat)
      .filter((p) => !authorFilter || p.author.name === authorFilter)
      .filter((p) => !tagFilter || p.tags.includes(tagFilter))
      .filter(
        (p) =>
          !q ||
          p.title.toLowerCase().includes(q) ||
          p.excerpt.toLowerCase().includes(q) ||
          p.cat.toLowerCase().includes(q) ||
          p.author.name.toLowerCase().includes(q) ||
          p.tags.some((t) => t.toLowerCase().includes(q)),
      )
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [posts, query, activeCat, authorFilter, tagFilter])

  return (
    <section
      id="blog"
      style={{
        scrollMarginTop: 100,
        position: "relative",
        zIndex: 10,
        background: "#faf5ec",
        color: "#1a1206",
        padding: "clamp(110px,12vw,150px) clamp(20px,5vw,40px) clamp(80px,10vw,120px)",
        minHeight: "100vh",
        overflow: "hidden",
      }}
    >
      {/* Watermark giống section About */}
      <div
        style={{
          position: "absolute",
          top: 50,
          right: -30,
          fontFamily: "var(--font-heading)",
          fontSize: "clamp(120px,18vw,210px)",
          fontWeight: 800,
          color: "rgba(26,18,6,0.035)",
          letterSpacing: "-10px",
          lineHeight: 0.8,
          pointerEvents: "none",
          whiteSpace: "nowrap",
        }}
      >
        BLOG
      </div>
      <div style={{ maxWidth: 1100, margin: "0 auto", position: "relative" }}>
        {/* Header */}
        <div style={{ marginBottom: 24, animation: "dsBlogReveal .7s cubic-bezier(.22,1,.36,1) both" }}>
          <p
            className="ds-grad-text"
            style={{ fontSize: 11, fontWeight: 700, letterSpacing: "3px", textTransform: "uppercase", marginBottom: 14 }}
          >
            {eyebrow}
          </p>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(32px,4.5vw,56px)",
              fontWeight: 800,
              letterSpacing: "-1.5px",
              lineHeight: 1.1,
              marginBottom: 16,
              color: "#1a1206",
            }}
          >
            {heading}
          </h1>
          <p style={{ fontSize: 15, color: "rgba(26,18,6,0.6)", maxWidth: 560, lineHeight: 1.7, fontWeight: 400 }}>
            {subheading}
          </p>
        </div>

        {/* Chip lọc theo tác giả / từ khoá đang áp dụng (đến từ link trang chi tiết) */}
        {(authorFilter || tagFilter) && (
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 20 }}>
            {authorFilter && (
              <button
                onClick={clearAuthorFilter}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1a1206",
                  background: "#ffab2e",
                  border: "none",
                  padding: "8px 14px",
                  borderRadius: 100,
                  cursor: "pointer",
                }}
              >
                <iconify-icon icon="solar:user-bold" style={{ fontSize: 14 }} />
                Tác giả: {authorFilter}
                <iconify-icon icon="solar:close-circle-bold" style={{ fontSize: 15 }} />
              </button>
            )}
            {tagFilter && (
              <button
                onClick={clearTagFilter}
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#1a1206",
                  background: "#ffab2e",
                  border: "none",
                  padding: "8px 14px",
                  borderRadius: 100,
                  cursor: "pointer",
                }}
              >
                #{tagFilter}
                <iconify-icon icon="solar:close-circle-bold" style={{ fontSize: 15 }} />
              </button>
            )}
          </div>
        )}

        {/* Search + Categories */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 18,
            marginBottom: 36,
            flexWrap: "wrap",
            animation: "dsBlogReveal .7s cubic-bezier(.22,1,.36,1) both",
            animationDelay: "100ms",
          }}
        >
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {cats.map((c) => {
              const on = c === activeCat
              return (
                <button
                  key={c}
                  onClick={() => setActiveCat(c)}
                  className={on ? "ds-btn-pro" : undefined}
                  style={{
                    fontSize: 13,
                    fontWeight: 600,
                    padding: "9px 18px",
                    borderRadius: 100,
                    cursor: "pointer",
                    color: on ? "#1a1206" : "rgba(26,18,6,0.65)",
                    background: on ? "#ffab2e" : "#faf6ef",
                    border: on ? "none" : "1px solid rgba(26,18,6,0.1)",
                    transition: "background .2s, color .2s",
                  }}
                >
                  {c}
                </button>
              )
            })}
          </div>

          <div style={{ position: "relative", flex: "1 1 280px", maxWidth: 380 }}>
            <iconify-icon
              icon="solar:magnifer-linear"
              style={{
                position: "absolute",
                left: 16,
                top: "50%",
                transform: "translateY(-50%)",
                fontSize: 18,
                color: "rgba(26,18,6,0.4)",
              }}
            />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Tìm theo từ khoá, tác giả..."
              className="ds-field"
              style={{ paddingLeft: 44, borderRadius: 100, outline: "none" }}
            />
          </div>
        </div>

        {/* Grid — hiện toàn bộ bài viết khớp filter, mỗi card tự ẩn/hiện theo scroll */}
        {filtered.length > 0 ? (
          <BlogGrid posts={filtered} onAuthorClick={setAuthorFilter} onTagClick={setTagFilter} />
        ) : (
          <div style={{ textAlign: "center", padding: "80px 20px", color: "rgba(26,18,6,0.45)" }}>
            <iconify-icon icon="solar:file-text-broken" style={{ fontSize: 56, marginBottom: 16, display: "block" }} />
            <p style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: "rgba(26,18,6,0.7)" }}>Không tìm thấy bài viết nào</p>
            <p style={{ fontSize: 14, fontWeight: 400 }}>Thử từ khoá khác hoặc chọn danh mục khác.</p>
          </div>
        )}

        {filtered.length > 0 && (
          <p style={{ textAlign: "center", marginTop: 22, fontSize: 12, color: "rgba(26,18,6,0.4)" }}>
            {filtered.length} bài viết
          </p>
        )}
      </div>

      <style>{`
        @keyframes dsBlogReveal {
          from { opacity: 0; transform: translateY(28px) scale(0.97); filter: blur(6px); }
          to   { opacity: 1; transform: translateY(0) scale(1); filter: blur(0); }
        }
        @media (prefers-reduced-motion: reduce) {
          [style*="dsBlogReveal"] { animation: none !important; opacity: 1 !important; }
        }
        .ds-blog-card {
          opacity: 0;
          transform: translateY(36px) scale(0.96);
          filter: blur(6px);
          transition: opacity .55s cubic-bezier(.22,1,.36,1), transform .55s cubic-bezier(.22,1,.36,1), filter .55s cubic-bezier(.22,1,.36,1), box-shadow .3s;
        }
        .ds-blog-card.ds-blog-card--in {
          opacity: 1;
          transform: translateY(0) scale(1);
          filter: blur(0);
        }
        .ds-blog-card.ds-blog-card--in:hover { transform: translateY(-5px) scale(1) !important; border-color: rgba(255,170,60,0.3); }
        @media (prefers-reduced-motion: reduce) {
          .ds-blog-card, .ds-blog-card.ds-blog-card--in { opacity: 1; transform: none; filter: none; transition: none; }
        }
      `}</style>
    </section>
  )
}

// Một IntersectionObserver dùng chung cho toàn bộ grid: các card cùng lọt vào
// khung nhìn trong một lượt cuộn sẽ được stagger theo đúng thứ tự xuất hiện
// (entries trong cùng callback), thay vì so theo index cố định trong danh sách
// — nên khi nhiều hàng cùng vào viewport một lúc, chúng vẫn hiện co giãn lần
// lượt chứ không bật lên đồng thời.
function BlogGrid({
  posts,
  onAuthorClick,
  onTagClick,
}: {
  posts: Post[]
  onAuthorClick: (name: string) => void
  onTagClick: (tag: string) => void
}) {
  const gridRef = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const root = gridRef.current
    if (!root) return
    const cards = Array.from(root.querySelectorAll<HTMLElement>(".ds-blog-card"))
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry, i) => {
          const el = entry.target as HTMLElement
          if (entry.isIntersecting) {
            el.style.transitionDelay = `${i * 90}ms`
            el.classList.add("ds-blog-card--in")
          } else {
            el.style.transitionDelay = "0ms"
            el.classList.remove("ds-blog-card--in")
          }
        })
      },
      { rootMargin: "-8% 0px -8% 0px", threshold: 0 },
    )
    cards.forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [posts])

  return (
    <div ref={gridRef} style={{ display: "flex", flexWrap: "wrap", gap: 22 }}>
      {posts.map((p) => (
        <BlogCard key={p.slug} post={p} onAuthorClick={onAuthorClick} onTagClick={onTagClick} />
      ))}
    </div>
  )
}

function BlogCard({
  post: p,
  onAuthorClick,
  onTagClick,
}: {
  post: Post
  onAuthorClick: (name: string) => void
  onTagClick: (tag: string) => void
}) {
  return (
    <div
      className="ds-blog-card"
      style={{
        flex: "1 1 290px",
        maxWidth: 352,
        background: "#ffffff",
        border: "1px solid rgba(26,18,6,0.07)",
        borderRadius: 18,
        overflow: "hidden",
        boxShadow: "0 16px 44px rgba(26,18,6,0.07)",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <a href={`/blog/${p.slug}`} style={{ display: "block", color: "inherit", textDecoration: "none", cursor: "pointer" }}>
        <div
          style={{
            height: 158,
            background: "#faf5ec",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            position: "relative",
            overflow: "hidden",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: "radial-gradient(rgba(26,18,6,0.05) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          />
          <iconify-icon icon={p.icon} style={{ fontSize: 46, color: "rgba(255,140,50,0.55)", position: "relative" }} />
        </div>
        <div style={{ padding: "24px 26px 0" }}>
          <Badge className="ds-chip-cat-light">{p.cat}</Badge>
          <h3
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: 17,
              fontWeight: 700,
              lineHeight: 1.4,
              margin: "14px 0 12px",
              letterSpacing: "-0.3px",
              color: "#1a1206",
            }}
          >
            {p.title}
          </h3>
          <p style={{ fontSize: 13, color: "rgba(26,18,6,0.55)", marginBottom: 16, lineHeight: 1.6, fontWeight: 400 }}>
            {p.excerpt}
          </p>
        </div>
      </a>

      <div style={{ padding: "0 26px 22px", marginTop: "auto" }}>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 14 }}>
          {p.tags.map((tag) => (
            <button key={tag} className="ds-tag-chip" onClick={() => onTagClick(tag)}>
              #{tag}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, paddingTop: 14, borderTop: "1px solid rgba(26,18,6,0.06)" }}>
          <button
            onClick={() => onAuthorClick(p.author.name)}
            style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "none", border: "none", padding: 0, cursor: "pointer", color: "rgba(26,18,6,0.6)", fontWeight: 700 }}
          >
            <span
              style={{
                width: 20,
                height: 20,
                borderRadius: "50%",
                background: "linear-gradient(135deg,#ffd24a,#ff8a3d)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--font-heading)",
                fontWeight: 800,
                fontSize: 10,
                color: "#1a1206",
                flexShrink: 0,
              }}
            >
              {p.author.name.charAt(0)}
            </span>
            {p.author.name}
          </button>
          <span style={{ color: "rgba(26,18,6,0.4)" }}>{formatDateVi(p.date)} · {p.readTime}</span>
        </div>
      </div>
    </div>
  )
}
