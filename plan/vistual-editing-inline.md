# Vistual editing inline

# lưu ý tận dụng UI component có sẵn

- lấy các component, dialog từ trang admin
- tận dụng các chức năng đang có hạn chế viết thêm
- tận dụng các tính năng sẵn có trên admin tương ứng field
- lưu dữ liệu được trên cả 2 moi trường local, github

# field.text

- đang hoạt động tốt

# field.image

- khi click vào mở dialog chọn file giống cơ chế dialog chọn file ở admin

---

## Kế hoạch chi tiết — VEI cho `fields.image`

### 0. Bối cảnh đã khảo sát

| Thành phần | Vị trí | Điều quan trọng |
| --- | --- | --- |
| `fields.image` | `packages/drystack/src/form/fields/image/index.tsx` | Giá trị là **string path** (vd `/assets/a.png`), `null` khi trống. Schema tag: `kind: 'form'`, `columnKind: 'image'` (khác `fields.text` là `formKind: 'slug'`). |
| Input ở admin | `.../image/ui.tsx` | Chỉ gọi `openMediaLibrary({accept:'image', local})` rồi `onChange(picked.path)`. Không tự upload. |
| Dialog media | `app/file-manager/FileManagerHost.tsx` → `FileManagerDialog.tsx` → `FileManagerRoot.tsx` | Host đăng ký `registerMediaLibraryOpener/Uploader/BytesResolver` (bridge.ts). File được **ghi xuống disk/GitHub ngay lúc pick/upload** (`useMediaLibraryUpload`), không đợi Save. |
| Context mà `FileManagerRoot` cần | | `useConfig`, `useRouter().basePath`, `useTree`, `useBaseCommit`, `useRepoInfo`, `useSetTreeSha` — **không dùng `router.params`**, không cần sidebar/branch UI. |
| Store edit hiện tại | `packages/drystack/src/app/edit-sync.ts` | IndexedDB `drystack-edits`: store `edits` (key → **string**), `meta`, `source`. Value là string ⇒ path ảnh nhét thẳng vào được, không cần đổi schema store. |
| Ghi file khi Save | `packages/astro/src/editor/save.ts` | Chỉ ghi YAML (`data[field] = value`), không upload bytes ⇒ với ảnh **không cần đụng tới upload**, media library đã ghi file rồi. |

**Ý tưởng chủ đạo:** không viết picker mới. Mount một **"headless admin shell"** tối thiểu (lazy-load) trong cây React của VEI trên trang public, rồi dùng lại chính `FileManagerHost` + `openMediaLibrary()` của admin.

### 1. Nhận diện field trên server (`packages/astro/src/dry.ts`)

- Hàm `item()` hiện chỉ chấp nhận `formKind === 'slug'` (text), field khác thì `console.warn` + bỏ qua.
- Thêm nhận diện image: `kind === 'form' && columnKind === 'image'`.
- Trả về thêm attribute kind để client biết cách xử lý:
  - text → `{ 'data-dry': key, 'data-dry-kind': 'text' }`
  - image → `{ 'data-dry': key, 'data-dry-kind': 'image' }`
- **Dùng chung detector với admin:** `packages/drystack/src/app/edit-sync.ts` đang có `isSyncableTextField()`. Đổi/bổ sung thành `getSyncableFieldKind(schema): 'text' | 'image' | undefined` để `dry.ts` + `SingletonPage.tsx` cùng gọi — tránh 2 nơi tự đoán schema mỗi nơi một kiểu.
- Cập nhật type `DryItem` = `{ 'data-dry': string; 'data-dry-kind': 'text' | 'image' }`.

**Ràng buộc cho component:** element mang `data-dry` phải là `<img>` (Astro `<Image src={dry.image} …>` spread attrs xuống `<img>` — đúng như `src/components/Demo.astro` đang làm). Không hỗ trợ `background-image` ở MVP này.

### 2. Client binding (`packages/astro/src/editor/bind.ts`)

