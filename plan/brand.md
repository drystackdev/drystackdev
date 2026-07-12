---
status: ready
---

# Quản lý "brand" ở chế độ GitHub (production)

> **Thuật ngữ:** trong tài liệu này **"brand" = một nhánh git cá nhân** của editor.
> Mỗi phiên biên tập làm việc trên brand riêng; "deploy" = merge brand vào nhánh
> mặc định (`main`) rồi để Cloudflare build/publish.

## 1. Mục tiêu & phạm vi

Thay luồng "chọn nhánh thủ công + commit thẳng lên nhánh đang xem" bằng một luồng
một-nút cho biên tập viên:

1. Vào `/drystack` → tự tạo (hoặc dùng lại) một **brand cá nhân**, mọi thay đổi
   commit vào brand này, **chưa** build/publish.
2. Bấm **Deploy** → merge brand vào `main` (tự tính 3-way ở client), xử lý xung
   đột theo **từng đoạn (hunk)** nếu có, tạo **1 commit** trên `main`.
3. Push `main` → Cloudflare **tự build/deploy**; nút Deploy hiển thị tiến trình
   build và chỉ bật lại khi xong.
4. Sau khi merge xong: xoá brand cũ, tạo brand mới, editor tiếp tục làm việc.

**Chỉ áp dụng cho `storage.kind === 'github'`.** Brand là khái niệm chỉ có ở
GitHub mode; local mode giữ nguyên luồng save-thẳng-ra-đĩa hiện tại (xem §12).
Đây là cách "gate" đúng theo chuẩn của `CLAUDE.md` — không phải bỏ sót local.

## 2. Quyết định đã chốt

| # | Vấn đề | Quyết định |
|---|--------|-----------|
| 1 | Cách merge khi Deploy | **Client-side**: tự tính 3-way ở client, commit 1 lần vào `main` qua `createCommitOnBranch` (tái dùng `useCommitFileChanges`). Không dùng merge API server. |
| 2 | Mức giải quyết conflict | **Hunk-level** (merge editor 3-way), mỗi file conflict là 1 tab. |
| 3 | Trigger build | Push `main` **tự build**; nút Deploy watch `commitOid` của commit merge qua `watchBuildStatus`. |
| 4 | Tên brand & copy | Chip hiển thị **đúng tên brand** (nhãn thân thiện); nút copy **copy đúng nhãn đó**. Git ref thật là bản đã sanitize, lưu map nhãn↔ref trong IndexedDB. |

**Lý do chọn client-side (tóm tắt):** vì conflict theo hunk mà GitHub khi 409
không trả hunk/base, nên **bắt buộc** phải tự dựng 3-way ở client dù đi đường nào.
Client-side tránh trùng lặp, tái dùng hạ tầng save sẵn có, và cho đúng 1
`commitOid` để theo dõi build. Đánh đổi duy nhất là không có merge-commit 2-parent
"đẹp" — vô nghĩa ở đây vì brand bị xoá ngay sau deploy.

## 3. Hạ tầng sẵn có (tái dùng)

| Thứ | File | Dùng để |
|-----|------|---------|
| Commit primitive | `packages/drystack/src/app/shell/useCommitFileChanges.ts` (`createCommitOnBranch`, `expectedHeadOid`) | Ghi commit merge lên `main` |
| Tạo/xoá nhánh | `branch-selection.tsx` (`useCreateBranchMutation` → `createRef`), `shell/sidebar/components.tsx` (`deleteRef`) | Tạo/xoá brand |
| Trees 3 nhánh | `shell/data.tsx` (`useBranches` → `{commitSha, treeSha}`, `fetchGitHubTreeData(sha)`) | Lấy cây file base/ours/theirs |
| Blob bytes | `useItemData.ts` (`fetchBlob`, `fetchBlobsBatch`) | Lấy nội dung file để diff3 |
| Theo dõi build | `build-status.ts` (`watchBuildStatus`), `DeployProgressToast.tsx` | Tiến trình build trên nút Deploy |
| IndexedDB | `persistence.tsx` (idb-keyval), `edit-sync.ts` (IDB thô) | Lưu bản ghi brand |
| Route theo nhánh | `ui.tsx` (`/branch/<ref>`, `RedirectToBranch`) | Điều hướng về brand |

**Cần thêm dependency:** `node-diff3` (3-way merge trả về vùng conflict). Chưa cài.

