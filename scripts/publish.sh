#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

publish_package() {
  local dir="$1"
  local name="$2"

  echo ""
  echo "==> Building $name..."
  (cd "$ROOT/$dir" && bun run build)

  read -rp "Enter current npm OTP to publish $name: " otp
  echo "==> Publishing $name..."
  (cd "$ROOT/$dir" && bun publish --access public --otp="$otp")
}

publish_package "packages/drystack" "@drystack/core"
publish_package "packages/astro" "@drystack/astro"

echo ""
echo "Done. Both packages published."
