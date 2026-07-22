# Hệ thống quản lý tài khoản và phân quyền

- có các collection mặc định thuộc về hệ thống này ở chế độ {kind: 'r2'}
- hệ thống user phân quyền toàn bộ dựa trên D1 của cloudfare

## 0. Quyết định đã chốt (2026-07-22, cùng chủ repo)

- **Chỉ bật khi `storage.kind === 'r2'`.** local không có gate, github giữ
  nguyên OAuth GitHub (không đụng tới) - đây là 1 kind hoàn toàn mới, không vi
  phạm standing rule "mọi feature chạy được cả local & github" của CLAUDE.md
  vì rule đó nói về các *storage kind sẵn có*, không bắt phải nhân bản D1 cho
  local/github. Menu "User management"/"Role management" ẩn hoàn toàn ở
  local/github, giống cách `files`/redirects hiện đang được build tay trong
  `useNavItems.tsx`.
- **Không migrate user R2 YAML cũ.** Site đang LIVE (`quangseo.drystack.dev`)
  có đúng 1 user thật (`thanhkhan2k@gmail.com`, seed qua
  `scripts/r2-seed.ts`) lưu ở `auth/native/*.yaml` theo cơ chế cũ
  (`plan/auth.md`). Cắt hẳn sang D1: sau khi deploy, `auth/native/*.yaml` +
  `auth/revoked/*` cũ coi như rác, dọn tay; đăng nhập/setup lần đầu chạy lại
  qua `/register-first` để tạo SuperAdmin thật trong D1 (xem mục 8).
- **Permission enforce cả UI lẫn server API** - không chỉ ẩn nút, các route
  đọc/ghi hiện có (`tree`/`blob`/`update` trong `api-r2.ts`, `ai/magic-write`)
  phải tự kiểm tra quyền của session trước khi chạy.
- **Email dùng Cloudflare Email Service** (Worker binding "Send Email") -
  cần thêm lại cấu hình gửi email vào `wrangler.jsonc` (đã bị gỡ ở commit
  `e0a0c68` cùng lúc xoá bản user-management cũ) + verify domain gửi trên
  dashboard Cloudflare.
- **1 user có thể có nhiều role** (không phải 1 role/user như bản nháp đầu).
  Quyền thực tế của user = **hợp (union)** permission của mọi role đang gán.
  Riêng role **SuperAdmin luôn đúng 1 user** (ràng buộc cứng ở tầng logic, xem
  mục 4) - không đi qua rule "nhiều role" này.

## 1. Kiến trúc lưu trữ

- **D1** (database mới, binding `DRYSTACK_DB` trong `wrangler.jsonc`, ví dụ
  tên resource `drystack-db`) chứa 3 bảng `user`/`role`/`user_role` - **toàn
  bộ** dữ liệu tài khoản + phân quyền, thay thế hẳn `auth/native/*.yaml`
  trong R2.
- **R2** (`DRYSTACK_R2`, đã có sẵn) vẫn giữ nguyên vai trò content
  tree/assets như hiện tại; chỉ thêm 1 việc mới: lưu **avatar** (đề xuất path
  `_system/avatars/<userId>.<ext>`, xem mục 6 - nằm ngoài mọi collection nên
  không lọt vào tree của file manager).
- Cơ chế **session JWT (`native-auth.ts`) giữ nguyên 100%**: ký/verify HS256,
  cookie `drystack-session` (HttpOnly) + `drystack-session-hint`, jti +
  blacklist thu hồi (`auth/revoked/<jti>` trong R2 - phần này **không** đổi
  sang D1, vẫn hợp lý vì đó là dữ liệu tồn tại ngắn hạn theo TTL token). Thứ
  duy nhất đổi là **nguồn xác thực** email/password: từ `readUserFile`/
  `writeUserFile` (R2 YAML) sang query D1.
- **Session verify phải thêm bước tra D1** (không chỉ chữ ký + jti blacklist
  như hiện tại): user bị xoá hoặc `active = false` phải mất quyền truy cập
  **ngay ở request tiếp theo**, không cần đợi token hết hạn hay logout thủ
  công. Đây là điểm khác với hôm nay (nơi mọi session hợp lệ chữ ký là được
  chấp nhận).

## 2. Schema D1

