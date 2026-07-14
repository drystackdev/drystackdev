# Kế hoạch: Nâng VEI dùng full provider admin (ConfigContext/RouterProvider…) cho image & file

## Context (Vì sao)

VEI (Visual Editing Inline — cây React inject trên live site, `packages/astro/src/editor/`)
hiện chỉ bọc `KeystarProvider` + `Toaster` (`EditorRoot.tsx:67-77`). Vì thiếu
`ConfigContext`, `RouterProvider`, urql và shell-data providers, VEI **không thể** mount
`ImageFieldInput`/`FileFieldInput` thật của admin (chúng gọi `useConfig`/`useRouter` sẽ crash,
và `useMediaLibraryPreviewURL` cần tree/urql). Hệ quả: VEI phải dùng loạt code swap tự chế
(`withVeiObjectImageInputs`, `makeVeiObjectImageInput`, `ImageArrayEditor`, `VeiObjectImageInput`)
và **chưa có `fields.file`** (`getSyncableFieldKind` chỉ nhận text/image/array).

Mục tiêu: bọc phần editing surface của VEI trong **đúng stack provider admin** để render trực
tiếp field editor thật của admin — trước hết cho **image + file** — bỏ hầu hết code swap, và
bổ sung `fields.file`. Provider stack nạp **lazy khi bật chế độ sửa** để live site vẫn nhẹ.

Đã có sẵn nền tảng: `VeiMediaHost` (`packages/drystack/src/app/media-library/VeiMediaHost.tsx`)
đã đóng gói đúng stack `ConfigContext → AppStateContext → RouterProvider → UrqlProvider →
ShellProviders`, nhưng chỉ bọc quanh `FileManagerHost`, **không** bọc field editor. Kế hoạch
là tổng quát hóa stack này và bọc luôn dialog field của VEI.

**Ràng buộc bắt buộc (CLAUDE.md):** mọi thay đổi write path phải chạy được cả
`storage.kind === 'local'` **và** `'github'`. `ShellProviders` đã rẽ nhánh sẵn — phải test cả hai.

## Nguyên tắc chốt (từ khảo sát)

- **KHÔNG** tái dùng admin `Provider` mặc định (`provider.tsx:167`): nó
  `injectGlobal({ body: { overflow:'hidden' } })`, `bodyBackground="surface"`, chèn Google Fonts,
  `<meta viewport>` — sẽ phá layout live site. Theo stack "nhẹ" của `VeiMediaHost`.
- `RouterProvider` (`app/router.tsx:22-80`) **an toàn** khi mount trên live site: chỉ đọc
  `window.location.href` vào state + gắn listener `popstate`, không đổi URL trừ khi ta gọi
  `push/replace`. VEI không điều hướng nên vô hại.
- `image`/`file` field có `parse`/`serialize`/`reader`/`validate` thuần (chỉ là string path,
  `form/fields/image/index.tsx:42-55`, `file/index.tsx`) — **không phụ thuộc provider**. Chỉ
  component `.Input` mới cần context. Nên save/serialize hầu như dùng lại được nguyên.
- Fresh-upload preview: admin `ImageFieldInput` tự giữ bytes vừa chọn (`freshUpload` +
  `MediaLibraryPick.content`) nên preview-trước-khi-deploy đã có sẵn — pending-blob tự chế của
  VEI chỉ còn cần cho **inline spot** (bind.ts), không cần trong dialog.
- **KHÔNG dùng Shadow Root** (giữ nguyên quyết định hiện có ở `editor.css:3-5`). Lý do: (a)
  `@keystar/ui` chèn CSS qua emotion vào `document.head` và portal dialog/overlay/toast ra
  `document.body` → UI sẽ thoát khỏi shadow root và vỡ style; (b) react-aria tham chiếu
  aria/id + focus-trap ở cấp `document`, ranh giới shadow phá vỡ → hỏng a11y của chính dialog
  image/file; (c) affordance inline (`body.editing [data-dry]`, `[data-dry-kind="image"]`) tô
  lên element nội dung ở light DOM, shadow root không với tới. Cô lập giữ bằng namespace `dry-`
  + emotion hash; nếu gặp bleed cụ thể thì thêm reset **scoped `#drystack-editor-root`** (và
  `UNSAFE_className` cho dialog portal-to-body), không dựng shadow boundary.