## 4. Mô hình dữ liệu & IndexedDB

Module mới `packages/drystack/src/app/brand.ts` (dùng idb-keyval như
`persistence.tsx`, store riêng `drystack-brand`). Một bản ghi brand cho mỗi repo:

```ts
type BrandRecord = {
  ref: string;          // git ref hợp lệ, vd: "drystack/2026-07-12-200000-khantran"
  label: string;        // hiển thị + copy: "2026-07-12 - 20:00:00 - Khan Trần - Editor"
  login: string;        // github login lúc tạo
  createdAt: number;    // epoch ms
  baseCommitOid: string;// commit HEAD của main lúc tạo brand
  baseTreeSha: string;  // tree oid của main lúc tạo brand — mốc base cho 3-way
};
// key = `${owner}/${name}` (per-repo). IndexedDB là per-browser/thiết bị →
// mỗi thiết bị có brand riêng, các tab cùng thiết bị chia sẻ 1 brand.
```

**Sinh nhãn & ref** (`brand.ts`):

```ts
// nhãn thân thiện (hiển thị + copy)
label = `${YYYY}-${MM}-${DD} - ${HH}:${mm}:${ss} - ${viewer.name} - ${role}`;
// role: mặc định "Editor"; có thể map từ viewerPermission
//   (ADMIN→"Admin", WRITE/MAINTAIN→"Editor") — xem §16.

// ref git-safe: prefix + timestamp + login đã sanitize
const prefix = getBranchPrefix(config) ?? 'drystack/';
ref = `${prefix}${YYYY}-${MM}-${DD}-${HH}${mm}${ss}-${sanitize(login)}`;
// sanitize: lowercase, thay mọi ký tự không thuộc [a-z0-9-] bằng '-',
// đảm bảo không vi phạm luật git ref (đã có danh sách invalid* trong
// branch-selection.tsx: space ~ ^ : * ? [ .. @{ \, không mở/kết . hoặc /).
```

## 5. Vòng đời brand

```
Vào /drystack (github mode)
        │
        ▼
  đọc BrandRecord[repo] từ IndexedDB
        │
   ┌────┴─────────────────────────┐
   │ có & ref còn trên GitHub?     │
   │  (useBranches().has(ref))     │
   └────┬───────────────┬─────────┘
     có │            không/mất │
        ▼                      ▼
 redirect /branch/<ref>   tạo brand mới:
                            createRef(oid = main.commitSha)
                            lưu BrandRecord (baseTree/CommitOid = main hiện tại)
                            redirect /branch/<ref>
```

- **Tạo brand phải chạy đúng 1 lần** (React StrictMode gọi effect 2 lần). Guard
  bằng một promise in-flight ở module-level, key theo `${owner}/${name}`.
- Sau **Deploy thành công** (§7): xoá brand cũ (`deleteRef`), xoá `BrandRecord`,
  tạo brand mới off `main` HEAD mới, redirect sang brand mới.
- **Điểm chạm code:** thêm hook `useEnsureBrand()` (tạo-hoặc-dùng-lại, trả về
  `ref`), gọi trong `RedirectToBranch` (`ui.tsx`) thay cho việc redirect thẳng
  về `defaultBranch`. Việc tạo nhánh làm trong `useEffect`, không trong render.

## 6. Luồng Deploy (thuật toán 3-way client-side)

Hook mới `useDeploy()` (vd `packages/drystack/src/app/deploy.ts`):

