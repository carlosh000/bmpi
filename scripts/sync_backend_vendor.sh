#!/usr/bin/env bash
set -euo pipefail

BACKEND_PATH="${1:-../backend}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TARGET_PATH="$(cd "$SCRIPT_DIR/$BACKEND_PATH" && pwd)"

cd "$TARGET_PATH"
go mod tidy
go mod vendor
go test ./...
echo "✅ Vendor sincronizado y backend validado en $TARGET_PATH"
