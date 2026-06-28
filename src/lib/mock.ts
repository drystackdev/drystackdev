/**
 * mock.ts — Toàn bộ content tĩnh của DryStack.dev
 *
 * Mục đích: tập trung dữ liệu để dễ dàng thay thế bằng CMS API sau này.
 * Mỗi section export một object/array khớp với props của component tương ứng.
 * Khi tích hợp CMS: fetch dữ liệu rồi map sang cùng shape này, component không cần đổi.
 */

// ─────────────────────────────────────────
// NAV
// ─────────────────────────────────────────
export const NAV = {
  brand: "DryStack.dev",
  ctaLabel: "Nhận báo giá",
  links: [
    { id: "about",    label: "Về chúng tôi", href: "#about" },
    { id: "services", label: "Dịch vụ",      href: "#services" },
    { id: "projects", label: "Dự án",         href: "#projects" },
    { id: "team",     label: "Đội ngũ",       href: "#team" },
    { id: "pricing",  label: "Bảng giá",      href: "#pricing" },
    { id: "blog",     label: "Blog",           href: "#blog" },
  ],
}

// ─────────────────────────────────────────
// HERO
// ─────────────────────────────────────────
export const HERO = {
  badge: "Freelance Team · Nhận dự án toàn quốc",
  headlinePre: "Biến Ý Tưởng Thành",
  /** Danh sách từ cho typewriter */
  typewriterTexts: ["Thương Hiệu Đỉnh", "Website Pro", "Logo Ấn Tượng", "Nội Dung SEO"],
  description: "Website · Logo · Branding · SEO — Dịch vụ chuyên nghiệp, giá cả phải chăng dành cho doanh nghiệp Việt. Chỉ từ 2.000.000đ.",
  ctaPrimary:   { label: "Xem Dịch Vụ", href: "#services" },
  ctaSecondary: { label: "Liên Hệ Ngay", href: "#contact" },
  stats: [
    { label: "Dự án hoàn thành",   value: 50,  suffix: "+" },
    { label: "Khách hàng tin tưởng", value: 30, suffix: "+" },
    { label: "Tỷ lệ hài lòng",     value: 98,  suffix: "%" },
    { label: "Năm kinh nghiệm",    value: 3,   suffix: "+" },
  ],
}

// ─────────────────────────────────────────
// MARQUEE
// ─────────────────────────────────────────
export const MARQUEE = {
  words: [
    "THIẾT KẾ WEBSITE",
    "THIẾT KẾ LOGO",
    "BRANDING",
    "VIẾT BÀI SEO",
    "UI/UX DESIGN",
    "AUTOMATION TESTING",
  ],
}

// ─────────────────────────────────────────
// ABOUT
// ─────────────────────────────────────────
export const ABOUT = {
  eyebrow: "VỀ CHÚNG TÔI",
  heading: "Thương hiệu mạnh\nbắt đầu từ đây",
  paragraphs: [
    "DryStack là team freelance chuyên thiết kế website và branding cho doanh nghiệp vừa và nhỏ trên toàn quốc. Mọi doanh nghiệp đều xứng đáng có thương hiệu đẳng cấp — dù ngân sách lớn hay nhỏ.",
    'Với phương châm "Giá rẻ, chất lượng đỉnh", chúng tôi đã đồng hành cùng hơn 50 doanh nghiệp.',
  ],
  points: [
    "Tư vấn miễn phí, báo giá trong 24h",
    "Giao sản phẩm đúng deadline cam kết",
    "Hỗ trợ sau bàn giao, bảo hành dài hạn",
  ],
  card: {
    tagline: "✦ EST. 2022 · TOÀN QUỐC",
    desc: "Team freelance tận tâm, chuyên xây dựng thương hiệu số cho doanh nghiệp Việt với giá phải chăng.",
    statusText: "Đang nhận dự án mới",
  },
}

// ─────────────────────────────────────────
// SERVICES
// ─────────────────────────────────────────
export type Service = {
  icon: string
  title: string
  price: string
  desc: string
  tags: string[]
  hot?: boolean
}