## Cách làm (theo bước)

### Bước 1 — Tách `VeiAdminProviders` dùng chung
Trong `packages/drystack/src/app/media-library/VeiMediaHost.tsx`, tách phần provider stack
(dòng 62-73) thành component `VeiAdminProviders({ config, basePath, currentBranch, children })`
gói `ConfigContext → AppStateContext → RouterProvider → UrqlProvider → ShellProviders`
(giữ nguyên `createUrqlClient` từ `provider.tsx`, `ShellProviders` rẽ local/github).
`VeiMediaHost` trở thành `<VeiAdminProviders …><FileManagerHost/></VeiAdminProviders>`.
Export `VeiAdminProviders` qua subpath `@drystack/core` mà astro editor đang dùng (cùng chỗ
đang export `VeiMediaHost`/`field-editor`).

### Bước 2 — Boundary provider của VEI, mount khi bật sửa
Trong `packages/astro/src/editor/Toolbar.tsx`:
- Thay cơ chế `mediaHostMounted` + lazy `VeiMediaHost` (dòng ~285-319, 683-691) bằng **một**
  boundary `<VeiAdminProviders basePath currentBranch>` mount khi `editing === true`.
- Resolve trước khi mount: `basePath` từ `virtual:drystack-path`; github mode resolve
  `currentBranch` qua `getCurrentBranchName(config)` (đã có trong `save.ts`); có trạng thái
  loading. Local mode mount ngay (currentBranch bị bỏ qua). Giữ guard "cần cookie admin cho
  github" hiện có (`getGithubToken()` + toast).
- Bên trong boundary luôn mount `<FileManagerHost/>` → `openMediaLibrary` sẵn sàng cho cả
  inline spot lẫn dialog, bỏ hẳn `ensureMediaHostMounted`/`waitForMediaLibraryOpener` race.
- Toolbar chrome (nút bấm, deploy menu) **giữ ngoài** boundary (dưới KeystarProvider gốc) để
  không bị chặn chờ tree/currentBranch; dialog field render **trong** boundary. Nối yêu cầu
  mở dialog qua state chung nhẹ (`editor/store.ts`) hoặc opener đã đăng ký — theo đúng mẫu
  media bridge hiện có, tránh prop-drilling.

### Bước 3 — Render field editor admin thật, bỏ code swap
Trong `Toolbar.tsx` gear/array dialog (hiện `ArrayFieldDialog` 751-881, `ImageArrayEditor`
895-943, `withVeiObjectImageInputs`/`makeVeiObjectImageInput` 950-1007):
- Vì đã có full provider, render thẳng `FormValueContentFromPreviewProps` /
  `ArrayFieldListView` (`@drystack/core/field-editor`) cho **mọi** element schema, gồm image
  và file — dùng đúng `ImageFieldInput`/`FileFieldInput` của admin, preview qua
  `useMediaLibraryPreviewURL` từ tree thật.
- **Xóa** `withVeiObjectImageInputs`, `makeVeiObjectImageInput`, `VeiObjectImageInput`,
  `ImageArrayEditor`. `VeiImageThumb`/pending-blob giữ lại **chỉ** cho inline spot.
- Không đụng config schema (parse/serialize/validate nguyên vẹn — nguyên tắc hiện có).

### Bước 4 — Thêm `fields.file`
- `packages/astro/src/dry.ts` (~94-153): nhận thêm kind `file`, emit `data-dry-kind="file"`
  trên phần tử render file (mirror nhánh `image`).
- `packages/drystack/src/app/edit-sync.ts` `getSyncableFieldKind` (235-244): thêm `'file'`.
- `packages/astro/src/editor/bind.ts`: thêm binding/click cho file spot song song
  `handleImageSpotClick` (287-293) — click mở `openMediaLibrary({ accept:'any' })`.