```
deploy():
  brand   = BrandRecord hiện tại
  main    = repoInfo.defaultBranch
  mainRef = useBranches().get(main)      // {commitSha, treeSha} — app shell giữ tươi
  brandRef= useBranches().get(brand.ref)

  // 1) Lấy 3 cây file (unscoped — thao tác trên file thật của repo)
  baseTree   = fetchGitHubTreeData(brand.baseTreeSha)   // mốc chung
  oursTree   = fetchGitHubTreeData(brandRef.treeSha)    // brand
  theirsTree = fetchGitHubTreeData(mainRef.treeSha)     // main hiện tại

  // 2) Duyệt hợp của mọi path, phân loại theo sha:
  for path in union(base, ours, theirs):
    b, o, t = sha(base,path), sha(ours,path), sha(theirs,path)
    if o == t:            continue           // giống nhau 2 bên → bỏ qua
    if o == b:            continue           // brand không đổi → main giữ nguyên
    if t == b:            take_ours(path)     // chỉ brand đổi → lấy brand (add/mod/del)
    else:                                     // cả hai đổi, khác nhau → xung đột
      if ext(path) in {.yaml,.yml,.html}:
        merge3(path)     // diff3 theo dòng; sạch → dùng luôn; kẹt → đưa vào UI
      else:
        take_ours(path)  // loại khác "không bao giờ conflict" → lấy brand

  // 3) Nếu còn hunk chưa giải quyết → mở Conflict UI (§8), chờ resolve hết.
  //    Huỷ ở UI = huỷ deploy, brand & main nguyên vẹn.

  // 4) Gom change set:
  //    additions = [{path, contents}]  (file take_ours hoặc merged bytes)
  //    deletions = [{path}]            (brand xoá file, không đụng phía main)

  // 5) Commit 1 lần lên main:
  commitOnMain({
    branchName: main,
    expectedHeadOid: mainRef.commitSha,     // main nhích giữa chừng → fail an toàn
    message: `Deploy: ${brand.label}`,
    additions, deletions,
  })
  // STALE_DATA (main vừa đổi): re-fetch main → quay lại bước 1 (có thể sinh
  // conflict mới) → thử lại. Mirror retry trong updating.tsx.

  // 6) newCommitOid = kết quả mutation → watchBuildStatus(newCommitOid) (§9)

  // 7) Dọn brand: deleteRef(brand.ref); xoá BrandRecord;
  //    tạo brand mới off main HEAD mới; redirect sang brand mới.
```

**Chi tiết cần lưu ý:**
- **3 phiên bản để diff3:** với file conflict `.yaml/.html`, tải text 3 bên qua
  `fetchBlob(config, sha, path, baseCommit, repoInfo, basePath)` cho base/ours/theirs.
- **take_ours dạng "brand xoá file":** nếu `ours` thiếu path mà `base` có và
  `theirs == base` → thêm vào `deletions`. Nếu `.yaml/.html` mà "brand xoá vs main
  sửa" → coi là conflict "deleted vs modified" (§16, edge case).
- **encode:** `additions[].contents` là `Uint8Array` (như `useCommitFileChanges`).

## 7. Giải quyết conflict — UI hunk-level (§ quyết định #2)

Component mới `packages/drystack/src/app/deploy/ConflictDialog.tsx`:

- **Dialog lớn (full-screen).** Thanh tab trên cùng: mỗi file conflict 1 tab
  (`home.yaml`, `about.html`…), kèm badge **số hunk chưa giải quyết**.
- **Thân file:** render tuần tự theo output của `node-diff3`:
  - vùng `ok` → context (dòng không đổi), hiển thị mờ.
  - vùng `conflict {a, o, b}` → một **hunk**: 2 cột LEFT (brand / `a`) vs RIGHT
    (main / `b`), mỗi hunk chọn **trái hoặc phải** (radio/toggle). (MVP: chọn 1
    bên; *stretch*: chọn cả hai theo thứ tự / sửa tay.)
- **Mặc định lựa chọn:** ưu tiên **LEFT (brand)** — là bản editor vừa sửa. (Xem
  §16 về diễn giải "xử lý conflict ở file mới nhất".)
- **Footer:** "Đã giải quyết X/Y" + nút **"Hoàn tất & Deploy"** (chỉ bật khi mọi
  hunk ở mọi file đã chọn) + **"Huỷ"** (huỷ deploy).
- **Kết quả:** với mỗi file, dựng lại text từ (context + bên đã chọn cho từng
  hunk) → bytes → nhét vào `additions`.

## 8. Nút Deploy & theo dõi build (§ quyết định #3)

Component mới `DeployButton` (đặt cạnh chip brand trong navbar):

```
idle        → ActionButton prominence=high, nhãn "Deploy", enabled
click       → disabled; chạy useDeploy()
(conflict)  → mở ConflictDialog; nhãn "Đang chờ xử lý xung đột…"
committing  → nhãn "Đang deploy…"
build chạy  → nhãn theo build-status ("Đang build…", "Đang deploy…") — dùng
              watchBuildStatus(newCommitOid), tái dùng nhãn giả lập sẵn có
build xong  → succeeded: "Đã publish" ngắn → về "Deploy" (đã ở brand mới), enable
              failed/canceled/timeout: toast critical + "Deploy lại", enable
```