export const SERVICES = {
  eyebrow: "DỊCH VỤ",
  heading: "Chúng tôi làm được gì cho bạn?",
  subtitle: "Từ website đến thương hiệu hoàn chỉnh — tất cả dưới một mái nhà với giá cực hợp lý.",
  items: [
    {
      icon: "solar:monitor-smartphone-bold-duotone",
      title: "Thiết kế Website",
      price: "Từ 2.000.000đ",
      desc: "Website chuyên nghiệp, responsive hoàn toàn, tốc độ tải nhanh, tích hợp SEO và CMS dễ quản lý.",
      tags: ["Responsive", "CMS", "SSL"],
      hot: false,
    },
    {
      icon: "solar:palette-bold-duotone",
      title: "Thiết kế Logo",
      price: "Từ 500.000đ",
      desc: "Logo độc đáo, đậm chất thương hiệu, phù hợp mọi nền tảng. Giao file vector AI, PDF, PNG.",
      tags: ["3 concept", "File AI/PDF", "Revision ∞"],
      hot: false,
    },
    {
      icon: "solar:layers-minimalistic-bold-duotone",
      title: "Branding Package",
      price: "Từ 3.000.000đ",
      desc: "Bộ nhận diện hoàn chỉnh: logo, màu sắc, typography, business card và brand guideline.",
      tags: ["Guideline", "Card", "Social Kit"],
      hot: true,
    },
    {
      icon: "solar:magnifer-zoom-in-bold-duotone",
      title: "Viết bài SEO",
      price: "Từ 200.000đ/bài",
      desc: "Nội dung chuẩn SEO, đúng ngữ nghĩa, thu hút người đọc và tối ưu để leo top Google bền vững.",
      tags: ["Keyword", "On-page", "1000–2000 từ"],
      hot: false,
    },
  ] satisfies Service[],
}

// ─────────────────────────────────────────
// PROJECTS
// ─────────────────────────────────────────
export type Project = {
  initials: string
  title: string
  type: string
  tagsText: string
  /** URL ảnh screenshot — để trống khi dùng mock */
  imageUrl?: string
}

export const PROJECTS = {
  eyebrow: "DỰ ÁN",
  heading: "Những gì chúng tôi\nđã làm",
  ctaLabel: "Xem tất cả",
  ctaHref: "#contact",
  items: [
    { initials: "NK", title: "Nha Khoa Smile",     type: "Website + Logo",         tagsText: "Next.js · Figma · SEO" },
    { initials: "PH", title: "Phở Hà Nội",         type: "Website + Branding",     tagsText: "Astro · Strapi" },
    { initials: "TV", title: "TechViet Solutions",  type: "Website Doanh Nghiệp",   tagsText: "React · Node.js · GraphQL" },
    { initials: "BL", title: "Beauty by Linh",      type: "Website + Branding",     tagsText: "Next.js · Figma" },
    { initials: "GF", title: "GreenFarm Store",     type: "E-Commerce Website",     tagsText: "Astro · Strapi · SEO" },
    { initials: "LT", title: "LogiTrans Việt",      type: "Website + Branding",     tagsText: "React · Tailwind" },
  ] satisfies Project[],
}

// ─────────────────────────────────────────
// TEAM
// ─────────────────────────────────────────
export type TeamMember = {
  role: string
  name: string
  desc: string
  icon: string
  tags: string[]
  /** Mặt sau card (flip hover) */
  backDesc?: string
}

export const TEAM = {
  eyebrow: "ĐỘI NGŨ",
  heading: "Con người đằng sau DryStack",
  members: [
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
  ] satisfies TeamMember[],
}

// ─────────────────────────────────────────
// PRICING
// ─────────────────────────────────────────
export type PricingPlan = {
  name: string
  /** Hiển thị giá dạng string (CMS-friendly) */
  price: string
  unit: string
  features: string[]
  ctaLabel: string
  ctaHref?: string
  featured?: boolean
}

