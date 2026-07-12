# Kế hoạch: Binding / đồng bộ dữ liệu edit (cross-tab + admin ↔ visual editor)

## 1. Mục tiêu (giữ nguyên ý gốc)

- **Trang admin** (`drystack/branch/main/singleton/home`):
  - Khi edit 1 field → ghi vào IndexedDB **và** phát event ra toàn bộ tab của trình duyệt.
  - Khi ô input **không focus** → lắng nghe; nếu IndexedDB có thay đổi (từ tab khác / visual editor) thì cập nhật lại giá trị input.
- **Trang visual editing** (site đã build):
  - Khi đã đăng nhập (github) hoặc chạy dev (local) → lấy yaml/HTML mới nhất để apply lên trang.
  - Quan sát IndexedDB → có dữ liệu pending thì apply lên trang (kể cả **live**, không chỉ lúc load).
  - Khi chỉnh sửa → phát event ra toàn bộ tab.
- **Yêu cầu xuyên suốt**: chạy tốt cả **production (github)** lẫn **dev (local)**; **tái sử dụng** hàm sẵn có, viết hàm **dùng chung cho cả 2 chế độ**.

## 2. Hiện trạng (đã khảo sát trong codebase)

| | Admin (`@drystack/core`) | Visual editor (`@drystack/astro`) |
|---|---|---|
| Nơi lưu | IndexedDB DB `drystack`, store `items` (qua `idb-keyval`) | IndexedDB DB `drystack-edits`, store `edits` + `meta` |
| Đơn vị dữ liệu | **Full entry** đã serialize: `Map<path, Uint8Array>` | **Per-field**: key `singleton::name::field` → `{ value: string, updatedAt }` |
| Key | tuple `['singleton', name]` / `['collection', name, slug]` | string `type::name::field` |
| File | [persistence.tsx](../packages/drystack/src/app/persistence.tsx), gọi trong [SingletonPage.tsx](../packages/drystack/src/app/SingletonPage.tsx#L401), [ItemPage.tsx](../packages/drystack/src/app/ItemPage.tsx#L459), [create-item.tsx](../packages/drystack/src/app/create-item.tsx#L264) | [store.ts](../packages/astro/src/editor/store.ts), [bind.ts](../packages/astro/src/editor/bind.ts), [save.ts](../packages/astro/src/editor/save.ts) |
| Apply lúc load | `getDraft` → khôi phục form + toast (`showDraftRestoredToast`) | `applyPendingEdits()` sơn edit lên `[data-dry]` |
| Apply live | ❌ chưa có | ❌ chưa có (chỉ chạy lúc mount) |
| Broadcast cross-tab | ❌ chưa có | ❌ chưa có |
| Save | `useUpsertItem` (local `/update` + github `useCommitFileChanges`) | `saveEdits()` (local `/update` + github `createCommitOnBranch`), có xử lý `STALE_DATA`, branch protection |

**Khoảng trống cần lấp**: (a) hai store không nói chuyện với nhau; (b) không có kênh broadcast giữa các tab; (c) chưa apply theo thời gian thực.

## 3. Kiến trúc đề xuất

### 3.1. Đơn vị dữ liệu chung = per-field edit

Lấy mô hình per-field của visual editor làm **chuẩn chung** (đúng scope MVP 1: singleton + `fields.text`). Một thay đổi = `{ key, value, updatedAt, origin }` với `key = "singleton::<name>::<field>"`.

- Admin vẫn giữ store `items` cho draft **full entry** (khôi phục lúc load, contentField, field không phải text) — **không phá** hệ draft đã chín.
- Chỉ **bắc cầu** các `fields.text` vào/ra kênh chung. Đây là cách ít xâm lấn nhất và tôn trọng "reuse + share cho cả 2 mode".

### 3.2. Module dùng chung: `@drystack/core/edit-sync`

Tạo module mới trong `@drystack/core` (vì cả admin lẫn `@drystack/astro` đều import được `@drystack/core/*` — xem `exports` trong `packages/drystack/package.json`). **Chuyển** logic per-field từ `packages/astro/src/editor/store.ts` sang đây để dùng chung, rồi cho `store.ts` re-export lại (giữ import cũ của astro không vỡ).

Thành phần:

- **Nguồn sự thật (persist)**: IndexedDB `drystack-edits` / store `edits` + `meta` — tái dùng nguyên `store.ts` hiện tại (`getAllEdits`, `setEdit`, `deleteEdit(s)`, `clearEdits`, `getMeta`, `setMeta`).
- **Kênh fan-out**: `BroadcastChannel('drystack-edits')`. Mỗi lần ghi → `postMessage({ type: 'set'|'delete'|'clear', key?, value?, origin })`.
- **Chống echo**: mỗi tab có `origin` (uuid/random). Bỏ qua message do chính mình phát.
- **API đề xuất**:
  ```ts
  editKey(type, name, field): string          // "singleton::home::heading"
  parseEditKey(key): { type, name, field }
  publishEdit(key, value): Promise<void>       // setEdit + broadcast('set')
  publishDelete(key) / publishClear()          // deleteEdit/clearEdits + broadcast
  subscribeEdits(cb: (msg) => void): () => void // BroadcastChannel + fallback
  ```
- **Fallback khi không có BroadcastChannel**: dùng `storage` event qua `localStorage` (ghi 1 key "ping" để đánh thức tab khác đọc lại IndexedDB). Giữ tương thích Safari cũ.

> Lưu ý: `origin`, `updatedAt` giúp giải quyết xung đột theo *last-write-wins* — đủ cho MVP.

## 4. Luồng trang admin

### 4.1. Publish khi edit (mọi field.text)

- Điểm móc: hiện `SingletonPage` đã có `useEffect` serialize → `setDraft` khi `hasChanged` ([SingletonPage.tsx:384](../packages/drystack/src/app/SingletonPage.tsx#L384)). Thêm một effect (hoặc mở rộng effect này) để **duyệt các field.text trong `state`**, so với giá trị trước đó, và `publishEdit(editKey('singleton', name, field), value)` cho field nào đổi.
- Nhận diện field.text: đối chiếu `schema[field].kind === 'form' && formKind === 'slug'` — đúng cách `dry.ts` nhận diện (xem `packages/astro/src/dry.ts`, hàm `item()`), tách thành helper dùng chung để admin và astro cùng gọi.
- Làm tương tự cho singleton trước (đúng scope MVP 1); `ItemPage`/collection để phase sau.

### 4.2. Subscribe + focus guard

- `subscribeEdits` trong component form; khi nhận `set` cho `singleton::<đang mở>::<field>`:
  - **Nếu field đang focus** → bỏ qua (không đè cái user đang gõ) — đúng ý "khi không focus thì mới cập nhật".
  - Nếu không → `onPreviewPropsChange(s => ({ ...s, [field]: value }))` ([SingletonPage.tsx:417](../packages/drystack/src/app/SingletonPage.tsx#L417)) để set lại giá trị field trên form.
- Bỏ qua message có `origin` trùng tab hiện tại (đã chặn ở tầng `subscribeEdits`).

## 5. Luồng trang visual editing

### 5.1. Live apply (điểm mới quan trọng)

- Tách logic "sơn 1 edit lên DOM" trong `applyPendingEdits` ([bind.ts:156](../packages/astro/src/editor/bind.ts#L156)) thành `applyEdit(key, value)` (đã lo `querySelectorAll` nhiều element cùng key + `rememberOriginal`).
- Mount editor (`index.tsx`): sau `applyPendingEdits()`, gọi `subscribeEdits(msg => { if set → applyEdit; if delete/clear → khôi phục original })`. Nhờ đó edit từ admin/tab khác hiện **live** trên trang.
- Giữ nguyên `refreshFromLatestSource` (lấy yaml mới nhất khi vào edit mode) và `discardEditsIfBuildIsNewer` (drift theo deploy github).

### 5.2. Broadcast khi edit

- `handleInput` ([bind.ts:31](../packages/astro/src/editor/bind.ts#L31)) đang gọi `setEdit`; đổi sang `publishEdit` để vừa persist vừa fan-out.

## 6. Vòng đời Save / clear / deploy (cả local & github)

- **Kênh trong suốt với storage**: bus chỉ là IndexedDB + BroadcastChannel phía client → **giống hệt nhau ở local và github**. Đường *save* thì mỗi bên đã tự rẽ theo `storage.kind` (visual: `saveEdits`; admin: `useUpsertItem`/`useCommitFileChanges`) → tái dùng, không viết mới.
- Khi **Save thành công** (một trong hai surface):
  - `publishClear()` (hoặc `publishDelete` cho đúng key vừa lưu) để tab khác bỏ pending đã cũ.
  - Các tab nhận `clear`/`delete` → khôi phục baseline và (visual editor) có thể `refreshFromLatestSource` để lấy giá trị vừa ghi.
- **Github deploy drift**: `discardEditsIfBuildIsNewer` khi phát hiện build mới → sau khi `clearEdits` thì `publishClear()` để đồng bộ mọi tab.

## 7. Chống echo & edge cases

- **Echo/loop**: lọc theo `origin` ở `subscribeEdits`.
- **Focus guard** (admin): không đè field đang gõ.
- **Nhiều element chung 1 key** (title ở header+footer): `applyEdit` đã `querySelectorAll` toàn bộ.
- **Giá trị field.text**: form value là string thuần (fields.text ≈ formKind 'slug') → map 1-1 với `value` của bus. Cần xác minh lúc code (xem mục 10).
- **`contentField` / field không phải text**: ngoài scope MVP — `save.ts` đã chủ động `throw` nếu gặp; admin chỉ bắc cầu field.text.

## 8. Bản đồ tái sử dụng (không viết lại)

- `store.ts` (astro) → chuyển vào `@drystack/core/edit-sync`, re-export.
- `applyPendingEdits` → refactor tách `applyEdit`.
- `getLatestFieldValues` / `refreshFromLatestSource` → dùng lại cho "lấy yaml mới nhất".
- `saveEdits` (github + local) và `useUpsertItem`/`useCommitFileChanges` → giữ nguyên đường save 2 mode.
- Nhận diện field.text (`kind==='form' && formKind==='slug'`) → tách helper dùng chung.
- `discardEditsIfBuildIsNewer` → giữ, thêm `publishClear` sau khi clear.

## 9. Kế hoạch theo phase (checklist)

- [ ] **P0 — Module chung**: tạo `@drystack/core/edit-sync` (di chuyển `store.ts` + thêm BroadcastChannel, `origin`, `editKey/parseEditKey`, `publishEdit/publishDelete/publishClear/subscribeEdits`, fallback `storage` event). Cập nhật export trong `packages/drystack/package.json` + import ở astro.
- [ ] **P1 — Visual editor dùng bus**: `handleInput` → `publishEdit`; mount → `subscribeEdits` + `applyEdit` (live). Tách `applyEdit` khỏi `applyPendingEdits`.
- [ ] **P2 — Admin publish**: effect duyệt field.text trong `state` → `publishEdit` khi đổi (singleton trước).
- [ ] **P3 — Admin subscribe + focus guard**: nhận `set` → `onPreviewPropsChange` set field (bỏ qua nếu đang focus).
- [ ] **P4 — Save lifecycle**: cả 2 surface `publishClear/publishDelete` sau khi lưu; nhận clear → khôi phục + refresh. Thêm `publishClear` vào `discardEditsIfBuildIsNewer`.
- [ ] **P5 — Kiểm thử 2 mode**: local (astro dev) và github; 2 tab admin, admin↔visual editor; theo standing rule của `CLAUDE.md`.

## 10. Câu hỏi mở / cần xác minh khi code

1. **Shape của form value cho field.text trong admin**: xác nhận `state[field]` là string thuần để map thẳng vào bus (nếu là object preview-props thì cần adapter đọc/ghi).
2. **Cơ chế bắt "field đang focus"** trong form admin (dựa DOM `activeElement` theo field id, hay state riêng của field component).
3. **Nên broadcast per-keystroke hay debounce**? Đề xuất debounce ~150–250ms để giảm nhiễu cross-tab, vẫn đủ "live".
4. **Có mở rộng cho `collection`/`ItemPage` ngay không**, hay chốt singleton trước rồi generalize `editKey` sau (khuyến nghị: singleton trước).
5. **BroadcastChannel trong shadow root / môi trường build**: kiểm tra không vỡ khi visual editor mount trong site production.
