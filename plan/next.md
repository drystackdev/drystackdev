# Việc cần làm

_(trống)_

## Đã xong

### `BRANCH_PROTECTION_RULE_VIOLATION` trong luồng Deploy (github mode) — 2026-07-17

Đã thêm case riêng vào [useDeploy.ts](packages/drystack/src/app/deploy/useDeploy.ts):
khi `main` được branch-protect, thay vì hiện `result.error.message` thô ra toast,
deploy dừng lại với thông báo tiếng Việt rõ ràng kèm link `compare/main...<brand>?expand=1`
để người dùng mở pull request bằng tay. [DeployButton.tsx](packages/drystack/src/app/deploy/DeployButton.tsx)
hiện toast này không có timeout (có nút "Mở pull request"), khác với toast lỗi thường (6s).

Không dùng `needs-new-branch` như [updating.tsx](packages/drystack/src/app/updating.tsx#L353):
ở deploy, brand **đã là** nhánh riêng và `main` là đích duy nhất — tạo nhánh mới không giải quyết gì.

**Chưa kiểm chứng trên browser** (cần một repo có branch protection thật ở github mode).
