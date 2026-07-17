# Kế hoạch: `fields.content` lồng trong `object`/`array` — editable trong VEI + đồng bộ admin

## Context

Trên trang live, phần tử `<h1 data-dry="singleton::homepage::brand.name" data-dry-kind="content">Quang<strong>SEO</strong></h1>`
(từ [hero.astro:79-83](../../drystack/src/components/hero.astro#L79)) **không click-để-edit được** trong VEI.

Nguyên nhân: `brand.name` là `fields.content({ inline: true })` **lồng bên trong** `brand: fields.object(...)`
([drystack.config.ts:181](../../drystack/drystack.config.ts#L181)), nên `data-dry` key có dấu chấm. Toàn bộ pipeline VEI/edit-sync
hiện **chỉ hỗ trợ content field top-level** và loại bỏ field lồng nhau ở nhiều lớp. Người dùng chốt: fix triệt để, tổng quát hoá
đầy đủ cả **inline** (HTML string tại path lồng trong YAML) lẫn **non-inline** (file `.html` riêng + ảnh nhúng), theo quy ước
filename + đường ảnh lồng nhau, và phải chạy được ở cả `storage.kind: 'local'` lẫn `'github'`
([GitHub mode parity](../projects/-Users-kcoder-drystack/memory/drystack-github-mode-parity.md)).

## Bất biến thiết kế (nền tảng của toàn bộ fix)

- **INV-1 — content leaf đi một mình:** giá trị của content leaf **không bao giờ** nằm trong JSON của container (object/array)
  trên bus, cũng không nằm trong container value dựng lại lúc save. Nó chỉ đi bằng key riêng `singleton::name::<dotted-path>`
  với `data-dry-kind="content"`, mang HTML thô, ảnh nhúng stash riêng (giống content top-level hiện tại).
- **INV-2 — dựng lại container phải giữ content leaf:** mọi nơi dựng lại container value từ JSON (VEI `paintObjectFields`/
  `paintItemOrLeaf`, admin whole-object replace, save `mergeFieldEdits`) phải **giữ nguyên** content leaf hiện có, không ghi đè/xoá.
  (INV-1 tạo ra hazard "mất content khi replace"; INV-2 là cái bịt lại — cả hai phải đi cùng nhau.)
- **INV-3 — namespace asset theo từng content field:** mỗi nested content field resolve assets dir riêng
  `${entryDir}/${dottedField}/assets/`, tránh hai content field trong cùng singleton đụng tên file ảnh.

## Bước 0 — Helper dùng chung (thêm vào [edit-sync.ts](../../drystack/packages/drystack/src/app/edit-sync.ts))

Đặt cạnh `spliceValueEdit`/`getSyncableFieldKind`/`isAssetKind` (đã được share sẵn cho cả hai package):

- **H1 `resolveSchemaAtFieldPath(rootSchema, dottedField)`** — walk schema-only theo path (object→`.fields[seg]`, array→`.element`),
  trả `ComponentSchema` của leaf. Thay mọi lookup phẳng `schema[field]`. Mẫu: `resolveDrySpot` trong [dry.ts:206-238](../../drystack/packages/astro/src/dry.ts#L206).
- **H2 `omitContentLeaves(rootSchema, value)` + `forEachContentLeaf(rootSchema, value, basePath, cb)`** — đệ quy theo schema
  (mẫu `stripEmptyAssetLeaves` [save.ts:464-491](../../drystack/packages/astro/src/editor/save.ts#L464)). `omit` = deep-copy bỏ hết content leaf
  (dựng JSON container, INV-1). `forEach` = yield `(dottedSubPath, leafSchema, leafValue)` cho publisher/save.
- **H3 `resolveValueAtFieldPath(rootValue, dottedPath)`** — getter read-only theo path; dùng tổng quát hoá `ownContentValues`.
- **H4 — không thêm setter mới:** dùng lại `spliceValueEdit` với path (trừ base). Nó đồng bộ; để ghép với parse content async
  → dùng pattern **"resolve async trước, splice sync sau"** (xem Lớp 2). **Không** biến `spliceValueEdit` thành async (còn caller
  đồng bộ ở [save.ts:538](../../drystack/packages/astro/src/editor/save.ts#L538)).
- **H5 helper path:** `contentEntryDir(dir, f) = f.includes(".") ? \`${dir}/${f}\` : dir`; `contentAssetsDir = \`${contentEntryDir}/assets\``;
  sibling html = `\`${dir}/${f}${contentExtension}\``. Top-level không đổi (không cần migrate). `dottedField` chỉ chứa `.`/chữ số,
  không có `/`.

## Lớp 1 — VEI mount editor lên spot lồng nhau ([InlineContentEditors.tsx](../../drystack/packages/astro/src/editor/InlineContentEditors.tsx))

- **L1-a:** trong `readContentSpots` ([231-256](../../drystack/packages/astro/src/editor/InlineContentEditors.tsx#L231)) xoá chặn
  `if (field.includes(".")) return;` (dòng 243); thay lookup phẳng (244) bằng `resolveSchemaAtFieldPath` (H1), chỉ push nếu leaf kind = `"content"`.
- **L1-b:** trong `InlineContentEditor` ([80-228](../../drystack/packages/astro/src/editor/InlineContentEditors.tsx#L80)) thay `assetsDir`/`entryDirectory`
  bằng `contentAssetsDir`/`contentEntryDir(entryDir, field)` (H5) — áp dụng đồng bộ cho mount-hydrate (125), painter re-read (183),
  `stashContentBlobs` (213), destroy-repaint `serializeHtml(..., entryDir)` (160). Mount tại chỗ, không swap node → không cần đổi bind.ts routing ở đây.

## Lớp 1b — VEI paint không được đè content ([bind.ts](../../drystack/packages/astro/src/editor/bind.ts))

- **L1b-a:** `paintObjectFields` ([332-354](../../drystack/packages/astro/src/editor/bind.ts#L332)) thêm nhánh `subKind === "content"` → **skip** (do nothing),
  trước nhánh `else` `el.textContent = value` (352). (Sửa failure (a).)
- **L1b-b:** `paintItemOrLeaf` ([363-395](../../drystack/packages/astro/src/editor/bind.ts#L363)) thêm skip content y hệt (content leaf trong array item).
- **L1b-c:** painter cho nested content **đã tự chạy**: admin publish key dotted → `applyEdit` ([1078-1081](../../drystack/packages/astro/src/editor/bind.ts#L1078))
  match `isContentSpot` → `paintContentSpot` → painter mà L1-a đăng ký. Chỉ cần confirm.

## Lớp 2 — đồng bộ bus admin ↔ VEI ([SingletonPage.tsx](../../drystack/packages/drystack/src/app/SingletonPage.tsx) + edit-sync.ts)

- **L2-a Publisher** ([857-910](../../drystack/packages/drystack/src/app/SingletonPage.tsx#L857)): với container chứa content leaf, publish JSON =
  `JSON.stringify(omitContentLeaves(...))` (INV-1); đồng thời với **mỗi** content leaf (H2) chạy đúng chuỗi serialize→`stashContentBlobs`
  (vào `contentAssetsDir`)→`publishEdit(key dotted, html)` như nhánh content top-level (867-905), debounce + `publishGuardRef` **key theo dotted path**.
  `lastSyncedRef` key: dotted-path cho content, base-field cho JSON (không đụng nhau, xem failure (k)).
- **L2-b Subscriber** ([912-993](../../drystack/packages/drystack/src/app/SingletonPage.tsx#L912)): nếu `resolveSchemaAtFieldPath` ra content leaf **và** `field !== baseField`:
  claim `applyGuardRef` theo dotted path → `await contentFromBusValue(leafSchema, msg.value, contentAssetsDir(...), ownContentValuesAtPath(field))`
  (tổng quát `ownContentValues` [725-731](../../drystack/packages/drystack/src/app/SingletonPage.tsx#L725) bằng H3) → khi `isCurrent`:
  `onPreviewPropsChange(s => ({...s, [baseField]: spliceValueEdit(s[baseField], pathMinusBase, baseSchema, () => resolvedState)}))`
  ("async trước, splice sync sau", sửa failure (c)). Honor `deferredCommitRef` theo dotted path.
- **L2-c Whole-object replace** ([969-974](../../drystack/packages/drystack/src/app/SingletonPage.tsx#L969)): sau khi decode JSON (đã thiếu content leaf theo INV-1),
  re-graft content leaf hiện tại bằng `spliceValueEdit(incoming, p, baseSchema, () => resolveValueAtFieldPath(current, p))` cho mỗi content leaf (INV-2, sửa failure (b)).
- **L2-d:** giữ NO-OP content trong `applyContainerPathEdit` ([577](../../drystack/packages/drystack/src/app/edit-sync.ts#L577)) như lớp phòng thủ; cập nhật comment (nested content giờ được route async ở tầng trên).
- **L2-e Mount catch-up** ([775-855](../../drystack/packages/drystack/src/app/SingletonPage.tsx#L775)): thêm nhánh nested-content async y hệt L2-b trong pass per-path;
  thứ tự: apply JSON container (đã strip) trước, splice content leaf + per-path sau.

## Lớp 3 — save ghi đúng file lồng nhau ([save.ts](../../drystack/packages/astro/src/editor/save.ts))

- **L3-a:** trong `collectFileDiffs` ([721-760](../../drystack/packages/astro/src/editor/save.ts#L721)) với base field container, **partition** `fieldEdits`:
  các sub-edit resolve ra content leaf (H1) tách riêng; phần còn lại vẫn qua `mergeFieldEdits`.
- **L3-b:** tổng quát `collectContentFieldDiffs` ([599-672](../../drystack/packages/astro/src/editor/save.ts#L599)) từ `baseField` → `dottedField`:
  hydrate + serialize dùng `contentEntryDir`/`contentAssetsDir` (H5); thay `data[baseField]=out.value` (633) bằng
  `data[baseField]=spliceValueEdit(data[baseField], pathMinusBase, baseSchema, () => out.value)` (INV-2 phía ghi); sibling file
  `\`${dir}/${dottedField}${ext}\`` (thay 640); image diffs vào `${contentAssetsDir}/${key}`. Top-level là trường hợp path rỗng (không đổi hành vi cũ).
- **L3-c:** thứ tự trong loop: (1) load `data`, (2) `mergeFieldEdits` phần non-content → gán `data[baseField]`, (3) splice content diffs lên trên
  giá trị đó. Splice các key object rời nhau giao hoán khi cùng base → content value sống sót (sửa failure (f)).
- **L3-d:** `stripEmptyAssetLeaves` ([464-491](../../drystack/packages/astro/src/editor/save.ts#L464)) không đụng content (leaf non-asset rơi xuống `return value`) — chỉ confirm, không sửa; **không** thêm logic "xoá leaf rỗng" chung.

## Case lỗi & cách fix (đã rà)

| # | Trigger | Vỡ ở đâu | Fix |
|---|---------|----------|-----|
| a | container repaint khi VEI đang hiện content | `paintObjectFields`/`paintItemOrLeaf` set `textContent` đè HTML | L1b-a/b skip content |
| b | object JSON (đã bỏ content) replace phía nhận | content leaf bị blank + **mất data lúc save** + orphan `.html`/asset | L2-c + L3-c re-graft (INV-2) |
| c | nested content key tới admin | `spliceValueEdit` đồng bộ, parse content async → NO-OP | L2-b async-resolve-then-splice + guard token theo dotted path |
| d | 2 content field cùng singleton nhúng ảnh trùng tên | ghi đè `<dir>/assets/<name>`, hydrate sai bytes → repoint ảnh | INV-3/H5 namespace `${dir}/${field}/assets` (top-level 2 field vẫn share — pre-existing, ngoài scope, flag) |
| e | content ở `stats.0.body` / tên lạ | sibling = `stats.0.body.html` | hợp lệ FS+GitHub; segment không có `/`; thêm guard chặn `/`,`..` phòng thủ |
| f | 1 save có cả `brand.name` (content) + `brand.tagline` (text) | clobber spine / ghi string sai chỗ | L3-a partition + L3-c thứ tự merge |
| g | nhúng ảnh rồi gõ ở surface kia | parse map thiếu bytes → repoint `/media-library/` ([UNHYDRATED](../projects/-Users-kcoder-drystack/memory/drystack-vei-content-image-src-format.md)) | stash trước publish (L2-a) + hydrate own(H3)+pending (L2-b) |
| h | save merge object có content | không vỡ | confirm `stripEmptyAssetLeaves` bỏ qua content |
| i | `format.contentField` throw ([700](../../drystack/packages/astro/src/editor/save.ts#L700)) | không liên quan (markdoc body cả entry, không phải field) | confirm, giữ nguyên |
| j | slash trong tên asset | không có — dotted name chỉ ở sibling `.html` + subdir, không phải blob *name* | luôn query `getPendingBlobsUnder(contentAssetsDir)` để name không có `/` |
| k | `lastSyncedRef` aliasing content vs JSON | 1 cái nuốt cái kia | key content = dotted, JSON = base (khác nhau) |
| l | VEI publish dotted key admin không route | sync một chiều | L2-b + L2-e phải ship cùng L1-a |

## Thứ tự thực hiện

1. Bước 0 (helper) + Lớp 1 + Lớp 1b + Lớp 3 → fix trực tiếp "không edit được" + save đúng.
2. Lớp 2 (bus 2 chiều) — L1-a, L2-b, L2-e phải đi cùng nhau (failure l).
3. Rebuild `@drystack/core` + `@drystack/astro` ([dist stale nếu quên](../projects/-Users-kcoder-drystack/memory/drystack-dev-background-stale-dist.md)).

## Verify

1. **Inline (`brand.name`), local:** VEI bold 1 từ → admin form `brand.name` update live; admin sửa `brand.name` → live repaint không bị object-repaint đè;
   Save → YAML có body ở `data.brand.name` (inline: HTML string, không file `.html`), không có key `brand` phẳng lạ.
   Cẩn thận [autosave khi test editor](../projects/-Users-kcoder-drystack/memory/drystack-editor-autosave-on-browser-test.md) — `git diff` + revert sau.
2. **Non-inline tổng hợp (config scratch, không commit):** thêm `hero.body = fields.content()` non-inline, nhúng ảnh → confirm sibling `<dir>/hero.body.html`,
   ảnh `<dir>/hero.body/assets/<name>`, src `/<dir>/hero.body/assets/<name>`, gõ ở surface kia không repoint (g), thêm field content thứ 2 trùng tên ảnh → không đụng (d),
   sửa kèm `hero.title` → cả hai persist (f).
3. **`bun test`** ở cả hai package ([runner = bun test](../projects/-Users-kcoder-drystack/memory/drystack-test-runner-bun.md)); so [baseline 4 fail + 12 tsc](../projects/-Users-kcoder-drystack/memory/drystack-baseline-test-failure-emdash.md).
   Thêm unit test cho H1/H2/H3 (path có array index), `omitContentLeaves` round-trip, thứ tự async-splice.
4. **GitHub mode:** logic path/multi-file-write storage-agnostic ([save.ts:770-778](../../drystack/packages/astro/src/editor/save.ts#L770)) nên local cover phần lớn;
   delta chưa test: `listAssetFiles(..., branch)` cho subdir namespaced + opaque-id map mang `data-dry-kind="content"` cho nested spot → smoke test tay 1 lần trên branch scratch, flag không có harness github tự động.

## File sẽ sửa

- [edit-sync.ts](../../drystack/packages/drystack/src/app/edit-sync.ts) — helper H1–H5, cập nhật comment `applyContainerPathEdit`
- [SingletonPage.tsx](../../drystack/packages/drystack/src/app/SingletonPage.tsx) — publisher/subscriber/mount-catchup/`ownContentValues`
- [save.ts](../../drystack/packages/astro/src/editor/save.ts) — `collectFileDiffs`/`collectContentFieldDiffs`/`mergeFieldEdits`
- [bind.ts](../../drystack/packages/astro/src/editor/bind.ts) — `paintObjectFields`/`paintItemOrLeaf`
- [InlineContentEditors.tsx](../../drystack/packages/astro/src/editor/InlineContentEditors.tsx) — `readContentSpots`/`InlineContentEditor`
