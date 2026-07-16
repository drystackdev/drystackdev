# Việc cần làm

## `BRANCH_PROTECTION_RULE_VIOLATION` chưa được xử lý trong luồng Deploy (github mode)

**Hiện trạng**: [useDeploy.ts](packages/drystack/src/app/deploy/useDeploy.ts) xử lý 2 loại xung đột khi deploy (merge brand → main):
- Conflict nội dung (2 bên cùng sửa 1 đoạn) → `merge3Text` phát hiện, mở `ConflictDialog` cho chọn "ours"/"theirs" (dòng ~262-279).
- `STALE_DATA` (main đã tiến trong lúc fetch/commit) → tự động fetch lại ref mới và retry toàn bộ, tối đa `MAX_STALE_DATA_RETRIES = 5` (dòng ~59, ~325, ~362).

**Thiếu**: nếu `main` được branch-protect, GitHub trả về `BRANCH_PROTECTION_RULE_VIOLATION` — lỗi này **không có case riêng** trong `useDeploy.ts`, rơi vào nhánh lỗi chung, hiện `result.error.message` thô ra toast (không thân thiện, không hướng dẫn xử lý).

So sánh: [updating.tsx:348](packages/drystack/src/app/updating.tsx#L348) (luồng lưu entry, không phải deploy) đã xử lý case này bằng cách chuyển sang state `needs-new-branch` với thông báo rõ ràng.

**Việc cần làm**: thêm case `BRANCH_PROTECTION_RULE_VIOLATION` vào `useDeploy.ts`, tương tự cách `updating.tsx` xử lý — có thể chuyển sang `needs-new-branch` hoặc thông báo rõ cho người dùng thay vì hiện lỗi thô.

_Ghi chú ngày 2026-07-16, xem thêm memory `drystack-vei-save-merge-deploy`._
