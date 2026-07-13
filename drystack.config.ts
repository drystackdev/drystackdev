import { config, fields, collection, singleton } from "@drystack/core";

const techIconOptions = [
  { label: "Search", value: "search" },
  { label: "Settings", value: "settings" },
  { label: "Zap (tốc độ)", value: "zap" },
  { label: "Shield check (tin cậy)", value: "shield-check" },
  { label: "Trending up (tăng trưởng)", value: "trending-up" },
  { label: "Map pin (vị trí)", value: "map-pin" },
];

const socialPlatformOptions = [
  { label: "Facebook", value: "facebook" },
  { label: "X (Twitter)", value: "x" },
  { label: "TikTok", value: "tiktok" },
  { label: "Zalo", value: "zalo" },
];

const headingFieldDescription =
  "Đặt phần cần nhấn mạnh trong dấu ngoặc vuông, VD: Nguyễn Phương Quang - [chuyên gia SEO]";

function postCollection(label: string, previewUrl: string) {
  return collection({
    label,
    slugField: "title",
    entryLayout: "content",
    previewUrl,
    schema: {
      title: fields.slug({ name: { label: "Tiêu đề" } }),
      excerpt: fields.text({
        label: "Mô tả ngắn",
        multiline: true,
        validation: { isRequired: true },
      }),
      keywords: fields.text({
        label: "Từ khóa SEO",
        description: "Cách nhau bởi dấu phẩy, VD: từ khoá 1, từ khoá 2",
      }),
      cover: fields.image({ label: "Ảnh bìa" }),
      date: fields.date({
        label: "Ngày đăng",
        defaultValue: { kind: "today" },
        validation: { isRequired: true },
      }),
      publish: fields.checkbox({
        label: "Xuất bản",
        defaultValue: false,
      }),
      body: fields.content({ label: "Nội dung" }),
    },
  });
}