```sql
CREATE TABLE user (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  password      TEXT,              -- NULL khi user mới "pending invite", set khi bấm link verify
  avatar        TEXT,              -- path trong R2, vd _system/avatars/<id>.png
  phone_number  TEXT,
  address       TEXT,
  email_verify_at   TEXT,          -- ISO datetime, NULL = chưa verify
  invite_token      TEXT,          -- token verify/đặt mật khẩu lần đầu, dùng chung cho forgot-password
  invite_token_exp  TEXT,          -- ISO datetime, 24h cho invite / 1h cho forgot-password
  active        INTEGER NOT NULL DEFAULT 1, -- 0/1
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE TABLE role (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]', -- JSON string[] , vd ["collection:blog.view","singleton:demo.created"]
  is_builtin  INTEGER NOT NULL DEFAULT 0  -- 1 cho SuperAdmin/Admin/Editor - khoá xoá + khoá đổi tên (SuperAdmin/Admin) hoặc chỉ khoá xoá-khi-đang-seed (Editor, xem mục 4)
);

CREATE TABLE user_role (
  user_id INTEGER NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  role_id INTEGER NOT NULL REFERENCES role(id) ON DELETE CASCADE,
  PRIMARY KEY (user_id, role_id)
);
```

Ghi chú:
- `password` **nullable** khác bản nháp đầu - user mới thêm qua "add user"
  chưa có mật khẩu cho tới khi verify (trạng thái "pending invite", đúng khái
  niệm `pendingInviteLabel`/`pendingInviteEditNotice` đã có trong bản UI cũ
  bị xoá ở `e0a0c68` - tái dùng lại ý tưởng này).
- D1/SQLite không có kiểu array/JSON thật -> `role.permissions` lưu **TEXT
  JSON**, parse ở tầng app. Ở quy mô <100 user, vài chục role là đủ nhẹ,
  không cần bảng `role_permission` chuẩn hoá riêng.
- 1 cặp `invite_token`/`invite_token_exp` dùng chung cho **cả 2** luồng
  "verify tài khoản mới" và "quên mật khẩu" (cùng bản chất: link 1 lần dẫn
  tới trang password-setting) - đơn giản hơn 2 bảng token riêng.

## 3. Auth flow đổi so với hiện tại (`api-r2.ts` / `native-auth.ts`)

- `hasAnyUser()` (đang đếm object trong `auth/native/`) -> đổi thành
  `SELECT COUNT(*) FROM user`. Route `POST /auth/setup` (đang là
  "register-first" thật sự) ghi vào D1 thay vì `writeUserFile`, và **gán
  role SuperAdmin** cho user vừa tạo trong cùng transaction. Đây là **lần
  duy nhất** SuperAdmin được gán - UI role list không bao giờ cho thêm/xoá
  user khỏi role SuperAdmin qua dialog (xem mục 6).
- `POST /auth/login`: `readUserFile` + `verifyPassword` -> đổi thành
  `SELECT * FROM user WHERE email = ?` + `verifyPassword` (hàm không đổi) +
  chặn nếu `active = 0` hoặc `password IS NULL` (user chưa verify chưa có
  mật khẩu, đừng để lọt qua verifyPassword với null).
- Verify session (chỗ đang chỉ check chữ ký + jti blacklist trong
  `api-r2.ts`): thêm bước `SELECT active FROM user WHERE email = ?`, coi như
  invalid nếu không tìm thấy hoặc `active = 0`. Cache ngắn hạn (vài giây,
  optional) nếu lo tốn query D1 trên mỗi request, nhưng ở quy mô <100 user
  không cần optimize sớm.
- `scripts/drystack-auth.ts` (`add|passwd|remove`) hiện ghi thẳng R2 bucket -
  **phải viết lại** để chạy qua `wrangler d1 execute`/binding D1, giữ nguyên
  vai trò "cửa sau" khẩn cấp khi bị khoá ngoài UI (vd reset mật khẩu
  SuperAdmin).

## 4. Permission model

