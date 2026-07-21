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
  - Profile: AES-GCM qua `api/encryption.tsx` (HKDF từ `DRYSTACK_SECRET`).
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
  (local mặc định). `passwd` giữ nguyên profile, re-encrypt theo secret hiện tại.
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

## Phase 2 (chưa làm)

- Reader đọc R2 lúc request trong Worker (trang public SSR lấy content thẳng từ
  R2 — hết cần rebuild khi save).
- VEI trên prod r2: dry-map/opaque id như github mode (hiện dry.ts chỉ làm cho
  github; r2 prod mà bật VEI sẽ lộ field path trong HTML public) + nguồn ghi
  dry-map khi trang SSR không còn prerender.
- Logout hiện chỉ xoá cookie — JWT stateless nên token bị lộ vẫn sống tới khi hết
  hạn (7 ngày); muốn revoke thật cần jti/blacklist trong R2 hoặc rút maxAge.
- Nút logout + hiển thị profile trong admin UI cho r2 mode.
- Flip prod: tạo bucket thật (`wrangler r2 bucket create drystack-content`),
  `drystack-auth.ts add --remote`, `r2-seed.ts --url <prod>`, đặt `PUBLIC_R2=true`.