export default config({
  storage: import.meta.env.DEV
    ? {
        kind: "local",
      }
    : {
        kind: "github",
        repo: "khancoder282/drystack",
      },
  collections: {
    blog: postCollection("Bài viết", "/blog/{slug}"),
    seoKnowledge: postCollection("Kiến thức SEO", "/blog-kien-thuc/{slug}"),
    services: collection({
      label: "Dịch vụ",
      slugField: "title",
      previewUrl: "/dich-vu/{slug}",
      schema: {
        title: fields.slug({ name: { label: "Tên dịch vụ" } }),
        metaTitle: fields.text({
          label: "Meta title (SEO)",
          description: "Để trống sẽ tự lấy tên dịch vụ",
        }),
        metaDescription: fields.text({
          label: "Meta description (SEO)",
          multiline: true,
          description: "Để trống sẽ dùng mô tả ngắn",
        }),
        ogImage: fields.image({ label: "Ảnh chia sẻ (OG image)" }),
        icon: fields.select({
          label: "Icon",
          options: [
            { label: "Search", value: "search" },
            { label: "Settings", value: "settings" },
            { label: "Pen line", value: "pen-line" },
            { label: "Map pin", value: "map-pin" },
          ],
          defaultValue: "search",
        }),
        price: fields.text({
          label: "Giá",
          validation: { isRequired: true },
        }),
        desc: fields.text({
          label: "Mô tả ngắn",
          multiline: true,
          validation: { isRequired: true },
        }),
        tags: fields.array(fields.text({ label: "Tag" }), {
          label: "Tags",
          itemLabel: (props) => props.value || "Tag mới",
        }),
        hot: fields.checkbox({
          label: "Nổi bật (HOT)",
          defaultValue: false,
        }),
        intro: fields.text({
          label: "Giới thiệu",
          multiline: true,
          validation: { isRequired: true },
        }),
        benefits: fields.array(fields.text({ label: "Lợi ích" }), {
          label: "Lợi ích",
          itemLabel: (props) => props.value || "Lợi ích mới",
        }),
        process: fields.array(
          fields.object({
            step: fields.text({
              label: "Bước",
              validation: { isRequired: true },
            }),
            desc: fields.text({
              label: "Mô tả",
              multiline: true,
              validation: { isRequired: true },
            }),
          }),
          {
            label: "Quy trình thực hiện",
            itemLabel: (props) => props.fields.step.value || "Bước mới",
          },
        ),
      },
    }),
  },
  singletons: {
    homepage: singleton({
      label: "Trang chủ & thông tin chung",
      schema: {
        brand: fields.object(
          {
            name: fields.text({
              label: "Tên thương hiệu",
              description:
                "Đặt phần nhấn mạnh trong dấu ngoặc vuông, không có khoảng trắng trước ngoặc, VD: Quang[SEO]",
            }),
            personName: fields.text({ label: "Tên người đại diện" }),
            role: fields.text({ label: "Chức danh / vai trò" }),
            availabilityStatus: fields.text({
              label: "Trạng thái nhận dự án",
            }),
            favicon: fields.image({ label: "Favicon" }),
          },
          { label: "Thương hiệu" },
        ),
        seoDefaults: fields.object(
          {
            title: fields.text({ label: "Tiêu đề mặc định (thẻ title)" }),
            description: fields.text({
              label: "Mô tả mặc định (meta description)",
              multiline: true,
            }),
            ogImage: fields.image({ label: "Ảnh chia sẻ mặc định (OG image)" }),
          },
          { label: "SEO mặc định (toàn site)" },
        ),
        contact: fields.object(
          {
            email: fields.text({ label: "Email" }),
            phoneDisplay: fields.text({ label: "SĐT (hiển thị)" }),
            zaloPhone: fields.text({ label: "SĐT Zalo" }),
            region: fields.text({ label: "Khu vực phục vụ" }),
          },
          { label: "Thông tin liên hệ" },
        ),
        socialLinks: fields.array(
          fields.object({
            platform: fields.select({
              label: "Nền tảng",
              options: socialPlatformOptions,
              defaultValue: "facebook",
            }),
            href: fields.text({ label: "Link" }),
          }),
          {
            label: "Mạng xã hội",
            itemLabel: (props) =>
              socialPlatformOptions.find(
                (o) => o.value === props.fields.platform.value,
              )?.label ?? "Mạng xã hội",
          },
        ),
        headerNav: fields.array(
          fields.object({
            label: fields.text({ label: "Nhãn" }),
            href: fields.text({ label: "Đường dẫn" }),
          }),
          {
            label: "Menu điều hướng - Header",
            itemLabel: (props) => props.fields.label.value || "Mục menu",
          },
        ),
        footerNav: fields.array(
          fields.object({
            label: fields.text({ label: "Nhãn" }),
            href: fields.text({ label: "Đường dẫn" }),
          }),
          {
            label: "Menu điều hướng - Footer",
            itemLabel: (props) => props.fields.label.value || "Mục menu",
          },
        ),
        hero: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            tagline: fields.text({
              label: "Tiêu đề",
              description: `Xuống dòng thật giữa các dòng. ${headingFieldDescription}`,
              multiline: true,
            }),
            description: fields.text({ label: "Mô tả", multiline: true }),
          },
          { label: "Hero (Trang chủ)" },
        ),
        about: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            cardEyebrow: fields.text({ label: "Eyebrow (thẻ nhỏ)" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            points: fields.array(fields.text({ label: "Điểm nổi bật" }), {
              label: "Điểm nổi bật",
              itemLabel: (props) => props.value || "Điểm mới",
            }),
          },
          { label: "Giới thiệu (Trang chủ)" },
        ),
        servicesSection: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            lede: fields.text({ label: "Mô tả", multiline: true }),
          },
          { label: "Dịch vụ (Trang chủ)" },
        ),
        techTools: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            points: fields.array(
              fields.object({
                icon: fields.select({
                  label: "Icon",
                  options: techIconOptions,
                  defaultValue: "zap",
                }),
                text: fields.text({ label: "Nội dung" }),
              }),
              {
                label: "Điểm nổi bật công nghệ",
                itemLabel: (props) => props.fields.text.value || "Điểm mới",
              },
            ),
            tools: fields.array(
              fields.object({
                icon: fields.image({ label: "Ảnh / logo" }),
              }),
              {
                label: "Công cụ / nền tảng",
                itemLabel: () => "Công cụ",
              },
            ),
          },
          { label: "Công nghệ (Trang chủ)" },
        ),
        contactSection: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            lede: fields.text({ label: "Mô tả", multiline: true }),
          },
          { label: "Liên hệ (Trang chủ)" },
        ),
        footer: fields.object(
          {
            description: fields.text({
              label: "Mô tả ngắn dưới logo",
              multiline: true,
            }),
            copyright: fields.text({ label: "Dòng bản quyền" }),
          },
          { label: "Footer" },
        ),
      },
    }),
    gioiThieu: singleton({
      label: "Giới thiệu (trang riêng)",
      schema: {
        metaTitle: fields.text({ label: "Meta title" }),
        metaDescription: fields.text({
          label: "Meta description",
          multiline: true,
        }),
        ogImage: fields.image({ label: "Ảnh chia sẻ (OG image)" }),
        hero: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            lede: fields.text({ label: "Mô tả", multiline: true }),
          },
          { label: "Hero" },
        ),
        intro: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            lede: fields.text({ label: "Đoạn giới thiệu", multiline: true }),
            stats: fields.array(
              fields.object({
                value: fields.text({ label: "Giá trị" }),
                label: fields.text({ label: "Nhãn" }),
              }),
              {
                label: "Thống kê",
                itemLabel: (props) => props.fields.value.value || "Thống kê",
              },
            ),
          },
          { label: "Giới thiệu chi tiết" },
        ),
        values: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            items: fields.array(
              fields.object({
                icon: fields.select({
                  label: "Icon",
                  options: techIconOptions,
                  defaultValue: "shield-check",
                }),
                title: fields.text({ label: "Tiêu đề" }),
                desc: fields.text({ label: "Mô tả", multiline: true }),
              }),
              {
                label: "Giá trị cốt lõi",
                itemLabel: (props) => props.fields.title.value || "Giá trị mới",
              },
            ),
          },
          { label: "Giá trị cốt lõi" },
        ),
        timeline: fields.object(
          {
            eyebrow: fields.text({ label: "Eyebrow" }),
            heading: fields.text({
              label: "Tiêu đề",
              description: headingFieldDescription,
            }),
            items: fields.array(
              fields.object({
                year: fields.text({ label: "Năm" }),
                desc: fields.text({ label: "Mô tả", multiline: true }),
              }),
              {
                label: "Hành trình",
                itemLabel: (props) => props.fields.year.value || "Mốc mới",
              },
            ),
          },
          { label: "Hành trình phát triển" },
        ),
      },
    }),
    dichVu: singleton({
      label: "Dịch vụ (trang danh sách)",
      schema: {
        metaTitle: fields.text({ label: "Meta title" }),
        metaDescription: fields.text({
          label: "Meta description",
          multiline: true,
        }),
        ogImage: fields.image({ label: "Ảnh chia sẻ (OG image)" }),
        eyebrow: fields.text({ label: "Eyebrow" }),
        heading: fields.text({
          label: "Tiêu đề",
          description: headingFieldDescription,
        }),
        lede: fields.text({ label: "Mô tả", multiline: true }),
      },
    }),
    blogListing: singleton({
      label: "Bài viết (trang danh sách)",
      schema: {
        metaTitle: fields.text({ label: "Meta title" }),
        metaDescription: fields.text({
          label: "Meta description",
          multiline: true,
        }),
        ogImage: fields.image({ label: "Ảnh chia sẻ (OG image)" }),
        eyebrow: fields.text({ label: "Eyebrow" }),
        heading: fields.text({
          label: "Tiêu đề",
          description: headingFieldDescription,
        }),
        lede: fields.text({ label: "Mô tả", multiline: true }),
      },
    }),
    seoKnowledgeListing: singleton({
      label: "Kiến thức SEO (trang danh sách)",
      schema: {
        metaTitle: fields.text({ label: "Meta title" }),
        metaDescription: fields.text({
          label: "Meta description",
          multiline: true,
        }),
        ogImage: fields.image({ label: "Ảnh chia sẻ (OG image)" }),
        eyebrow: fields.text({ label: "Eyebrow" }),
        heading: fields.text({
          label: "Tiêu đề",
          description: headingFieldDescription,
        }),
        lede: fields.text({ label: "Mô tả", multiline: true }),
      },
    }),
  },
});