- Permission string dạng `collection:<key>.<action>` /
  `singleton:<key>.<action>`, `<action> ∈ view | created | updated |
  magicWriter | deleted` (đúng đặc tả UI ở mục 6 - "không bật view thì 3 nút
  còn lại vô giá trị").
- Quyền hiệu lực của 1 user = **union** permission string của mọi role đang
  gán (đã chốt "nhiều role/user").
- **SuperAdmin & Admin không cần liệt kê permission string trong DB** - có
  toàn quyền bằng cách **hardcode** trong hàm `hasPermission()` (check
  `role.name === 'SuperAdmin' || role.name === 'Admin'` trước, trả `true`
  ngay, không cần tra JSON permissions). Ngoại lệ riêng của **Admin** (không
  biểu diễn được bằng permission string thông thường vì đây là hành động
  trên chính hệ thống user/role, không phải trên 1 collection):
  - không được xoá user
  - không được gán/gỡ role Admin cho người khác (và tất nhiên không thể tạo
    thêm SuperAdmin - hành động này không tồn tại trong UI với bất kỳ ai)
  Hai check này nằm riêng trong route add-user/user-role, không nằm trong
  bảng `role.permissions`.
- **Editor**: role có sẵn (`is_builtin = 1`), seed permissions rỗng `[]`.
  Khác SuperAdmin/Admin, Editor **không bị khoá xoá/đổi tên** - dùng đúng
  rule chung "role.length(user) = 0 thì được xoá" như role tự tạo. Nếu muốn
  Editor bất-khả-xâm-phạm giống SuperAdmin/Admin thì cần xác nhận lại (hiện
  đang suy luận từ việc bullet trong tài liệu gốc tách Editor ra khỏi câu
  "không thể xoá bởi bất kì ai" của SuperAdmin/Admin).
- Ràng buộc cứng ở tầng app (không phải DB constraint, D1 không hỗ trợ check
  phức tạp): gán role SuperAdmin cho user thứ 2 -> luôn từ chối; xoá user
  đang giữ role SuperAdmin -> luôn từ chối (kể cả chính SuperAdmin tự xoá
  mình); xoá chính mình khỏi user list -> từ chối (self-delete), tương ứng
  `cannotDeleteSelfError` đã có ở bản UI cũ.

## 5. Enforce permission ở server (route theo route)

Route hiện có trong `api-r2.ts` cần thêm 1 lớp check permission trước khi
chạy logic hiện tại (permission check này **thêm vào**, không thay thế, gate
session hiện tại vẫn giữ nguyên):

- `GET tree` / `GET blob` -> action `view` cho collection/singleton tương
  ứng path đang đọc.
- `POST update` (additions + deletions gộp 1 request) -> **không có sẵn khái
  niệm created/updated/deleted riêng** ở route này hôm nay, cần phân loại
  từng path trong payload: path đã tồn tại trước đó + có nội dung mới =
  `updated`; path chưa tồn tại = `created`; path nằm trong `deletions` =
  `deleted`. 1 request có thể cần nhiều permission cùng lúc (vd sửa 1 file +
  xoá 1 file) - từ chối toàn bộ request nếu thiếu **bất kỳ** quyền nào trong
  số cần.
- `ai/magic-write` (r2 mode đã đòi session, giờ thêm) -> action `magicWriter`
  cho collection/singleton đang generate.
- Route thuộc chính User/Role management (mục 6, sẽ là route mới, không phải
  route content) tự có check riêng theo mục 4, không đi qua permission string
  collection/singleton.

Đề xuất 1 helper dùng chung, vd `requirePermission(session, 'collection:blog.updated')`
trả 403 nếu thiếu, gọi ở đầu mỗi nhánh route liên quan trong `authRoutes`/
`genericRoutes` của `api-r2.ts`.

## 6. UI

- **Sidebar System nav**: thêm 2 item vào mảng `systemChildren` trong
  `useNavItems.tsx` (cùng chỗ với `files`/redirects hôm nay) - "User
  management", "Role management", icon riêng cho mỗi item. Chỉ render khi
  `isR2Config(config)` **và** user hiện tại có ít nhất 1 quyền quản trị (mọi
  role trừ Editor-mặc-định-rỗng coi như không thấy 2 mục này).
- **Menu collection/singleton bị ẩn nếu thiếu quyền `view`**: `useNavItems.tsx`
  hôm nay build nav item thẳng từ `config.collections`/`config.singletons`,
  không biết gì về permission. Ở `kind: 'r2'`, mỗi item (`populateItemData`)
  phải lọc thêm: user có `collection:<key>.view` hoặc `singleton:<key>.view`
  (union theo mọi role, SuperAdmin/Admin luôn qua) mới được liệt kê - không
  check thì **không hiện tên menu đó luôn**, không phải chỉ vào xem bị chặn.
  Lưu ý: đây chỉ là UX (đỡ user thấy mục vô dụng) - chốt chặn thật vẫn là
  403 ở server `GET tree`/`blob` (mục 5), vì user có thể gõ thẳng URL
  `/collection/<key>` bỏ qua nav.
- **Nút "Magic write" ẩn nếu thiếu quyền `magicWriter`**: `MagicWriteButton`
  (`app/ai/MagicWriteButton.tsx`, được `ItemPage`/`SingletonPage`/
  `create-item.tsx` render cho từng field) phải nhận biết permission của
  collection/singleton đang mở - thiếu `collection:<key>.magicWriter` /
  `singleton:<key>.magicWriter` thì **không render nút** (không phải hiện
  nút rồi disable), đồng bộ với chặn thật ở server `ai/magic-write` (mục 5).
  Vì `view` là điều kiện tiên quyết của mọi permission khác (mục "không bật
  view thì 3 nút còn lại vô giá trị"), thực ra không cần check riêng `view`
  ở đây - role đã bị lọc `magicWriter` thì cũng đã bị lọc `view` từ lúc cấu
  hình ở trang config permission rồi.
- **Trang user list** (`/system/users` hoặc tương đương): tái dùng
  `CollectionToolbar` + `EntityTableView` (`app/collection-table/`, đã tổng
  quát hoá theo generic `Item` từ commit `d100ac9`) - bảng <100 user load 1
  lần, sort theo cột, cấu hình ẩn/hiện cột lưu IndexedDB (mặc định avatar,
  email, name, active, verify), fuzzy + highlight search **offline** (tái
  dùng đúng pattern Fuse.js đã làm cho collection search). Cột:
  avatar (tròn, fallback icon user) / email / name / phoneNumber / address /
  verify (chip thời gian, null -> nút resend, resend re-issue
  `invite_token` mới + gửi lại email) / active (checkbox) / roles (**nhiều
  chip**, theo quyết định mục 0) / created_at / updated_at (sort mặc định).
  Nút "add user".
- **Trang add user**: bắt buộc email + name, còn lại optional/mặc định. Ghi
  D1 (`password = NULL`), gửi email mời (token 24h) qua Cloudflare Email
  Service. Validate: email trùng -> `emailAlreadyExistsError`. Nếu binding
  email chưa cấu hình (vd `astro dev` local chưa set up Cloudflare Email) -
  **vẫn tạo được user**, hiển thị link invite trực tiếp trong UI (copy
  clipboard) thay vì chặn thao tác - tránh việc dev/preview không gửi được
  mail thì không test được flow.
- **Click vào 1 user trong list** -> hiện đúng thông tin nhưng **toàn bộ
  field disabled** (không cho sửa qua đây), chỉ có nút "Delete" (theo đúng
  bullet gốc "không cho phép chỉnh sửa user khi click vào").
- **Trang profile** (menu trên nút đăng xuất, component tái dùng cho cả
  `/register-first`): avatar (click chọn file trực tiếp từ máy, không qua
  media library dialog - lưu R2 path `_system/avatars/<userId>.<ext>`, giới
  hạn size/type ở client trước khi upload, validate lại ở server -
  `avatarTooLargeError`/`avatarInvalidTypeError`), name, phoneNumber,
  address, rồi tới cụm đổi mật khẩu (old pass / new pass / confirm pass, cả
  3 nullable **cùng lúc** - chỉ required lẫn nhau khi 1 trong 3 field có giá
  trị) + nút "Update pass" riêng. Validate: sai old pass ->
  `invalidCurrentPasswordError`, new/confirm lệch -> `passwordMismatchError`,
  quá ngắn -> `passwordTooShortError`.
- **Trang password-setting**: standalone, không có layout menu, chỉ giữa
  màn hình 2 cột new-password/confirm-password. Dùng cho **2 luồng** dẫn tới
  cùng UI này bằng `invite_token` trên query string: (a) verify link từ email
  mời user mới, (b) link "forget password" từ trang login. Submit thành
  công -> set `password`, set `email_verify_at` nếu đang null (verify lần
  đầu), xoá `invite_token`, chuyển tới `/login`.
- **`/register-first`**: chỉ vào được khi `SELECT COUNT(*) FROM user = 0`
  (đúng logic `needsSetup` hiện có trong `authRoutes`, chỉ đổi nguồn đếm
  sang D1). Tái dùng component profile nhưng **không có old pass**, new +
  confirm pass **required**. Submit -> tạo user + gán role SuperAdmin trong
  D1 (mục 3).
- **Trang login**: giữ nguyên layout hiện có (`drystack-login.astro`), thêm
  link "forget password" thật (hiện route đã vẽ UI nhưng chưa có luồng quên
  mật khẩu) - nhập email -> nếu tồn tại, set `invite_token` 1h + gửi email,
  **luôn trả cùng 1 thông báo "đã gửi nếu email tồn tại"** dù email có tồn
  tại hay không (giữ nguyên nguyên tắc chống dò email đang áp dụng ở
  `badCredentials`).
- **Trang Role list**: role name (dialog đổi tên - khoá cho SuperAdmin/
  Admin), chip số lượng user (dialog thêm/xoá user có search - **ẩn hẳn**
  dialog này cho role SuperAdmin, vì membership cố định 1-lần-duy-nhất ở
  mục 3), chip số lượng permission (mở trang config permission), nút xoá
  (enable khi `user.length = 0`, luôn disabled cho SuperAdmin/Admin bất kể
  số user).
- **Trang config permission**: list block theo từng collection/singleton
  hiện có trong config (`Collection: <name>` / `Singleton: <name>`), mỗi
  row 5 checkbox `view/created/updated/Magic writer/deleted`, tắt `view` thì
  4 checkbox còn lại disabled **nhưng vẫn giữ state đã lưu** (đúng bullet
  gốc). Lưu vào `role.permissions` (JSON string[]) auto-save debounce 1s,
  không có nút Save. **Ẩn/khoá toàn trang** nếu đang xem SuperAdmin/Admin
  (quyền của 2 role này hardcode, không cấu hình qua đây - xem mục 4).

## 7. Email (Cloudflare Email Service)

- Thêm lại binding "Send Email" vào `wrangler.jsonc` (đã gỡ ở `e0a0c68`) +
  verify domain gửi trên dashboard Cloudflare (tham khảo skill
  `cloudflare-email-service` khi triển khai thật).
- 2 template: (1) mời user mới - nút verify trỏ `/password-setting?token=...`,
  hết hạn 24h; (2) quên mật khẩu - cùng trang, token hết hạn 1h. Nội dung
  đẹp/rõ ràng theo yêu cầu gốc, đa ngôn ngữ theo `config.locale` như
  `drystack-login.astro` đang làm.

## 8. Triển khai / cutover thực tế (sau khi code xong)

1. Tạo D1 database (`wrangler d1 create drystack-db`), thêm binding
   `DRYSTACK_DB` vào `wrangler.jsonc` + `.dev.vars`/`.env` nếu cần cho dev.
2. Migration SQL tạo 3 bảng (mục 2), seed sẵn 2 row `role`: `Admin`
   (`is_builtin=1`, permissions rỗng vì hardcode toàn quyền), `Editor`
   (`is_builtin=1`, permissions rỗng). **Không** seed sẵn SuperAdmin - role
   này tồn tại như 1 hàng `role` bình thường nhưng chỉ được gán user lần đầu
   qua `/register-first`.
3. Deploy code (auth flow đổi sang D1, permission enforcement, UI mới).
4. Trên production: `auth/native/thanhkhan2k@gmail.com.yaml` cũ không còn
   được `api-r2.ts` đọc tới nữa (route login giờ query D1) - vào lại
   `/register-first` (D1 đang rỗng ngay sau deploy) để tạo lại chính tài
   khoản `thanhkhan2k@gmail.com` làm SuperAdmin thật trong D1.
5. Dọn `auth/native/*.yaml` + `auth/revoked/*` cũ trong R2 bucket (không còn
   ai đọc, nhưng không xoá vội trước bước 4 để có đường lùi nếu deploy có
   vấn đề).
6. Viết lại `scripts/drystack-auth.ts` trỏ D1 (mục 3) trước hoặc cùng lúc
   bước 1-3, vì đây là công cụ khẩn cấp duy nhất nếu UI/role bị cấu hình sai
   khoá luôn chính mình ra ngoài.

## 9. UI helper

- password input có nút "eye" dùng **zustand** để đồng bộ hiện/ẩn giữa mọi
  input password khác nhau trên cùng 1 trang (profile có 2 field cùng lúc,
  register-first cũng vậy) - store toàn cục 1 flag `visible: boolean`, không
  cần scope theo field.

## 10. Việc còn để ngỏ / giả định cần bạn xác nhận nếu sai

- Avatar phục vụ qua route blob public sẵn có (vì "reads stay public" theo
  `plan/auth.md`), chỉ cần path nằm ngoài `auth/` - đề xuất `_system/` làm
  prefix dành riêng, chưa dùng ở đâu khác trong repo.
- Editor role cho phép xoá/đổi tên khi 0 user (coi như role thường, không
  đặc biệt hoá) - nếu ý bạn là Editor cũng bất-khả-xâm-phạm như
  SuperAdmin/Admin thì cần đổi `is_builtin` thành 1 cờ khoá riêng.
- `invite_token`/`forgot-password` dùng chung 1 cặp cột trên bảng `user`
  (không tách bảng `verify_token` riêng) - đơn giản hơn ở quy mô <100 user,
  đánh đổi là user không thể có đồng thời 1 lời mời "chưa verify" **và** 1
  yêu cầu "quên mật khẩu" cùng lúc (token sau ghi đè token trước) - hợp lý
  vì user chưa verify thì chưa có mật khẩu để mà quên.

**Đây là tài liệu ngắn gọn**: nếu có bất kì vấn đề gì về thiết kế hãy hỏi tôi bằng tiếng việt để tôi quyết định nhé