Cả file đang giả định "value = `el.textContent`". Tách nhánh theo kind:

1. `enableEditing()`
   - text: giữ nguyên `contentEditable`.
   - image: **không** contentEditable. Thêm class `dry-image-spot` (outline khi hover + `cursor:pointer` + overlay icon, khai báo trong `editor.css`) và bắt `click` → gọi callback `onImageClick(key)` do Toolbar đăng ký.
2. Baseline (`originalValues`)
   - text: `el.textContent`.
   - image: `el.getAttribute('src')` — dùng attribute, **không** dùng `el.src` (bị absolutize thành URL tuyệt đối).
3. `applyEdit(key, value)` — tách `paintText()` / `paintImage()`:
   - `paintImage`: có bytes trong blob-cache (mục 3) → `URL.createObjectURL` rồi set `src`; không có → set `src = value`. Luôn `el.removeAttribute('srcset')` (Astro có thể sinh srcset), giữ nguyên `width`/`height`.
   - Value `''` (đã xoá ảnh) → ẩn element (chốt cách ẩn lúc implement).
   - Thu hồi objectURL cũ khi paint đè / reset / clear.
4. `resetPendingEdits()` và `ReviewDialog.handleDelete` → khôi phục `src` baseline cho ảnh.
5. `refreshFromLatestSource()` / `applyCachedSource()`: `getLatestFieldValues()` vốn đã trả **mọi field string** nên path ảnh có sẵn; chỉ cần repaint theo `data-dry-kind` của element.

### 3. Preview ảnh vừa upload (điểm khó nhất)

Ảnh mới upload **chưa được site serve**: local dev thì Vite serve `/assets/**` ngay, nhưng github mode file chỉ có URL sau khi Cloudflare build lại (xem hook `astro:build:done` mirror trong `packages/astro/src/index.ts`). ⇒ Không thể chỉ set `src = path`.

- Thêm object store `blobs` vào IndexedDB `drystack-edits` (bump version 3 → 4 trong `edit-sync.ts`): key = path, value = `Uint8Array` — lấy từ `MediaLibraryPick.content` (đúng khuyến nghị trong CLAUDE.md § Media library).
- API mới trong `edit-sync.ts`: `putPendingBlob(path, bytes)`, `getPendingBlob(path)`, `clearPendingBlobs()`.
- `paintImage` ưu tiên blob-cache → fallback path thật.
- Dọn cache: **không** xoá trong `publishClear()` (github mode vẫn cần blob cho tới khi deploy xong). Xoá ở `discardEditsIfBuildIsNewer()` khi thấy `buildVersion` mới (cùng chỗ đã `clearSourceCache()`), và xoá ngay sau Save ở local mode (file đã serve được).
- Nhờ vậy: reload trang giữa lúc chưa deploy vẫn thấy ảnh mới — không cần network, không cần auth.

### 4. Mount media library của admin trong VEI

File mới: `packages/drystack/src/app/media-library/VeiMediaHost.tsx`

```tsx
// Provider stack tối thiểu để FileManagerHost chạy được ngoài admin app.
<ConfigContext.Provider value={config}>
  <AppStateContext.Provider value={{ basePath }}>
    <RouterProvider basePath={basePath}>                        // app/router.tsx — chỉ cần window.location
      <UrqlProvider value={createUrqlClient(config, basePath)}> // app/provider.tsx (đã export sẵn)
        {local  && <LocalAppShellProvider config={config}>…</LocalAppShellProvider>}
        {github && <GitHubAppShellDataProvider config={config}>
                     <GitHubAppShellProvider currentBranch={defaultBranch} config={config}>…</GitHubAppShellProvider>
                   </GitHubAppShellDataProvider>}
        <FileManagerHost />
      </UrqlProvider>
    </RouterProvider>
  </AppStateContext.Provider>
</ConfigContext.Provider>
```