export const PRICING = {
  eyebrow: "GIÁ CẢ",
  heading: "Minh bạch, không phát sinh",
  subtitle: "Chọn gói phù hợp với nhu cầu của bạn. Tất cả đều có thể tùy chỉnh.",
  featuredBadge: "✦ PHỔ BIẾN NHẤT",
  plans: [
    {
      name: "STARTER",
      price: "2 triệu",
      unit: "đồng / dự án",
      features: [
        "Website Landing Page",
        "Responsive & Mobile-first",
        "SSL miễn phí",
        "SEO cơ bản",
        "Bảo hành 1 tháng",
      ],
      ctaLabel: "Bắt đầu ngay",
      featured: false,
    },
    {
      name: "PRO",
      price: "5 triệu",
      unit: "đồng / dự án",
      features: [
        "Website đa trang (5–10 trang)",
        "Logo + Brand cơ bản",
        "CMS Dashboard đầy đủ",
        "SEO On-page chuyên sâu",
        "Automation Testing",
        "Bảo hành 3 tháng",
      ],
      ctaLabel: "Chọn gói Pro",
      featured: true,
    },
    {
      name: "ENTERPRISE",
      price: "Thương lượng",
      unit: "tùy quy mô dự án",
      features: [
        "Trọn gói Web + Logo + Brand",
        "SEO Content 3 tháng",
        "Social Media Kit đầy đủ",
        "Tư vấn chiến lược thương hiệu",
        "Priority support 12 tháng",
        "Bảo hành 12 tháng",
      ],
      ctaLabel: "Liên hệ tư vấn",
      featured: false,
    },
  ] satisfies PricingPlan[],
}

// ─────────────────────────────────────────
// TESTIMONIALS
// ─────────────────────────────────────────
export type Review = {
  quote: string
  initials: string
  avatarBg: string
  avatarColor: string
  name: string
  role: string
  rating: number
}

export const TESTIMONIALS = {
  eyebrow: "ĐÁNH GIÁ",
  heading: "Khách hàng nói gì về chúng tôi",
  reviews: [
    {
      quote: "DryStack giúp spa của mình có website đẹp hơn hẳn mong đợi. Giá rất hợp lý, team chuyên nghiệp và giao đúng hẹn. Khách cứ khen website đẹp liên tục!",
      initials: "NH",
      avatarBg: "#ff8a3d",
      avatarColor: "#fff",
      name: "Nguyễn Thị Hoa",
      role: "Chủ Spa Beauty by Linh",
      rating: 5,
    },
    {
      quote: "Code sạch, UX tốt, SEO hiệu quả rõ rệt sau 2 tháng. Traffic tăng 3 lần. Đặc biệt khâu kiểm thử rất kỹ, web chạy mượt không lỗi. Sẽ hợp tác dài lâu!",
      initials: "TN",
      avatarBg: "#ffab2e",
      avatarColor: "#1a1206",
      name: "Trần Văn Nam",
      role: "CEO · TechViet Solutions",
      rating: 5,
    },
    {
      quote: "Logo và bộ nhận diện nhà hàng giờ trông cực chuyên nghiệp. Giá chỉ 3 triệu mà chất lượng tưởng mấy chục triệu. Quá xứng đáng!",
      initials: "LM",
      avatarBg: "#e8920c",
      avatarColor: "#fff",
      name: "Lê Thị Mai",
      role: "Chủ Nhà Hàng Phở Hà Nội",
      rating: 5,
    },
  ] satisfies Review[],
}

// ─────────────────────────────────────────
// KNOWLEDGE (Tips)
// ─────────────────────────────────────────
export type Tip = {
  icon: string
  title: string
  desc: string
}

export const KNOWLEDGE = {
  eyebrow: "KIẾN THỨC",
  heading: "Chia sẻ kinh nghiệm thực chiến",
  subtitle: "Những bài học rút ra từ hơn 50 dự án thực tế — giúp bạn tránh sai lầm và làm tốt hơn.",
  tips: [
    {
      icon: "solar:rocket-2-bold",
      title: "Tối ưu tốc độ tải",
      desc: "Nén ảnh, lazy-load và CDN giúp giữ website luôn dưới 2 giây — tăng trải nghiệm và SEO.",
    },
    {
      icon: "solar:palette-bold",
      title: "Bảng màu thương hiệu",
      desc: "Chọn 2–3 màu chủ đạo và dùng nhất quán trên mọi điểm chạm để khách dễ ghi nhớ.",
    },
    {
      icon: "solar:pen-new-square-bold",
      title: "Content chuyển đổi",
      desc: "Tiêu đề rõ ràng, CTA mạnh, nói lợi ích trước khi nói tính năng để tăng tỉ lệ chốt.",
    },
    {
      icon: "solar:bug-bold",
      title: "Kiểm thử trước khi launch",
      desc: "Test đa thiết bị và automation testing để website chạy mượt, không lỗi khi lên sóng.",
    },
  ] satisfies Tip[],
}