- Nút **hiển thị thông tin thay cho toast.process** đúng như plan: label tiến
  trình nằm **trên nút**, không dùng toast trung gian. (Toast kết quả cuối vẫn
  có thể dùng như `DeployProgressToast` hiện tại.)
- Nút **disabled suốt** merge + build, chỉ enable khi build kết thúc.
- Deploy chạy ở navbar (persistent) nên vẫn theo dõi được build khi đã redirect
  sang brand mới.

## 9. Thay đổi UI — Navbar

File: `packages/drystack/src/app/shell/sidebar/index.tsx` → `SidebarGitActions`:

- **Bỏ** `<BranchPicker />` và `<GitMenu />` (nút 3 chấm: new branch, github repo,
  PR, fork, delete branch — tất cả không còn trong luồng này).
- **Thêm** `<CurrentBrandChip />` + `<DeployButton />`.

`CurrentBrandChip` (component mới): đọc `label` brand hiện tại (hook
`useCurrentBrand()` — **đặt tên khác** `useBrand()` đang dùng cho brandMark/
brandName ở `shell/common.tsx`), render nhãn (truncate) + `IconButton` copy
(`navigator.clipboard.writeText(label)` → toast "Đã copy tên brand").

**Dọn dẹp:** `BranchPicker` và `CreateBranchDialog` (trong `branch-selection.tsx`)
và `GitMenu` (trong `shell/sidebar/components.tsx`) trở thành dead UI. Giữ lại
`useCreateBranchMutation`/`createRef` và `deleteRef` (còn dùng để tạo/xoá brand).
Có thể xoá phần UI dialog/menu không dùng nữa.

## 10. Thay đổi UI — Dashboard

File: `packages/drystack/src/app/dashboard/BranchSection.tsx`:

- **Bỏ** nút "New branch" (`CreateBranchDialog` trigger) và nút Pull request.
- Hiển thị **nhãn brand hiện tại** + **nút copy ở bên phải** (tái dùng
  `CurrentBrandChip` hoặc cùng logic copy).
- Đổi tiêu đề sang "Brand hiện tại" (thêm l10n key; hiện dùng `currentBranch`).

## 11. Tách build-tracking khỏi Save (BẮT BUỘC)

Hiện `useDeployProgressToast(commitOid)` được gọi **mỗi lần save** ở
`SingletonPage.tsx:178` và `ItemPage.tsx:171`. Trong mô hình brand:

- Save commit vào **brand** — nhánh **không** auto-build → toast build sẽ quay
  vô tận rồi timeout.
- **Sửa:** bỏ (hoặc gate) `useDeployProgressToast` khỏi Singleton/ItemPage. Việc
  theo dõi build **chỉ** xảy ra ở `DeployButton` với commit merge trên `main`.
- Source-cache bắc cầu commit→deploy trong `edit-sync.ts` vẫn giữ, nhưng "deploy"
  giờ là lúc **merge vào main** chứ không phải lúc save. Rà lại
  `discardEditsIfBuildIsNewer`/`buildVersion` để mốc so sánh khớp commit `main`.

## 12. Local mode & gating

- `SidebarGitActions` đã `return null` khi `isLocalConfig` → chip brand + Deploy
  chỉ render ở github mode. Dashboard `BranchSection` đã gate `!isLocalConfig`.
- **Không cần thay đổi gì cho local**; local giữ luồng save-thẳng-ra-`/update`.
- Ghi chú theo chuẩn `CLAUDE.md`: brand vốn là khái niệm github-only (không có
  nhánh ở local) → gate là cách xử lý đúng, không phải bỏ sót parity.

## 13. Danh sách file & dependency

**Thêm mới**
- `packages/drystack/src/app/brand.ts` — BrandRecord + IndexedDB + sinh nhãn/ref + `useEnsureBrand`, `useCurrentBrand`.
- `packages/drystack/src/app/deploy.ts` (hoặc `deploy/useDeploy.ts`) — thuật toán 3-way + commit + dọn brand.
- `packages/drystack/src/app/deploy/ConflictDialog.tsx` — UI hunk-level.
- `packages/drystack/src/app/deploy/DeployButton.tsx` — nút + theo dõi build.
- `packages/drystack/src/app/deploy/CurrentBrandChip.tsx` — chip + copy.
- (tuỳ) helper 3-way bọc `node-diff3`.