- Vì sao cần `UrqlProvider` cả ở local mode: `useMediaLibraryUpload` gọi `useCommitFileChanges()` vô điều kiện → `useMutation()` → cần urql client. `createUrqlClient` đã xử lý local (`url: 'about:blank'`).
- `AppSlugContext` mặc định `undefined` ⇒ `useCommitFileChanges` an toàn, không cần provider.
- `SetTreeShaContext` chỉ do `LocalAppShellProvider` cấp; github mode không gọi tới (đã có comment sẵn trong `FileManagerRoot` / `useTrash` / `useFileManagerUpload`).
- `currentBranch` (github) = default branch, lấy qua `getCurrentBranchName(config)` trong `editor/save.ts` — đúng nhánh mà VEI Save cũng commit vào.
- Export subpath mới trong `packages/drystack/package.json`:
  `"./media-host": { "drystack-src": "./src/app/media-library/VeiMediaHost.tsx", "default": "./dist/app/media-library/VeiMediaHost.js" }` (+ subpath cho `media-library/bridge.ts` nếu chưa có).
- Trong `packages/astro/src/editor/index.tsx`: `const VeiMediaHost = React.lazy(() => import('@drystack/core/media-host'))`, chỉ render khi **lần đầu bật edit mode** — giữ bundle trang public nhẹ (stack này kéo theo urql + graphcache + file-manager).

### 5. Luồng click ảnh (Toolbar / bind)

1. Click `<img data-dry-kind="image">` trong edit mode → đảm bảo `VeiMediaHost` đã mount (chưa thì mount và chờ opener đăng ký xong).
2. Gọi đúng như `ImageFieldInput` ở admin (được cả tab library lẫn tab "trang này"):
   ```ts
   openMediaLibrary({
     accept: 'image',
     local: { directory: `${getSingletonPath(config, name)}/assets`, label: 'Trang này' },
   })
   ```
3. Có `pick`:
   - `putPendingBlob(pick.path, pick.content)`
   - `publishEdit(key, pick.path)` (broadcast sang tab admin)
   - `paintImage(key, pick.path)` — hiện ảnh ngay từ bytes.
4. Xoá ảnh: nút "Remove" (ý tưởng lấy từ `ImageFieldInput`) — đặt trong overlay khi hover ảnh ở edit mode, hoặc trong Review dialog → `publishEdit(key, '')` (quy ước `''` = `null`).
5. **Gate github mode:** nếu `storage.kind === 'github'` mà không có cookie `drystack-gh-access-token` (`getGithubToken()` trong `save.ts`) → toast "Cần đăng nhập admin để đổi ảnh" và **không mount** `VeiMediaHost`. Bắt buộc: `GitHubAppShellProvider` có effect `window.location.href = /api/…/github/login` khi lỗi 401 — chạy trên trang public sẽ đá visitor đi mất.

### 6. Ghi file khi Save (`packages/astro/src/editor/save.ts`)

- `collectFileDiffs()`: đọc kind từ config schema thay vì mặc định string:
  - image + value `''` → `delete data[field]` (không ghi `image: ''` vào YAML — khớp `serialize()` trả `undefined` khi `null`).
  - còn lại → `data[field] = value`.
- `validateEdits()`: với image, map `'' → null` trước khi gọi `schema.validate` để `isRequired` báo lỗi đúng.
- **Không thêm addition bytes nào** — ảnh đã được `useMediaLibraryUpload` ghi/commit từ lúc pick. Save chỉ ghi YAML. Đúng cả 2 mode vì upload path đã tự phân nhánh local/github sẵn.

### 7. Review dialog (`packages/astro/src/editor/Toolbar.tsx`)

- `FieldChange` thêm `kind`. Image: thay diff dòng-text bằng 2 thumbnail **trước → sau** (blob-cache hoặc path), kèm path dạng mono nhỏ. Diff LCS giữ nguyên cho text.
- Badge/pending count, nút Reset/Save không đổi.

### 8. Đồng bộ 2 chiều với admin (`SingletonPage.tsx`) — Phase 2, rẻ

