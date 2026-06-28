/**
 * cms.ts — Lớp đọc dữ liệu từ Strapi CMS.
 *
 * NGUYÊN TẮC QUAN TRỌNG:
 * - File này CHỈ được import trong các file `.astro` (chạy ở server / build-time).
 *   TUYỆT ĐỐI không import vào component React chạy ở client — để trình duyệt
 *   không bao giờ gọi thẳng tới Strapi.
 * - Ở `dev`: fetch trực tiếp CMS mỗi request → thấy nội dung mới ngay.
 * - Khi `build`: mặc định KHÔNG gọi API (dùng default tĩnh trong component),
 *   trừ khi đặt biến môi trường `USE_CMS_IN_BUILD=true`. Dù bật, fetch vẫn chạy
 *   ở build-time (Node), dữ liệu được "nướng" sẵn vào HTML → client vẫn không gọi API.
 *
 * Mọi fetch đều bọc try/catch: nếu CMS không reachable → trả null/[] để component
 * tự rơi về default, build không bao giờ vỡ.
 */

// Đọc từ process.env vì các flag này được truyền qua command-line (không nằm
// trong .env nên không vào import.meta.env). File này chỉ chạy ở server/build —
// process.env luôn có sẵn và KHÔNG bao giờ lọt vào bundle client.
const STRAPI_URL = process.env.STRAPI_URL || "http://localhost:1337"

// CHỈ gọi CMS khi có flag:
//  - WITH_CMS=true        → bật ở dev khi chạy kèm CMS (lệnh `npm run dev` ở root).
//  - USE_CMS_IN_BUILD=true → bake dữ liệu CMS vào HTML lúc build.
// Không có flag (vd chạy web một mình) → dùng default tĩnh, không chạm CMS.
const ENABLED =
  process.env.WITH_CMS === "true" || process.env.USE_CMS_IN_BUILD === "true"

type StrapiItem = Record<string, any>

async function fetchAPI<T = StrapiItem[]>(
  path: string,
  query = "",
): Promise<T | null> {
  if (!ENABLED) return null
  try {
    const url = `${STRAPI_URL}/api/${path}${query ? `?${query}` : ""}`
    const res = await fetch(url)
    if (!res.ok) {
      console.warn(`[cms] ${url} → ${res.status}`)
      return null
    }
    const json = await res.json()
    return json.data as T
  } catch (err) {
    console.warn(`[cms] fetch failed for "${path}":`, (err as Error).message)
    return null
  }
}

// Lấy mảng value từ component repeatable shared.tag / shared.list-item.
const values = (arr?: { value: string }[]): string[] =>
  Array.isArray(arr) ? arr.map((x) => x.value) : []

const sortByOrder = <T extends { order?: number }>(arr: T[]): T[] =>
  [...arr].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))

// ─────────────────────────────────────────
// COLLECTION TYPES
// ─────────────────────────────────────────

export async function getServices() {
  const data = await fetchAPI("services", "populate=*&pagination[pageSize]=100")
  if (!data?.length) return null
  return sortByOrder(data).map((s) => ({
    icon: s.icon,
    title: s.title,
    price: s.price,
    desc: s.desc,
    tags: values(s.tags),
    hot: !!s.hot,
  }))
}

export async function getProjects() {
  const data = await fetchAPI("projects", "populate=*&pagination[pageSize]=100")
  if (!data?.length) return null
  return sortByOrder(data).map((p) => ({
    initials: p.initials,
    title: p.title,
    type: p.type,
    tagsText: p.tagsText,
  }))
}

export async function getTeam() {
  const data = await fetchAPI("team-members", "populate=*&pagination[pageSize]=100")
  if (!data?.length) return null
  return sortByOrder(data).map((m) => ({
    role: m.role,
    name: m.name,
    desc: m.desc,
    icon: m.icon,
    tags: values(m.tags),
    backDesc: m.backDesc ?? undefined,
  }))
}

const PLAN_FROM = ["right", "up", "left"] as const

export async function getPricing() {
  const data = await fetchAPI("pricing-plans", "populate=*&pagination[pageSize]=100")
  if (!data?.length) return null
  return sortByOrder(data).map((p, i) => ({
    name: p.name,
    price: p.price,
    unit: p.unit,
    features: values(p.features),
    ctaLabel: p.ctaLabel,
    ctaHref: p.ctaHref ?? undefined,
    featured: !!p.featured,
    from: PLAN_FROM[i % PLAN_FROM.length],
  }))
}