// ─────────────────────────────────────────
// CONTACT
// ─────────────────────────────────────────
export type ContactInfo = {
  icon: string
  label: string
  value: string
  href: string | null
}

export const CONTACT = {
  eyebrow: "LIÊN HỆ",
  heading: "Sẵn sàng bắt đầu dự án?",
  subtitle: "Điền form bên dưới hoặc nhắn tin trực tiếp. Chúng tôi phản hồi trong vòng 24h.",
  responseNote: "Thường phản hồi trong dưới 2 tiếng trong giờ làm việc (8h–21h, T2–CN)",
  form: {
    namePlaceholder: "Họ và tên",
    emailPlaceholder: "Email của bạn",
    phonePlaceholder: "Số điện thoại (tuỳ chọn)",
    messagePlaceholder: "Bạn cần tư vấn về dịch vụ gì?",
    submitLabel: "Gửi yêu cầu",
  },
  infos: [
    { icon: "solar:letter-bold-duotone",        label: "Email",         value: "info@drystack.dev",           href: "mailto:info@drystack.dev" },
    { icon: "solar:phone-rounded-bold-duotone",  label: "Zalo / Phone",  value: "0866 442 504",                href: "https://zalo.me/0866442504" },
    { icon: "solar:map-point-wave-bold-duotone", label: "Phạm vi",       value: "Nhận dự án toàn quốc",       href: null },
  ] satisfies ContactInfo[],
}

// ─────────────────────────────────────────
// FOOTER
// ─────────────────────────────────────────
export const FOOTER = {
  description: "Team freelance chuyên thiết kế website & branding cho doanh nghiệp Việt. Giá rẻ, chất lượng đỉnh.",
  copyright: "© 2026 DryStack. All rights reserved.",
  credit: "Made by Thanh Khan in Việt Nam",
  serviceLinks: [
    { href: "#services", label: "Thiết kế Website" },
    { href: "#services", label: "Thiết kế Logo" },
    { href: "#services", label: "Branding" },
    { href: "#services", label: "Viết bài SEO" },
  ],
  companyLinks: [
    { href: "#about",    label: "Về chúng tôi" },
    { href: "#team",     label: "Đội ngũ" },
    { href: "#projects", label: "Dự án" },
    { href: "#blog",     label: "Blog" },
  ],
  socials: [
    { icon: "logos:facebook",    label: "Facebook", href: "https://facebook.com/drystack" },
    { icon: "logos:tiktok-icon", label: "TikTok",   href: "https://tiktok.com/@drystack" },
    { icon: "logos:telegram",    label: "Telegram", href: "https://t.me/drystack" },
    { icon: "simple-icons:zalo", label: "Zalo",     href: "https://zalo.me/0866442504" },
  ],
  contactLinks: [
    { href: "mailto:info@drystack.dev", label: "info@drystack.dev" },
    { href: "tel:0866442504",           label: "0866 442 504" },
  ],
}

// ─────────────────────────────────────────
// SITE META  (dùng cho SEO / layout)
// ─────────────────────────────────────────
export const SITE_META = {
  name: "DryStack.dev",
  domain: "https://drystack.dev",
  defaultTitle: "DryStack.dev — Thiết kế website, logo & branding cho doanh nghiệp Việt",
  defaultDescription:
    "Team freelance DryStack thiết kế website, logo, branding và SEO chuẩn cho doanh nghiệp Việt. Tốc độ nhanh, chuẩn SEO, giá chỉ từ 2.000.000đ. Nhận tư vấn miễn phí.",
  ogImage: "/og-image.jpg",
  locale: "vi_VN",
  foundedYear: 2022,
  phone: "0866 442 504",
  email: "info@drystack.dev",
}