- Thay `isSyncableTextField` bằng `getSyncableFieldKind` ở cả 3 effect (catch-up on mount, publish debounce 200ms, subscribe) + effect `publishDelete` sau khi save.
- Image: state là `string | null` → publish `value ?? ''`; nhận về thì `msg.value === '' ? null : msg.value`.
- Kết quả: đổi ảnh ở admin → tab live site đổi theo, và ngược lại.

### 9. Thứ tự thực hiện

1. `edit-sync.ts`: `getSyncableFieldKind` + store `blobs` (+3 API) — nền tảng dùng chung.
2. `dry.ts`: nhận `fields.image`, phát `data-dry-kind`.
3. `bind.ts` + `editor.css`: baseline/paint/reset theo kind, hover + click ảnh.
4. `VeiMediaHost.tsx` + export map + lazy mount trong `editor/index.tsx`; nối click → `openMediaLibrary`.
5. `save.ts`: ghi/validate value ảnh (kể cả xoá).
6. `Toolbar.tsx`: review dialog thumbnail + nút xoá ảnh.
7. `SingletonPage.tsx`: sync 2 chiều cho image.

### 10. Kiểm thử — **bắt buộc cả 2 storage mode** (standing rule của repo)

Trang thử: `/demo` (`src/components/Demo.astro`, singleton `demo` đã có `image: fields.image(...)`).

**local (`astro dev --background`)**
- Bật edit → hover ảnh thấy outline → click mở dialog file manager.
- Chọn ảnh có sẵn trong library / upload ảnh mới / chọn từ tab "trang này".
- Ảnh đổi ngay trên trang; badge +1; Review thấy thumbnail trước/sau.
- Reload khi chưa Save → ảnh mới vẫn hiện (blob cache).
- Save → file YAML của singleton `demo` có `image: /assets/…`, file ảnh nằm trong `assets/` (hoặc `<entryDir>/assets/`); reload sạch → ảnh load từ path thật.
- Reset → trở về ảnh gốc.

**github**
- Đăng nhập admin trước (có cookie token) rồi mở live site.
- Lặp lại flow trên: xác nhận có commit `Upload <file>` (lúc pick) và commit `Update content via visual editor` (lúc Save).
- Trước khi Cloudflare deploy xong: reload vẫn thấy ảnh mới nhờ blob cache; sau khi `buildVersion` mới về → cache bị xoá, ảnh load từ URL thật.
- Chưa đăng nhập → click ảnh chỉ hiện toast, không bị redirect.

### 11. Rủi ro / điểm cần chốt

1. **Bundle trang public**: stack picker kéo urql + graphcache + file-manager (khá lớn). Bắt buộc `React.lazy` + chỉ mount khi vào edit mode; đo lại size chunk sau khi làm.
2. **Astro `<Image>`**: chỉ đúng khi `src` là string path. Dùng ESM import ảnh thì `dry.item()` không áp dụng — ghi rõ giới hạn trong comment/doc.
3. **401 redirect của `GitHubAppShellProvider`** trên trang public (mục 5) — nếu gate bằng token vẫn chưa đủ an toàn, cân nhắc thêm prop `disableAuthRedirect` cho provider.
4. **Branch protection**: upload từ live site commit thẳng vào default branch. Nếu branch bị protect → lỗi; cần toast rõ ràng (giống thông điệp đã có sẵn trong `save.ts`).
5. **Dialog file manager có cả trash/xoá**: người dùng đã đăng nhập admin nên chấp nhận được, nhưng cân nhắc có nên ẩn bớt action trong picker mode ở live site không.

### 12. Ngoài phạm vi (deferred)

- `fields.image` **lồng trong object/array** (vd `seo.ogImage`) — cùng giới hạn hiện tại của `dry()` (chỉ flat top-level).
- Collection entries (hiện mới chỉ có singleton).
- `fields.images` (multi), `fields.file`.
- Kéo-thả ảnh trực tiếp lên `<img>` để upload (bridge đã có sẵn `uploadToMediaLibrary` nếu sau này muốn).