- `packages/astro/src/editor/Toolbar.tsx`: handler file spot (giống `pickAssetImage`→
  `pickAssetFile`, accept any) → `publishEdit`/`applyEdit`. File sub-field trong dialog đã tự
  chạy nhờ Bước 3.
- `save.ts`: value file = string path, `collectFileDiffs`/`mergeFieldEdits` vốn kind-agnostic —
  chỉ cần `getSyncableFieldKind` cho qua; verify không có nhánh chặn image-only.

### Bước 5 — Parity & dọn dẹp
- Rà `isLocalConfig`/`isGitHubConfig` liên quan: `ShellProviders` (VeiMediaHost),
  `useMediaLibraryUpload`, `fetchBlob`. Đảm bảo file đi qua cả hai path.
- Xóa import chết sau khi bỏ code swap; cập nhật comment ở `Toolbar.tsx:729-801` phản ánh
  kiến trúc mới (đã có full provider, không còn "reaches into admin-only context we never mount").

## File chính sẽ sửa
- `packages/drystack/src/app/media-library/VeiMediaHost.tsx` — tách `VeiAdminProviders` (+ export).
- `packages/astro/src/editor/Toolbar.tsx` — boundary provider khi editing, render field admin
  thật, xóa code swap, handler file spot.
- `packages/astro/src/editor/bind.ts` — binding/paint cho file spot; giữ pending-blob cho inline.
- `packages/astro/src/dry.ts` — emit `data-dry-kind="file"`.
- `packages/drystack/src/app/edit-sync.ts` — `getSyncableFieldKind` thêm `'file'`.
- (Kiểm tra, có thể không đổi) `packages/astro/src/editor/save.ts`.

## Tái sử dụng có sẵn (không viết mới)
- `createUrqlClient` (`app/provider.tsx:26`), `RouterProvider` (`app/router.tsx`),
  `ConfigContext`/`AppStateContext` (`app/shell/context.tsx`),
  `GitHubAppShellDataProvider`/`GitHubAppShellProvider`/`LocalAppShellProvider` (`app/shell/data.tsx`).
- `FormValueContentFromPreviewProps`, `createGetPreviewProps`, `ArrayFieldListView`,
  `clientSideValidateProp`, `valueToUpdater` (`app/field-editor.tsx`).
- `openMediaLibrary` bridge + `FileManagerHost` + `useMediaLibraryPreviewURL` +
  `useMediaLibraryUpload` (`app/media-library/`, `file-manager/`).
- `getCurrentBranchName`, `getGithubToken`, `publishEdit`/`applyEdit`, pending-blob helpers
  (`editor/save.ts`, `editor/bind.ts`, `editor/store.ts`).

## Kiểm thử (end-to-end, cả 2 storage)
Nhớ: sau khi sửa src của `@drystack/core`/`@drystack/astro` phải **rebuild** trước khi
`astro dev --background`, nếu không dev server phục vụ dist cũ (đã ghi trong memory).

1. **Local** (`storage.kind:'local'`): mở trang có singleton chứa `fields.image`, `fields.file`,
   và một `fields.array` of object có image+file. Bật chế độ sửa:
   - Sửa image (Choose from library **và** Upload mới) → preview đúng ngay (fresh-upload),
     Save → kiểm YAML ghi đúng path + file vào `assets/`.
   - Sửa file tương tự (accept any) → path ghi đúng, nút Download hoạt động.
   - Sửa field trong gear dialog (image/file sub-field) render đúng UI admin, không còn swap.
2. **GitHub** (`storage.kind:'github'`, có cookie `drystack-gh-access-token`): lặp lại; xác nhận
   commit qua `createCommitOnBranch` và preview qua authenticated blob fetch; không có cookie →
   toast "cần đăng nhập admin" (giữ hành vi cũ).
3. Regression: inline text spot + array-of-text vẫn chạy; live site (khách chưa bật sửa) không
   tải git tree, không bị khóa scroll/đổi nền/chèn font.
