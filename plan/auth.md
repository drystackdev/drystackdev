# Auth + R2 storage

## Kế hoạch gốc

- Hệ thống quản lý dữ liệu qua R2
- thêm kind mới cho storage là `{ kind: "r2" }` (viết thường, nhất quán với `local`/`github`)
- tương tự github/local nhưng các file được lấy toàn qua R2 của Cloudflare
- /drystack và VEI cần được bảo vệ qua JWT, các hàm save file cũng vậy, GET thì không cần
- luồng login:
  - vào `/drystack/**/*` mà chưa có auth (hoặc auth sai) → redirect `/login`
  - login qua email/password; thư mục `auth/native/` chứa file JSON tên là email,
    trong đó `password` hash một chiều, `profile` mã hoá bằng DRYSTACK_SECRET
  - đăng nhập đúng → trả profile + email; `auth/native/` được bảo mật tuyệt đối
- tree/blob/update chỉ giới hạn trong content/ và assets/ (không phục vụ gì khác)

## Quyết định đã chốt (2026-07-21, cùng chủ repo)

- **Phase 1 = CMS-only**: admin + VEI + auth chạy hoàn toàn trên R2. Trang public
  vẫn đọc content từ repo lúc build (Astro sẽ luôn SSR qua adapter Cloudflare —
  reader đọc R2 lúc request là việc của phase 2).
- **Auth chỉ bật với kind `r2`**: local dev không cần login, github giữ OAuth GitHub.
- **Tạo user**: script CLI **và** trang setup lần đầu (bucket chưa có user nào thì
  /login hiện form tạo admin đầu tiên).
- **Dev dùng miniflare local R2** (.wrangler/state), seed bằng script.
- Dev mặc định `kind: 'r2'` (drystack.config.ts); **prod tạm giữ github** vì repo có
  auto-commit/auto-deploy — khi bucket thật đã seed + có user thì flip bằng env
  `PUBLIC_R2=true` (override trong `config()`, không cần sửa code).

## Đã triển khai (phase 1 — hoàn thành 2026-07-21)

### Storage kind `r2`
- `config.tsx`: `R2StorageConfig`/`R2Config`; `LocalOrDemoConfig` →
  `LocalShapedConfig` (local | demo | r2); override `PUBLIC_R2=true`.
- `storage-mode.ts`: `isR2Config`, `isLocalShapedConfig` — client admin coi r2 là
  "local-shaped" (một tree, không branch, REST `/api/drystack/tree|blob|update`).
- Server: `api/api-r2.ts` — bản song sinh của `api-node.ts` chạy được trong workerd,
  backend là R2 binding `DRYSTACK_R2` (wrangler.jsonc, bucket `drystack-content`).
  - Git blob sha lưu ở `customMetadata['drystack-blob-sha']` khi ghi; object thiếu
    metadata (seed tay/dashboard) được backfill lười ở lần tree đầu.
  - tree/blob/update **chỉ** phục vụ allowlist từ config (content dirs + `assets` +
    `.deleted`) — mọi thứ khác trong bucket, nhất là `auth/`, không tồn tại với API.
  - `update` (ghi/xoá) đòi session JWT; deletion xoá cả key lẫn prefix con (như
    `rm -r` của local mode).
- `api/allowed-directories.ts`: tách `getAllowedDirectories` khỏi `read-local.ts`
  để worker bundle không kéo `node:fs`.

### Native auth
- `api/native-auth.ts` (WebCrypto thuần — chạy ở Worker/Node/bun):
  - Password: PBKDF2-SHA256 **100k iterations** (trần cứng của Workers), salt riêng,
    format `pbkdf2$sha256$<iter>$<salt>$<hash>`, so sánh constant-time; số iteration
    lưu trong hash nên nâng sau không vỡ user cũ.
  - Profile: JSON thuần, không mã hoá (display data, không phải credential).
  - Session: JWT HS256 tự mint/verify (chỉ chấp nhận alg HS256), 7 ngày.
  - Cookie: `drystack-session` (HttpOnly) + `drystack-session-hint` (không HttpOnly,
    chỉ để VEI/client biết trạng thái — mọi check thật đều verify JWT server-side).
