// Nguồn dữ liệu blog dùng chung cho trang danh sách (/blog) và trang chi tiết
// (/blog/[slug]). Sau này có thể thay bằng Astro content collections hoặc CMS
// mà không cần đổi component — chỉ cần giữ đúng shape Post.

export type Author = {
  name: string
  role: string
}

export type Section = {
  heading: string
  paragraphs: string[]
}

export type Post = {
  slug: string
  icon: string
  cat: string
  title: string
  excerpt: string
  date: string // ISO yyyy-mm-dd để sort
  readTime: string // ví dụ "5 phút đọc"
  author: Author
  tags: string[]
  sections: Section[] // mỗi section có 1 heading (dùng cho mục lục) + các đoạn văn
}

const MINH_KHOI: Author = { name: "Minh Khôi", role: "Web Strategist" }
const THUY_LINH: Author = { name: "Thuỳ Linh", role: "Brand Designer" }
const DUC_ANH: Author = { name: "Đức Anh", role: "SEO Specialist" }
const NGOC_HA: Author = { name: "Ngọc Hà", role: "Content Strategist" }
const HAI_DANG: Author = { name: "Hải Đăng", role: "Performance Engineer" }

export const POSTS: Post[] = [
  {
    slug: "5-ly-do-doanh-nghiep-can-website-chuyen-nghiep-2024",
    icon: "solar:monitor-bold-duotone",
    cat: "Website",
    title: "5 lý do doanh nghiệp nhỏ cần website chuyên nghiệp 2024",
    excerpt:
      "Nhiều chủ doanh nghiệp vẫn nghĩ website là thứ xa xỉ. Nhưng thực tế ngược lại — một website tốt là nhân viên bán hàng 24/7, hoạt động cả khi bạn đang ngủ.",
    date: "2024-03-15",
    readTime: "5 phút đọc",
    author: MINH_KHOI,
    tags: ["website", "doanh nghiệp nhỏ", "chuyển đổi số"],
    sections: [
      {
        heading: "Website không còn là thứ xa xỉ",
        paragraphs: [
          "Nhiều chủ doanh nghiệp nhỏ ở Việt Nam vẫn nghĩ website là thứ xa xỉ, chỉ dành cho công ty lớn. Nhưng thực tế ngược lại: một website tốt chính là nhân viên bán hàng làm việc 24/7, không nghỉ lễ, không đòi tăng lương.",
        ],
      },
      {
        heading: "Uy tín và sự chủ động",
        paragraphs: [
          "Thứ nhất, website là nơi khách hàng kiểm chứng độ tin cậy. Trước khi mua hàng hay đặt dịch vụ, gần như ai cũng tìm tên doanh nghiệp trên Google. Không có website, bạn mất điểm uy tín ngay từ vòng đầu.",
          "Thứ hai, mạng xã hội không thuộc về bạn. Fanpage có thể bị giới hạn tiếp cận, bị khóa, hoặc đổi thuật toán bất cứ lúc nào. Website là tài sản số bạn hoàn toàn kiểm soát, không phụ thuộc vào nền tảng thứ ba.",
        ],
      },
      {
        heading: "Hiệu quả marketing và chi phí hợp lý",
        paragraphs: [
          "Thứ ba, website giúp bạn chạy quảng cáo hiệu quả hơn. Một landing page tối ưu chuyển đổi tốt hơn nhiều so với việc dẫn khách về fanpage hay group.",
          "Thứ tư, website hoạt động ngoài giờ làm việc — khách có thể xem sản phẩm, đọc thông tin, để lại liên hệ lúc 11h đêm mà bạn không cần trực tiếp trả lời.",
          "Cuối cùng, chi phí làm website hiện nay đã rẻ hơn rất nhiều so với 5 năm trước. Với một đội ngũ freelance như DryStack, bạn có thể có website chuyên nghiệp chỉ từ 2.000.000đ — một khoản đầu tư nhỏ cho lợi ích dài hạn.",
        ],
      },
    ],
  },
  {
    slug: "branding-la-gi-va-tai-sao-quan-trong",
    icon: "solar:palette-round-bold-duotone",
    cat: "Branding",
    title: "Branding là gì và tại sao quan trọng với mọi doanh nghiệp?",
    excerpt:
      "Branding không chỉ là logo hay màu sắc. Đó là toàn bộ cảm xúc khách hàng cảm nhận khi nhắc tới thương hiệu của bạn.",
    date: "2024-04-02",
    readTime: "7 phút đọc",
    author: THUY_LINH,
    tags: ["branding", "nhận diện thương hiệu", "logo"],
    sections: [
      {
        heading: "Branding là gì?",
        paragraphs: [
          "Branding không chỉ là logo hay bảng màu. Đó là toàn bộ cảm xúc và ấn tượng khách hàng có được mỗi khi họ nhắc tới, nhìn thấy, hoặc tương tác với thương hiệu của bạn.",
        ],
      },
      {
        heading: "Vì sao branding quan trọng",
        paragraphs: [
          "Một thương hiệu mạnh giúp khách hàng nhớ tới bạn trước đối thủ, sẵn sàng trả giá cao hơn vì tin tưởng chất lượng, và tự nguyện giới thiệu bạn cho người khác. Đó là lý do các công ty lớn đầu tư hàng triệu đô cho branding mỗi năm.",
        ],
      },
      {
        heading: "Branding cho doanh nghiệp nhỏ",
        paragraphs: [
          "Với doanh nghiệp nhỏ, branding không cần phức tạp hay tốn kém. Bạn cần xác định rõ: thương hiệu của mình đại diện cho điều gì, nói chuyện với khách hàng bằng giọng văn nào, và nhất quán nó trên mọi điểm chạm — từ logo, website, đến cách nhân viên trả lời tin nhắn.",
          "Một sai lầm phổ biến là thay đổi nhận diện liên tục: hôm nay dùng logo này, tháng sau đổi màu sắc khác. Sự thiếu nhất quán khiến khách hàng khó nhận ra và khó tin tưởng thương hiệu.",
        ],
      },
      {
        heading: "Branding là đầu tư, không phải chi phí",
        paragraphs: [
          "Branding tốt là một khoản đầu tư, không phải chi phí. Nó giúp mọi hoạt động marketing sau này — quảng cáo, content, sale — hiệu quả hơn vì khách hàng đã có sẵn ấn tượng tích cực về bạn.",
        ],
      },
    ],
  },
  {
    slug: "seo-onpage-2024-checklist-cho-nguoi-moi",
    icon: "solar:graph-up-bold-duotone",
    cat: "SEO",
    title: "SEO On-page 2024: Checklist đầy đủ cho người mới",
    excerpt:
      "Tối ưu SEO không cần phức tạp. Với checklist này, bạn có thể tự làm ngay hôm nay mà không cần thuê agency.",
    date: "2024-04-18",
    readTime: "8 phút đọc",
    author: DUC_ANH,
    tags: ["seo", "on-page", "checklist"],
    sections: [
      {
        heading: "SEO On-page là gì?",
        paragraphs: [
          "SEO On-page nghe có vẻ kỹ thuật, nhưng phần lớn là những việc bạn có thể tự làm ngay trên website của mình mà không cần thuê agency tốn kém.",
        ],
      },
      {
        heading: "Tối ưu tiêu đề và mô tả",
        paragraphs: [
          "Bắt đầu với tiêu đề trang (title tag): mỗi trang nên có tiêu đề riêng, chứa từ khóa chính, và dài khoảng 50-60 ký tự để không bị cắt trên Google.",
          "Tiếp theo là meta description — đoạn mô tả ngắn hiện dưới tiêu đề trên kết quả tìm kiếm. Viết sao cho hấp dẫn, vì nó ảnh hưởng trực tiếp tới tỉ lệ click.",
        ],
      },
      {
        heading: "Cấu trúc heading và tốc độ tải trang",
        paragraphs: [
          "Heading (H1, H2, H3) cần có cấu trúc rõ ràng: mỗi trang chỉ một H1, các H2/H3 chia nội dung thành phần dễ đọc và giúp Google hiểu bố cục trang.",
          "Tốc độ tải trang là yếu tố xếp hạng quan trọng. Ảnh nên được nén, không dùng quá nhiều script nặng, và nên kiểm tra bằng Google PageSpeed Insights định kỳ.",
        ],
      },
      {
        heading: "Những việc nhỏ không nên bỏ qua",
        paragraphs: [
          "Cuối cùng, đừng quên alt text cho ảnh, internal link giữa các bài viết liên quan, và URL ngắn gọn dễ đọc. Làm đều các bước này, website của bạn đã ở vị thế tốt hơn 80% đối thủ chưa từng tối ưu SEO.",
        ],
      },
    ],
  },
  {
    slug: "mobile-first-uu-tien-thiet-ke-cho-dien-thoai",
    icon: "solar:smartphone-bold-duotone",
    cat: "Website",
    title: "Mobile-first: Vì sao website của bạn phải ưu tiên điện thoại",
    excerpt:
      "Hơn 70% người dùng Việt truy cập web bằng điện thoại. Thiết kế mobile-first không còn là lựa chọn mà là bắt buộc.",
    date: "2024-05-06",
    readTime: "6 phút đọc",
    author: MINH_KHOI,
    tags: ["mobile-first", "ux", "responsive"],
    sections: [
      {
        heading: "Thực trạng người dùng di động",
        paragraphs: [
          "Hơn 70% người dùng Việt Nam truy cập internet chủ yếu bằng điện thoại. Nếu website của bạn chỉ đẹp trên máy tính nhưng vỡ layout trên di động, bạn đang đánh mất phần lớn khách hàng tiềm năng.",
        ],
      },
      {
        heading: "Mobile-first là gì?",
        paragraphs: [
          "Mobile-first là cách tiếp cận thiết kế bắt đầu từ màn hình nhỏ nhất trước, rồi mở rộng lên tablet và desktop — ngược lại với cách làm truyền thống. Điều này buộc bạn tập trung vào nội dung quan trọng nhất, bỏ đi những chi tiết rườm rà.",
          "Google cũng đã chuyển sang chỉ mục mobile-first từ nhiều năm trước, nghĩa là phiên bản di động của website chính là phiên bản được dùng để xếp hạng SEO — dù người dùng có đang xem trên máy tính hay không.",
        ],
      },
      {
        heading: "Nguyên tắc thiết kế cơ bản",
        paragraphs: [
          "Một số nguyên tắc cơ bản: nút bấm đủ lớn để chạm bằng ngón tay, chữ đủ to để đọc không cần zoom, form điền thông tin càng ngắn càng tốt, và hình ảnh tự co giãn theo màn hình.",
          "Đầu tư cho trải nghiệm di động không chỉ giữ chân khách hàng lâu hơn, mà còn trực tiếp cải thiện thứ hạng tìm kiếm và tỉ lệ chuyển đổi của bạn.",
        ],
      },
    ],
  },
  {
    slug: "xay-dung-cua-hang-online-sai-lam-can-tranh",
    icon: "solar:cart-large-bold-duotone",
    cat: "E-commerce",
    title: "Xây dựng cửa hàng online: Những sai lầm cần tránh",
    excerpt:
      "Bán hàng online dễ bắt đầu nhưng khó làm tốt. Đây là những lỗi phổ biến khiến tỉ lệ chuyển đổi của bạn thấp.",
    date: "2024-05-21",
    readTime: "9 phút đọc",
    author: MINH_KHOI,
    tags: ["e-commerce", "bán hàng online", "chuyển đổi"],
    sections: [
      {
        heading: "Vì sao tỉ lệ chuyển đổi thấp",
        paragraphs: [
          "Bán hàng online dễ bắt đầu nhưng khó làm tốt. Rất nhiều cửa hàng có traffic ổn nhưng tỉ lệ chuyển đổi thấp vì mắc những lỗi cơ bản hoàn toàn có thể tránh được.",
        ],
      },
      {
        heading: "Những sai lầm phổ biến",
        paragraphs: [
          "Sai lầm đầu tiên: quy trình thanh toán quá rườm rà. Mỗi bước thêm vào giữa lúc khách quyết định mua và lúc thanh toán xong là một cơ hội để họ bỏ giỏ hàng.",
          "Sai lầm thứ hai: ảnh sản phẩm chất lượng kém hoặc thiếu thông tin chi tiết (kích thước, chất liệu, chính sách đổi trả). Khách hàng online không thể chạm vào sản phẩm, nên thông tin chính là thứ thay thế.",
          "Sai lầm thứ ba: không hiển thị rõ chi phí vận chuyển từ đầu, khiến khách bất ngờ ở bước thanh toán cuối và huỷ đơn.",
          "Sai lầm thứ tư: thiếu đánh giá hoặc minh chứng xã hội (social proof). Review thật từ khách hàng cũ là yếu tố thuyết phục mạnh nhất với người mua mới.",
        ],
      },
      {
        heading: "Cải thiện không cần nhiều chi phí",
        paragraphs: [
          "Khắc phục những điểm này không tốn nhiều chi phí, nhưng có thể cải thiện tỉ lệ chuyển đổi rõ rệt — đôi khi tăng gấp đôi doanh số chỉ từ những thay đổi nhỏ.",
        ],
      },
    ],
  },
  {
    slug: "viet-content-website-de-khach-hang-tin-tuong",
    icon: "solar:pen-new-square-bold-duotone",
    cat: "Content",
    title: "Viết content website thế nào để khách hàng tin tưởng?",
    excerpt:
      "Content tốt không phải là viết hay. Đó là nói đúng điều khách hàng quan tâm vào đúng thời điểm.",
    date: "2024-06-04",
    readTime: "5 phút đọc",
    author: NGOC_HA,
    tags: ["content", "copywriting", "khách hàng"],
    sections: [
      {
        heading: "Content tốt là gì?",
        paragraphs: [
          "Content tốt không phải là viết hay theo kiểu văn chương. Đó là nói đúng điều khách hàng đang quan tâm, vào đúng thời điểm họ cần nghe.",
          "Trước khi viết bất cứ điều gì, hãy trả lời câu hỏi: khách hàng của bạn đang lo lắng điều gì, và sản phẩm/dịch vụ của bạn giải quyết nó như thế nào? Nội dung xoay quanh câu trả lời đó luôn hiệu quả hơn nội dung quảng cáo bản thân doanh nghiệp.",
        ],
      },
      {
        heading: "Ngôn ngữ và câu chuyện thật",
        paragraphs: [
          "Tránh dùng ngôn ngữ quá hoa mỹ hoặc thuật ngữ chuyên ngành khó hiểu. Khách hàng tin tưởng sự rõ ràng, trung thực hơn là những lời quảng cáo bóng bẩy.",
          "Câu chuyện thật — từ khách hàng cũ, từ quá trình làm việc, từ những khó khăn đã vượt qua — luôn có sức nặng hơn số liệu khô khan. Con người tin vào con người, không phải vào slogan.",
        ],
      },
      {
        heading: "Bắt đầu từ điều nhỏ",
        paragraphs: [
          "Cuối cùng, content không cần hoàn hảo ngay từ đầu. Quan trọng là đăng đều đặn, theo dõi phản hồi, và cải thiện dần theo thời gian.",
        ],
      },
    ],
  },
  {
    slug: "tang-toc-website-7-meo-tai-nhanh-hon",
    icon: "solar:rocket-bold-duotone",
    cat: "Performance",
    title: "Tăng tốc website: 7 mẹo giúp trang tải nhanh hơn",
    excerpt:
      "Mỗi giây chậm trễ làm bạn mất khách. Đây là 7 cách đơn giản để website tải nhanh và mượt hơn.",
    date: "2024-06-19",
    readTime: "7 phút đọc",
    author: HAI_DANG,
    tags: ["performance", "tốc độ website", "tối ưu"],
    sections: [
      {
        heading: "Vì sao tốc độ quan trọng",
        paragraphs: [
          "Mỗi giây website tải chậm thêm có thể làm giảm tỉ lệ chuyển đổi đáng kể. Dưới đây là 7 cách đơn giản giúp trang web của bạn nhanh và mượt hơn.",
        ],
      },
      {
        heading: "4 mẹo tối ưu phía front-end",
        paragraphs: [
          "1. Nén và tối ưu hình ảnh — dùng định dạng WebP, chỉ tải kích thước ảnh thực sự cần thiết cho từng màn hình.",
          "2. Giảm số lượng script bên thứ ba — mỗi widget chat, tracking, quảng cáo thêm vào đều làm chậm trang.",
          "3. Dùng CDN để phân phối nội dung gần hơn với vị trí người dùng, giảm thời gian tải.",
          "4. Bật lazy-load cho ảnh và video nằm dưới màn hình đầu tiên, để trình duyệt không tải mọi thứ ngay lập tức.",
        ],
      },
      {
        heading: "Hạ tầng và theo dõi liên tục",
        paragraphs: [
          "5. Tối giản CSS/JS không dùng tới, gộp file khi có thể để giảm số lượng request.",
          "6. Chọn hosting tốt — một server chậm sẽ làm vô hiệu mọi tối ưu khác phía front-end.",
          "7. Kiểm tra định kỳ bằng Google PageSpeed Insights hoặc GTmetrix để phát hiện vấn đề mới phát sinh.",
        ],
      },
    ],
  },
  {
    slug: "bao-mat-website-co-ban-ssl-backup",
    icon: "solar:shield-check-bold-duotone",
    cat: "Bảo mật",
    title: "Bảo mật website cơ bản: SSL, backup và những điều cần biết",
    excerpt:
      "Một website bị hack có thể phá huỷ uy tín thương hiệu. Hãy bảo vệ tài sản số của bạn ngay từ đầu.",
    date: "2024-07-02",
    readTime: "6 phút đọc",
    author: HAI_DANG,
    tags: ["bảo mật", "ssl", "backup"],
    sections: [
      {
        heading: "Vì sao bảo mật quan trọng",
        paragraphs: [
          "Một website bị hack hoặc mất dữ liệu có thể phá huỷ uy tín thương hiệu chỉ trong vài giờ. Bảo mật cơ bản không tốn nhiều chi phí nhưng lại thường bị bỏ qua.",
        ],
      },
      {
        heading: "SSL và backup dữ liệu",
        paragraphs: [
          "Đầu tiên, luôn dùng chứng chỉ SSL (https) — ngoài việc bảo vệ dữ liệu truyền tải, nó còn là yếu tố xếp hạng SEO và tạo niềm tin trực quan cho khách hàng.",
          "Thứ hai, backup dữ liệu định kỳ và lưu ở nơi tách biệt với server chính. Nếu website gặp sự cố, bạn cần khôi phục nhanh trong vài phút, không phải vài ngày.",
        ],
      },
      {
        heading: "Cập nhật phần mềm và xác thực",
        paragraphs: [
          "Thứ ba, cập nhật phần mềm/plugin thường xuyên. Phần lớn các vụ hack website xảy ra qua lỗ hổng đã được biết từ trước nhưng chưa được vá.",
          "Cuối cùng, dùng mật khẩu mạnh và xác thực hai lớp cho các tài khoản quản trị — đây là bước đơn giản nhất nhưng ngăn được phần lớn các cuộc tấn công tự động.",
        ],
      },
    ],
  },
  {
    slug: "google-analytics-4-doc-so-lieu-dung-cach",
    icon: "solar:chart-2-bold-duotone",
    cat: "SEO",
    title: "Google Analytics 4: Đọc số liệu sao cho đúng",
    excerpt:
      "Dữ liệu chỉ có giá trị khi bạn hiểu nó. Hướng dẫn đọc các chỉ số quan trọng nhất trong GA4.",
    date: "2024-07-20",
    readTime: "8 phút đọc",
    author: DUC_ANH,
    tags: ["seo", "google analytics", "đo lường"],
    sections: [
      {
        heading: "Vì sao cần đọc đúng dữ liệu",
        paragraphs: [
          "Dữ liệu chỉ có giá trị khi bạn biết cách đọc đúng. Google Analytics 4 (GA4) thay đổi nhiều so với phiên bản cũ, khiến không ít người mới dùng cảm thấy bối rối.",
        ],
      },
      {
        heading: "Các chỉ số cần quan tâm",
        paragraphs: [
          "Chỉ số đầu tiên cần quan tâm là 'Người dùng đang hoạt động' và 'Phiên truy cập' — cho biết quy mô traffic thực tế, nhưng đừng chỉ nhìn vào số lượng tuyệt đối.",
          "Quan trọng hơn là tỉ lệ thoát theo từng trang và thời gian trên trang — nếu một trang có traffic cao nhưng tỉ lệ thoát cũng cao, nội dung hoặc trải nghiệm trang đó cần xem lại.",
        ],
      },
      {
        heading: "Đo chuyển đổi và nguồn traffic",
        paragraphs: [
          "Báo cáo 'Chuyển đổi' (Conversions) trong GA4 cho biết hành động nào (mua hàng, điền form, gọi điện) đang thực sự mang lại giá trị kinh doanh — đây là chỉ số nên ưu tiên hơn lượt xem trang.",
          "Cuối cùng, hãy thiết lập kênh nguồn traffic (Acquisition) rõ ràng để biết khách hàng đến từ đâu — tìm kiếm tự nhiên, quảng cáo, mạng xã hội hay giới thiệu — từ đó phân bổ ngân sách marketing hợp lý hơn.",
        ],
      },
    ],
  },
  {
    slug: "chon-mau-sac-thuong-hieu-tam-ly-hoc-mau",
    icon: "solar:magic-stick-3-bold-duotone",
    cat: "Branding",
    title: "Chọn màu sắc thương hiệu: Tâm lý học màu trong thiết kế",
    excerpt:
      "Màu sắc tác động tới cảm xúc và quyết định mua hàng. Cách chọn bảng màu phù hợp với ngành của bạn.",
    date: "2024-08-08",
    readTime: "6 phút đọc",
    author: THUY_LINH,
    tags: ["branding", "màu sắc", "thiết kế"],
    sections: [
      {
        heading: "Tâm lý học màu sắc",
        paragraphs: [
          "Màu sắc tác động trực tiếp tới cảm xúc và quyết định mua hàng của khách hàng, thường ở mức độ vô thức trước khi họ đọc một dòng chữ nào.",
          "Màu xanh dương thường gợi cảm giác tin cậy, chuyên nghiệp — phù hợp với ngành tài chính, công nghệ. Màu cam, vàng gợi sự năng động, thân thiện — phù hợp với ngành F&B, dịch vụ sáng tạo.",
          "Màu xanh lá liên kết với thiên nhiên, sức khỏe, bền vững. Màu đen, trắng tối giản thường được các thương hiệu cao cấp lựa chọn để truyền tải sự sang trọng.",
        ],
      },
      {
        heading: "Sai lầm khi chọn màu",
        paragraphs: [
          "Một sai lầm phổ biến là chọn màu theo sở thích cá nhân của chủ doanh nghiệp, thay vì theo cảm nhận mong muốn từ khách hàng mục tiêu.",
        ],
      },
      {
        heading: "Quy tắc chọn màu an toàn",
        paragraphs: [
          "Quy tắc an toàn: chọn một màu chủ đạo, một màu phụ trợ, và giữ nguyên chúng xuyên suốt mọi điểm chạm — từ logo, website, đến bao bì sản phẩm — để xây dựng nhận diện nhất quán theo thời gian.",
        ],
      },
    ],
  },
  {
    slug: "xay-dung-cong-dong-quanh-thuong-hieu",
    icon: "solar:users-group-rounded-bold-duotone",
    cat: "Content",
    title: "Xây dựng cộng đồng quanh thương hiệu của bạn",
    excerpt:
      "Khách hàng trung thành đáng giá hơn khách hàng mới. Cách tạo ra cộng đồng yêu thích thương hiệu.",
    date: "2024-08-25",
    readTime: "7 phút đọc",
    author: NGOC_HA,
    tags: ["content", "cộng đồng", "khách hàng trung thành"],
    sections: [
      {
        heading: "Vì sao cộng đồng quan trọng",
        paragraphs: [
          "Khách hàng trung thành đáng giá hơn khách hàng mới rất nhiều — chi phí giữ chân một khách cũ thường thấp hơn nhiều lần so với chi phí tìm một khách mới.",
        ],
      },
      {
        heading: "Cách xây dựng cộng đồng",
        paragraphs: [
          "Xây dựng cộng đồng không nhất thiết phải là một group Facebook hàng nghìn người. Đôi khi đó chỉ là cách bạn duy trì liên lạc đều đặn, lắng nghe phản hồi, và khiến khách hàng cảm thấy được trân trọng.",
          "Một cách hiệu quả là tạo không gian để khách hàng chia sẻ trải nghiệm với nhau — review, hình ảnh sử dụng sản phẩm, câu chuyện thành công. Điều này tạo ra minh chứng xã hội tự nhiên hơn bất kỳ quảng cáo nào.",
          "Đừng chỉ xuất hiện khi cần bán hàng. Cộng đồng phát triển bền vững khi thương hiệu thường xuyên mang lại giá trị — kiến thức, hỗ trợ, hoặc đơn giản là sự đồng hành — không chỉ lời chào mời mua hàng.",
        ],
      },
      {
        heading: "Giá trị dài hạn",
        paragraphs: [
          "Về lâu dài, một cộng đồng gắn bó chính là kênh marketing rẻ và hiệu quả nhất: khách hàng cũ tự nguyện giới thiệu bạn cho người khác.",
        ],
      },
    ],
  },
  {
    slug: "roi-marketing-online-do-luong-hieu-qua",
    icon: "solar:dollar-minimalistic-bold-duotone",
    cat: "Performance",
    title: "ROI của marketing online: Đo lường hiệu quả thật sự",
    excerpt:
      "Tiêu tiền quảng cáo mà không đo được kết quả là lãng phí. Cách tính ROI cho từng kênh marketing.",
    date: "2024-09-10",
    readTime: "9 phút đọc",
    author: HAI_DANG,
    tags: ["performance", "roi", "marketing"],
    sections: [
      {
        heading: "ROI là gì?",
        paragraphs: [
          "Tiêu tiền quảng cáo mà không đo được hiệu quả thực sự là lãng phí — dù chiến dịch có vẻ 'chạy tốt' trên báo cáo nền tảng.",
          "ROI (Return on Investment) cơ bản được tính bằng: (Doanh thu từ kênh đó − Chi phí đầu tư) / Chi phí đầu tư. Nghe đơn giản, nhưng phần khó là xác định đúng doanh thu thực sự đến từ kênh nào.",
        ],
      },
      {
        heading: "Cách đo lường chính xác",
        paragraphs: [
          "Để làm điều đó, bạn cần gắn UTM tracking cho từng chiến dịch, thiết lập mục tiêu chuyển đổi rõ ràng trong Google Analytics, và đối chiếu với dữ liệu bán hàng thực tế — không chỉ dựa vào số liệu nền tảng quảng cáo tự báo cáo.",
        ],
      },
      {
        heading: "Lưu ý khi đánh giá ROI",
        paragraphs: [
          "Một lưu ý quan trọng: không phải mọi kênh đều nên đánh giá bằng ROI ngắn hạn. Content xây dựng thương hiệu hay SEO thường có ROI chậm hơn nhưng bền vững hơn quảng cáo trả tiền.",
          "Doanh nghiệp nhỏ nên bắt đầu với 1-2 kênh, đo lường kỹ trước khi mở rộng, thay vì rải ngân sách mỏng trên quá nhiều nền tảng cùng lúc mà không kênh nào đủ dữ liệu để đánh giá chính xác.",
        ],
      },
    ],
  },
]

export function findPost(slug: string): Post | undefined {
  return POSTS.find((p) => p.slug === slug)
}

export function relatedPosts(current: Post, limit = 3): Post[] {
  const sameCat = POSTS.filter(
    (p) => p.slug !== current.slug && p.cat === current.cat
  )
  const rest = POSTS.filter(
    (p) => p.slug !== current.slug && p.cat !== current.cat
  )
  return [...sameCat, ...rest].slice(0, limit)
}

export function formatDateVi(iso: string): string {
  const [y, m, d] = iso.split("-").map(Number)
  return `${d} tháng ${m}, ${y}`
}

// Tạo id ổn định (ascii, không dấu) từ heading để dùng cho mục lục + scroll-to.
export function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-")
}
