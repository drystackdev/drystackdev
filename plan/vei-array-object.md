# VEI — hỗ trợ `fields.array` (primitive)

Mở rộng Visual Editing Inline để một field mảng vừa **edit inline từng phần tử**, vừa
có **nút setting mở dialog UI y hệt admin** để thêm/xóa/sắp xếp — tái sử dụng tối đa
code admin (DRY), lưu qua API sẵn có, và **binding cross-tab/live**.

## Quyết định đã chốt
- **Binding array = template-clone**: chụp 1 `<li>` làm template khi vào edit mode, tự
  clone/xóa/sắp lại để khớp value mới → binding thật, live (không reload).
- **Phạm vi đợt này**: chỉ **array primitive** (đúng demo `<li>{i}</li>`). `object` và
  `array-of-object` để pha sau.

## Ví dụ đích ([Demo.astro](../src/components/Demo.astro))
```astro
<ul {...dry.item("array")}>
  {dry.array.map((i, idx)=><li {...dry.item(`array.${idx}`)}>{i}</li>)}
</ul>
```
- `<ul data-dry="singleton::demo::array" data-dry-kind="array">` → nút gear → dialog.
- `<li data-dry="singleton::demo::array.0" data-dry-kind="text">` → contentEditable inline.

## Tái sử dụng admin (DRY)
| Mảnh admin | Dùng cho |
|---|---|
| `createGetPreviewProps(schema, setValue, ()=>undefined)(value)` — `form/preview-props.tsx` | preview props cho field array trong dialog |
| `FormValueContentFromPreviewProps` — `form/form-from-preview.tsx` | render editor array admin (Add/Edit/Reorder/Delete) — miễn phí |
| `previewPropsToValue`/`valueToUpdater`/`setValueToPreviewProps` — `form/get-value.ts` | value ↔ preview props |
| `clientSideValidateProp` — `form/errors.ts` | validate trước publish/save |
| `getInitialPropsValue` — `form/initial-values.ts` | mặc định item mới (do ArrayFieldInput tự lo) |
| bus + IndexedDB — `app/edit-sync.ts` | lưu trữ + cross-tab (value → JSON) |
| `collectFileDiffs` + `dump` — `editor/save.ts`, `core/yaml` | ghi file (mở rộng nested/structured) |

## Thay đổi theo file

### 1. `app/edit-sync.ts`
- `SyncableFieldKind` += `'array'`. `getSyncableFieldKind`: thêm
  `if (fieldSchema.kind === 'array') return 'array';` (array schema có `kind:'array'`,
  không phải `'form'`).
- Value structured trên bus = `JSON.stringify(value)`.

### 2. `packages/astro/src/dry.ts`
- `DryItem['data-dry-kind']` += `'array'`.
- `item(field)` hỗ trợ path lồng:
  - `"array"` → schema `fields.array` → kind `'array'`.
  - `"array.0"` → resolve **element schema** của array → primitive text → kind `'text'`,
    key `singleton::demo::array.0` (dấu `.` không phá `split('::')`).

### 3. `editor/bind.ts`
- **Item spot** `array.N` (`data-dry-kind='text'`): contentEditable + `input`→publish, như hiện tại.
- **Container spot** `array` (`data-dry-kind='array'`): KHÔNG contentEditable; thêm class
  `dry-array-spot` ở edit mode + `setStructuredSpotClickHandler` (song song với
  `setImageSpotClickHandler`) để Toolbar mở dialog.
- **Template registry** `Map<containerKey, HTMLElement>`: khi vào edit mode / lần paint đầu,
  clone 1 `<li>` con (khớp prefix `singleton::name::array.\d+`), xóa text, giữ làm template.
  Giữ template kể cả khi mảng rỗng đi (đừng xóa).
- **`renderArray(containerEl, key, value: string[])`**: reconcile con theo index — clone
  template nếu thiếu, set `data-dry`=`array.i` + `textContent`=`value[i]` (+ contentEditable
  nếu đang edit), xóa `<li>` dư. Gọi từ `applyEdit`/`revert`/`refreshFromLatestSource`.
- `applyEdit`/`revertFieldToOriginal`/`paintFetchedValue`: dispatch thêm nhánh
  `data-dry-kind==='array'` → parse JSON → `renderArray`.