- Routes (`/api/drystack/auth/*`, nằm trong nhánh r2 của `generic.ts`):
  `status` (needsSetup/authenticated), `login`, `setup` (chỉ khi `auth/native/`
  rỗng, password ≥ 8 ký tự), `me`, `logout`. Sai email và sai password trả body
  giống hệt nhau (chống dò email).
- `ai/*` trong r2 mode cũng đòi session (đốt tiền API key — cùng lý do github mode
  verify token).

### Gating
- `/drystack/**`: `drystack-astro-page.astro` verify JWT server-side, chưa có →
  redirect `/login?from=…` (`packages/astro/src/native-session.ts`).
- `/login`: route inject bởi integration (`internal/drystack-login.astro`) —
  login + setup lần đầu, song ngữ vi/en theo `config.locale`, kind khác r2 thì
  redirect về `/`.
- VEI: eligibility script thêm check `drystack-session-hint`; save/read của VEI
  (editor/save.ts) đi cùng đường REST như local, kèm 401 → `/login`.
- Client core: mọi fetch `/update` gặp 401 → redirect `/login?from=…`
  (`redirectToNativeLoginIfUnauthorized` trong app/auth.ts) — draft còn nguyên
  trong IndexedDB, quay lại là tiếp tục.

### Scripts
- `scripts/drystack-auth.ts` — `add|passwd|remove <email>` (+ `--profile`,
  `--password`, `--remote`); ghi `auth/native/<email>.json` qua wrangler
  (local mặc định). `passwd` giữ nguyên profile, chỉ thay hash mật khẩu.
- `scripts/r2-seed.ts` — seed content qua **chính API `/update`** (không dùng
  `wrangler r2 object put` vì wrangler encodeURI key: file có dấu cách sẽ thành
  `%20` sai lệch). Tự setup admin đầu tiên nếu bucket trống. `--url` để seed prod.
- `DRYSTACK_SECRET` đã thêm vào `.env` (+ ghi chú `.env.example`).

### Đã kiểm chứng
- 14 unit test mới (native-auth + api-r2 với mock bucket) — pass; toàn suite
  255 pass / 0 fail; tsc cả 2 package 0 lỗi.
- Test thật qua `astro dev` + miniflare (curl): gate /drystack (302 → /login),
  login đúng/sai, setup one-shot, tree không lộ `auth/`, blob theo sha, update
  401 khi anonymous / 200 khi có session, chặn ghi `auth/` kể cả có session,
  xoá theo thư mục, logout, `auth/me`, trang /login render tiếng Việt.
- Admin UI React trong browser **chưa** click-test tay (data path giống hệt local
  mode; cần một vòng browser-test khi tiện).

## ✅ LIVE trên production 2026-07-21 — r2 + SSR + cache đang chạy thật

R2 đã bật trên dashboard, bucket `drystack-content` tạo thật
(`creation_date: 2026-07-21T17:27:01`). Phát hiện auto-deploy của repo
**không** tự chạy cho các commit của session này (`wrangler deployments
list` cho thấy lần deploy gần nhất trước cả khi session bắt đầu sửa code) —
tự tay chạy `bunx wrangler deploy` sau khi xác nhận với chủ repo.