const REVIEW_FROM = ["right", "up", "left"] as const

export async function getTestimonials() {
  const data = await fetchAPI("testimonials", "populate=*&pagination[pageSize]=100")
  if (!data?.length) return null
  return sortByOrder(data).map((t, i) => ({
    quote: t.quote,
    initials: t.initials,
    avatarBg: t.avatarBg,
    avatarColor: t.avatarColor,
    name: t.name,
    role: t.role,
    from: REVIEW_FROM[i % REVIEW_FROM.length],
  }))
}

export async function getTips() {
  const data = await fetchAPI("knowledge-tips", "populate=*&pagination[pageSize]=100")
  if (!data?.length) return null
  return sortByOrder(data).map((t) => ({
    icon: t.icon,
    title: t.title,
    desc: t.desc,
  }))
}

// ─────────────────────────────────────────
// POSTS (blog) — map về shape của src/lib/posts.ts
// ─────────────────────────────────────────

export type CmsPost = {
  slug: string
  icon: string
  cat: string
  title: string
  excerpt: string
  date: string
  readTime: string
  author: { name: string; role: string }
  tags: string[]
  sections: { heading: string; paragraphs: string[] }[]
}

export async function getPosts(): Promise<CmsPost[] | null> {
  const data = await fetchAPI(
    "posts",
    "populate[tags]=true&populate[sections][populate]=*&pagination[pageSize]=100",
  )
  if (!data?.length) return null
  return data.map((p) => ({
    slug: p.slug,
    icon: p.icon,
    cat: p.cat,
    title: p.title,
    excerpt: p.excerpt,
    date: typeof p.date === "string" ? p.date : String(p.date),
    readTime: p.readTime ?? "",
    author: { name: p.authorName, role: p.authorRole ?? "" },
    tags: values(p.tags),
    sections: Array.isArray(p.sections)
      ? p.sections.map((s: any) => ({
          heading: s.heading,
          paragraphs: values(s.paragraphs),
        }))
      : [],
  }))
}

// ─────────────────────────────────────────
// SINGLE TYPES
// ─────────────────────────────────────────

export async function getHero() {
  const d = await fetchAPI<StrapiItem>("hero", "populate=*")
  if (!d) return null
  return {
    badge: d.badge,
    headlinePre: d.headlinePre,
    typewriterTexts: values(d.typewriterTexts),
    description: d.description,
    ctaPrimary: { label: d.ctaPrimaryLabel, href: d.ctaPrimaryHref },
    ctaSecondary: { label: d.ctaSecondaryLabel, href: d.ctaSecondaryHref },
    stats: Array.isArray(d.stats)
      ? d.stats.map((s: any) => ({ label: s.label, value: s.value, suffix: s.suffix }))
      : [],
  }
}

export async function getSiteSetting() {
  const d = await fetchAPI<StrapiItem>("site-setting", "populate=*")
  if (!d) return null
  const links = (arr?: any[]) =>
    Array.isArray(arr) ? arr.map((l) => ({ href: l.href, label: l.label })) : []
  return {
    siteName: d.siteName,
    domain: d.domain,
    defaultTitle: d.defaultTitle,
    defaultDesc: d.defaultDesc,
    phone: d.phone,
    email: d.email,
    ctaLabel: d.ctaLabel,
    navLinks: Array.isArray(d.navLinks)
      ? d.navLinks.map((l: any) => ({ id: l.identifier ?? "", label: l.label, href: l.href }))
      : [],
    footerDesc: d.footerDesc,
    copyright: d.copyright,
    credit: d.credit,
    serviceLinks: links(d.serviceLinks),
    companyLinks: links(d.companyLinks),
    socials: Array.isArray(d.socials)
      ? d.socials.map((s: any) => ({ icon: s.icon, label: s.label, href: s.href }))
      : [],
    contactInfos: Array.isArray(d.contactInfos)
      ? d.contactInfos.map((c: any) => ({
          icon: c.icon,
          label: c.label,
          value: c.value,
          href: c.href || null,
        }))
      : [],
    aboutHeading: d.aboutHeading,
    aboutParagraphs: values(d.aboutParagraphs),
    aboutPoints: values(d.aboutPoints),
  }
}