**Sửa**
- `shell/sidebar/index.tsx` — thay `BranchPicker`+`GitMenu` bằng chip+Deploy.
- `dashboard/BranchSection.tsx` — bỏ new branch/PR, thêm chip+copy.
- `ui.tsx` — `RedirectToBranch` dùng `useEnsureBrand`.
- `SingletonPage.tsx`, `ItemPage.tsx` — bỏ `useDeployProgressToast` khỏi save (§11).
- `shell/useCommitFileChanges.ts` — cho phép chỉ định `branchName`/`expectedHeadOid`
  đích (để commit lên `main`), hoặc viết biến thể `useCommitToMain`.
- l10n (`l10n/en-US`, `l10n/vi-VN`) — keys: Deploy, copy brand, brand hiện tại…

**Dependency:** thêm `node-diff3` vào `packages/drystack/package.json`.

## 14. Các mốc triển khai (thứ tự đề xuất)

1. **M1 — Brand lifecycle:** `brand.ts` + `useEnsureBrand` + đổi `RedirectToBranch`.
   Vào `/drystack` tự tạo/dùng-lại brand, mọi save đã commit vào brand.
2. **M2 — Navbar/Dashboard UI:** chip brand + copy; bỏ BranchPicker/GitMenu/new-branch.
   (Chưa cần Deploy hoạt động — nút disabled/placeholder.)
3. **M3 — Deploy không-conflict:** `useDeploy` (bỏ qua nhánh conflict, mọi divergence
   `.yaml/.html` tạm take-ours) + commit lên main + xoá/tạo brand + `DeployButton`
   theo dõi build. Tách build khỏi save (§11).
4. **M4 — Conflict 3-way:** tích hợp `node-diff3` + `ConflictDialog` hunk-level.
5. **M5 — Bền hoá:** retry STALE_DATA, edge cases (§16), l10n, dọn dead code.

## 15. Kiểm thử (github mode — theo chuẩn parity của repo)

- Tạo brand khi vào lần đầu; reload dùng lại đúng brand; sau deploy sinh brand mới.
- Save vào brand **không** kích hoạt build; Deploy mới build.
- Deploy không-conflict: main nhận đúng 1 commit, nội dung khớp brand.
- Deploy có-conflict: 2 phiên cùng sửa `home.yaml` → mở tab, chọn hunk trái/phải,
  hoàn tất → kết quả đúng lựa chọn.
- main nhích giữa lúc deploy → STALE_DATA → tự tính lại, không ghi đè mù.
- Copy: nút copy ra **đúng nhãn brand** đang hiển thị.

## 16. Edge cases, rủi ro & giả định còn lại

**Cần bạn xác nhận:**
- **"Xử lý conflict ở file mới nhất":** diễn giải hiện tại = (a) luôn tính conflict
  với **main HEAD tươi nhất** (re-fetch lúc deploy, đã có ở bước STALE_DATA) và
  (b) mặc định chọn hunk **bên brand (LEFT)**. Nếu ý bạn khác (vd mặc định lấy bản
  có commit-time mới hơn), báo để chỉnh §7.
- **Role trong nhãn:** mặc định cố định `"Editor"`. Có muốn map từ quyền GitHub
  (ADMIN→Admin, WRITE/MAINTAIN→Editor) không?

**Rủi ro/kỹ thuật:**
- **Delete-vs-modify** trên `.yaml/.html`: brand xoá file mà main sửa (hoặc ngược
  lại) → cần quy ước riêng (hiện đề xuất coi là 1 loại conflict "xoá vs sửa", cho
  user chọn giữ-bản-main hay xoá). Xác nhận nếu muốn khác.
- **Brand bị xoá ngoài app** (ai đó xoá trên GitHub): `useEnsureBrand` phát hiện
  ref mất → tạo brand mới; nhưng **thay đổi chưa deploy trên brand cũ sẽ mất**.
  Chấp nhận được vì brand là nhánh tạm.
- **Nhiều thiết bị/nhiều editor:** mỗi thiết bị 1 brand độc lập → nếu 2 người deploy
  gần nhau, người sau gặp conflict/STALE_DATA và tự giải quyết — đúng thiết kế.
- **`node-diff3` chỉ merge theo dòng (text).** Đủ cho `.yaml/.html`. File nhị phân/
  loại khác không vào nhánh conflict (take-ours), khớp giả định "không bao giờ
  conflict" của plan.
- **StrictMode double-effect:** tạo brand/tạo commit phải idempotent (guard in-flight).