- **Mảng rỗng → khóa gear** (chốt): nếu container **không có item spot nào**
  (`array.N` count === 0), nút setting bị **disable** — không mở dialog, không sửa/thêm gì.
  Vừa né được ca "không có template để clone", vừa là hành vi mong muốn. Hệ quả: item đầu
  tiên phải seed qua admin; sau khi có ≥1 item, VEI mới chỉnh được. Count đọc client-side từ
  số phần tử khớp prefix bên trong container (cập nhật lại sau mỗi `renderArray`).

### 4. `editor/save.ts`
- `collectFileDiffs`: gom edit theo singleton; xử lý field lồng:
  - `baseField = field.split('.')[0]`, kind theo `getSyncableFieldKind(schema[baseField])`.
  - Áp **container** (field không có `.`, JSON→parse→`data[field]=parsed`) **trước**,
    rồi **path lẻ** `array.0` qua `setNested(data, field, value)`.
- `validateEdits`: refactor validate trên `data[baseField]` cuối cùng qua `schema.validate`
  (array tự validate length + element).
- `getLatestFieldValues`: trả thêm structured (JSON) để dialog lấy "giá trị hiện tại" và
  refresh; paint path dispatch theo `data-dry-kind` (container render, item spot bỏ qua vì
  được render kèm container).

### 5. `editor/Toolbar.tsx` (+ component mới `StructuredFieldDialog`)
- Nút **gear** nổi: portal `<body>`, hiện khi hover container `dry-array-spot`, định vị bằng
  `getBoundingClientRect` (theo mẫu `dry-ref-menu` sẵn có). Click → `openDialog(key)`.
  **Disable khi mảng rỗng** (item count === 0): gear ở trạng thái disabled, không mở dialog.
- `StructuredFieldDialog`: resolve `name/field/fieldSchema` từ key → seed `value` từ pending
  edit (JSON) hoặc `getLatestFieldValues` → `createGetPreviewProps(fieldSchema, setValue,
  ()=>undefined)(value)` → `FormValueContentFromPreviewProps`. Done: `clientSideValidateProp`
  → `publishEdit(key, JSON.stringify(value))` → `publishDelete` các edit `array.*` cũ →
  `applyEdit(key, JSON)` (kích hoạt template-clone) → refresh → đóng.
- Mount lazy như `VeiMediaHost`.
- **Rủi ro cần kiểm chứng**: `ArrayFieldInput` tự mở modal Add/Edit item **bên trong** dialog
  của mình (dialog lồng dialog). Nếu Keystar không cho lồng → dùng panel/drawer thay `Dialog`.

### 6. `SingletonPage.tsx`
- `toBusValue`/`fromBusValue` + vòng sync 2 chiều: xử lý kind `'array'` (JSON encode/decode),
  để admin ↔ live-site binding cả field mảng.

### 7. `editor/editor.css`
- Style `.dry-array-spot` (outline hover) + nút `.dry-gear`.

## Binding cross-tab (đã có sẵn, chỉ mở rộng paint)
`subscribeToRemoteEdits`→`applyEdit` đã lo cross-tab; chỉ cần `applyEdit` dispatch nhánh
`array`→`renderArray`. Admin publish qua vòng sync ở mục 6.

## Review dialog (`change-preview`)
Edit `array` (JSON) hiện diff dạng text JSON trước/sau (đủ cho Phase 1). Edit item `array.0`
hiện như text spot bình thường (`schema['array.0']` không có → label fallback `array.0`).

## Thứ tự thực thi
1. `edit-sync.ts` (kind + JSON) → `dry.ts` (path lồng + kind).
2. `bind.ts` template-clone + `renderArray` + dispatch paint.
3. `save.ts` nested/structured + `getLatestFieldValues`.
4. `Toolbar.tsx` gear + `StructuredFieldDialog`.
5. `SingletonPage.tsx` sync 2 chiều.
6. CSS + verify **cả local lẫn github** (CLAUDE.md: parity bắt buộc).

## Kiểm thử (both storage.kind)
- Inline sửa 1 item → Save → YAML đúng phần tử; reload giữ nguyên.
- Dialog thêm/xóa/kéo item → list live cập nhật (template-clone) → Save → YAML đúng.
- Mở admin cùng singleton ở tab khác → sửa mảng → live-site tự cập nhật (và ngược lại).
- Reset/Review xử lý đúng edit `array` + `array.N`.
- **Mảng rỗng**: gear disabled, click không mở dialog; seed 1 item qua admin rồi mới sửa được ở VEI.