**Bug thật bắt được lúc deploy đầu tiên** (500 trên mọi trang): Cloudflare
Workers cấm sinh giá trị random ở module scope ("Disallowed operation
called within global scope... generating random values"). `app/edit-sync.ts`
có `const origin = crypto.randomUUID()` chạy ngay lúc import (dành cho định
danh tab trong tính năng đồng bộ VEI qua BroadcastChannel) — vô hại dưới
`output:"static"` cũ (module này chưa từng lọt vào Worker bundle), nhưng giờ
site SSR toàn phần nên Footer.astro (chạy trên mọi trang) kéo module này vào
theo transitively, và code chạy ở module scope thật trong Worker thay vì chỉ
trong browser. `astro dev`/miniflare không bắt được lỗi này (miniflare không
strict bằng edge runtime thật) — chỉ lộ ra khi deploy thật. Fix: đổi
`origin` từ hằng số module-scope sang `getOrigin()` lazy-init (gọi lần đầu
mới random, y hệt pattern `getChannel()` đã có sẵn trong file). Đã grep toàn
bộ 2 package tìm thêm `crypto.randomUUID`/`Math.random`/`fetch`/`setTimeout`
ở module scope — không còn chỗ nào khác.

Đã seed xong bucket production thật (`bun scripts/r2-seed.ts --email
thanhkhan2k@gmail.com --password *** --url https://quangseo.drystack.dev`) —
30 file content + tạo admin đầu tiên (`thanhkhan2k@gmail.com`). Verify trực
tiếp trên `quangseo.drystack.dev` thật (không phải miniflare):
- `/`, `/blog`, `/dich-vu`, `/kien-thuc-seo`, `/gioi-thieu`, `/demo`,
  `/sitemap.xml`, `/login` → 200.
- `/drystack` không có session → 302 `/login`; login bằng tài khoản thật →
  200, session hoạt động.
- Cache edge thật: request 1 `/blog` → `x-drystack-cache: MISS`, request 2 →
  `HIT` — xác nhận cơ chế cache-tới-khi-save hoạt động đúng trên Cloudflare
  edge thật, không chỉ trong miniflare.

## Đã triển khai (phase 2 — code xong 2026-07-21, verify qua dev/miniflare)

- **`reader/r2.ts`** (`@drystack/core`): đọc content trực tiếp từ R2 tại
  request time — `readFile`/`fileExists` (qua `head()`, không tốn băng thông
  body) là single-object call, `readdir` list theo prefix (tái dùng
  `listAll` export từ `api-r2.ts`). Không cần "load cả tree" như github
  reader vì R2 key được địa chỉ hoá trực tiếp.
- **`packages/astro/src/reader.ts`**: thứ tự ưu tiên giữ nguyên logic cũ
  (local/demo/**có filesystem lúc build** → đọc fs, kể cả r2 và github khi
  đang prerender trên máy build) — chỉ thêm nhánh: r2 **không có** fs (Worker
  thật lúc request) → `createR2Reader` với binding `DRYSTACK_R2` qua
  `cloudflare:workers`.
- **Toàn bộ site chuyển sang SSR thật** (`astro.config.mjs`:
  `output: "server"`, không còn `output: "static"`) — không riêng gì
  `/drystack`, mọi route (`/`, `/blog`, `/dich-vu`, `/kien-thuc-seo`,
  `/gioi-thieu`, `/demo`) giờ render on-demand, chỉ còn `/__data.zip`
  (dùng cho demo mode) là prerender. Bỏ `getStaticPaths()` ở 3 trang
  `[slug].astro` (không cần nữa, param lấy thẳng từ request).
  - `imageService: { build: 'compile', runtime: 'passthrough' }` thêm vào
    adapter Cloudflare — mặc định của adapter là `cloudflare-binding` (cần
    Cloudflare Images binding, dự án chưa có), `passthrough` là lựa chọn an
    toàn không cần hạ tầng thêm (ảnh runtime phục vụ nguyên bản, không
    resize; ảnh import tĩnh vẫn tối ưu lúc build nhờ `compile`).
  - **`@astrojs/sitemap` bị gỡ bỏ** (integration đó chỉ thấy trang đã
    prerender ra file tĩnh — dưới SSR toàn phần nó sẽ âm thầm mất hết
    blog/dịch vụ/kiến thức SEO). Thay bằng `src/pages/sitemap.xml.ts` tự
    build sitemap từ `getBlogPosts`/`getSeoKnowledgePosts`/`getServices` mỗi
    request — luôn khớp nội dung thật. `robots.txt` cập nhật trỏ
    `/sitemap.xml` + thêm `Disallow: /login`.
  - Cloudflare adapter tự thêm binding KV `SESSION` (tính năng session của
    Astro, tự kích hoạt khi `output:"server"`) — **không dùng tới** trong
    code (không gọi `Astro.session` ở đâu), và theo tài liệu Cloudflare, KV
    namespace loại này **tự động provision lúc deploy** (khác R2) nên không
    phải lo.
- **jti + blacklist** (`api/native-auth.ts`, `api/api-r2.ts`): JWT giờ có
  `jti` ngẫu nhiên; logout ghi `auth/revoked/<jti>` (nội dung = `exp` để dọn
  sau); mọi nơi verify session (route auth, update, ai/*, page gate
  `/drystack` qua `native-session.ts`) đều tra blacklist qua
  `verifiedSession()` (export từ `api-r2.ts`) — không chỉ verify chữ ký/hạn.
  Đăng nhập lại sau logout cấp `jti` mới, hoạt động bình thường.
- **Nút logout + tên user trong sidebar** (r2 mode): `app/native-user.tsx`
  (`NativeUserProvider`/`useNativeUser`, fetch `auth/me` một lần lúc mount) +
  sidebar `UserActions`/`SidebarFooter`/`SidebarHeader` giờ coi r2 giống
  github (có identity thật) thay vì giống local/demo (ẩn hết) — logout gọi
  `nativeLogout()` (POST `/auth/logout` rồi redirect `/login`, không dùng
  `href` GET như github vì route logout của r2 là POST-only).
- **Test**: +6 unit test (jti/blacklist trong `native-auth.test.ts`,
  `api-r2.test.ts`), +3 test cho `reader/r2.ts`; toàn bộ core suite
  **260 pass / 0 fail**, tsc 0 lỗi cả `@drystack/core` và `@drystack/astro`.
  Test thật qua `astro dev` + miniflare: tạo bài viết mới qua API `/update`
  → xuất hiện **ngay lập tức** trên `/blog`, trang chi tiết, và
  `/sitemap.xml` — không rebuild. `astro build` thật chạy sạch, log xác nhận
  chỉ `/__data.zip` được prerender.

### Edge cache cho trang public (2026-07-21, theo yêu cầu)

Trang public giờ được cache ở Workers Cache API, **cache tới khi có save
mới** (event-based, không phải TTL cố định):

- `api/api-r2.ts`: object `_meta/content-version` (ngoài allowlist, giống
  `auth/`) giữ 1 token `<timestamp>-<random>`, bump mỗi khi `update()` ghi
  thật (có addition/deletion — no-op write không bump). Đọc bằng `head()`
  (không tốn băng thông body) nên rẻ dù gọi mỗi request.
- `packages/astro/src/cache-middleware.ts`: middleware Astro
  (`addMiddleware`, order `pre`, tự inject cho mọi site dùng
  `@drystack/astro` — no-op nếu `storage.kind !== 'r2'`). Cache key = URL +
  `?__cv=<version>`; version đổi → cache key đổi → miss tự nhiên, không cần
  bước "purge" riêng phải nhớ làm. Loại trừ `/drystack`, `/api/drystack`,
  `/login` (luôn render live). Response trả về `Cache-Control: max-age=0` để
  browser luôn revalidate — tầng cache "cho tới khi save" chỉ nằm ở Workers
  Cache API, không phải cache trình duyệt. Header debug
  `x-drystack-cache: HIT|MISS|SKIP` trên mọi response.
- **Bug đã bắt và fix lúc test**: response lưu vào cache đã tự mang theo
  `Cache-Control: max-age=0` (set cho bản trả về client) — Cloudflare Cache
  API **tôn trọng Cache-Control của chính response được lưu**, nên
  `max-age=0` khiến nó từ chối lưu/lưu-rồi-coi-như-stale-ngay-lập-tức, gây
  ra tình trạng "MISS mãi mãi không bao giờ HIT". Sửa bằng cách tách 2 bản
  response: bản lưu cache có `max-age=31536000, immutable` (không quan
  trọng vì key theo version rồi), bản trả về client mới có `max-age=0`.
  Cũng phát hiện dùng `waitUntil` không có fallback thì `cache.put()` có
  thể bị cắt giữa chừng trước khi request kết thúc — giờ fallback `await`
  trực tiếp khi không có `context.locals.cfContext`.
  - Verify qua `astro dev` + miniflare: MISS lần đầu → HIT các lần sau; save
    (kể cả xoá) → MISS ngay request kế tiếp, HIT lại từ request sau đó; áp
    dụng cho `/blog`, trang chi tiết, `/sitemap.xml`; `/drystack`/`/login`
    xác nhận không bao giờ có header cache (luôn render live).

### Status/deploy UI cho r2 (xác nhận, không cần code mới)

Yêu cầu "trang admin r2 không cần hiện status navbar vì save cập nhật ngay"
đã **thoả sẵn** — `SidebarGitActions`/`DeployButton`/`CurrentBrandChip` (khái
niệm build/deploy bất đồng bộ của github mode) vẫn dùng nguyên
`isLocalShapedConfig` (gồm local|demo|r2) nên tự động ẩn cho r2, không đổi gì
trong session này. Không thêm UI trạng thái mới cho tính năng cache — cache
là vô hình với người dùng admin (save vẫn thấy live ngay, đúng như trước).

### VEI pen/edit button không còn bypass auth trong dev (2026-07-22)

Bug: stage-1 eligibility check của VEI (`packages/astro/src/index.ts`, script
inject vào mọi trang) có `import.meta.env.DEV ||` — cờ này luôn `true` khi
chạy `astro dev`, **bất kể storage kind hay đã login hay chưa**. Với
local/demo/github, đúng ý (dev machine tự nó đã là môi trường tin cậy); với
`kind: "r2"` (giờ cũng chạy ở local, có auth thật) thì sai — nút edit hiện ra
dù chưa đăng nhập.

Fix: giữ nguyên stage-1 (chỉ quyết định có tải editor bundle hay không, để
tối ưu — không đổi, vẫn tải trong mọi trường hợp dev). Thêm gate thứ 2 SAU
khi `cfg` (config thật, load qua Vite nên `import.meta.env.DEV` được resolve
đúng) đã sẵn sàng: nếu `cfg.storage.kind === 'r2'` mà không có cookie
`drystack-session-hint`, bỏ qua `editor.mount()`. Verify: fetch trực tiếp
bundle `astro:scripts/page.js`, xác nhận logic `r2SignedOut` đúng thứ tự;
login xong cookie `drystack-session-hint=1` xuất hiện đúng lúc gate cho
mount chạy. tsc 0 lỗi, test suite 261/0.

## Còn lại (chưa làm)

- **VEI dry-map/opaque id cho r2 mode**: `astro/src/dry.ts` hiện chỉ ẩn
  field path bằng `data-dry-id` cho `storage.kind === "github"`; r2 (như
  local) vẫn bake `data-dry`/`data-dry-kind`/`data-dry-value` trực tiếp vào
  HTML. Với local đây là vô hại (dev-only, không public); với r2 **production
  thì có** — public HTML lộ cấu trúc field (không lộ secret, nhưng lộ
  structure) cho MỌI khách ẩn danh, không chỉ riêng admin đã login. Cần làm
  giống github: opaque id + route `auth/dry-map` phục vụ map thật sau khi
  verify session, y hệt cách `github/dry-map` đã làm trong `generic.ts`.
- Trang setup lần đầu qua `/login` (đã có), nhưng chưa có UI đổi mật khẩu/
  quản lý nhiều user trong app — chỉ có script CLI.
- Chưa browser-click-test tay giao diện admin React cho r2 mode (chỉ verify
  qua curl + unit test) — nay production đã live, nên bạn tự đăng nhập thử
  trên `quangseo.drystack.dev/drystack` khi tiện.
