#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:-origin}"
BASE_BRANCH="${2:-main}"
MODE="${3:-safe}" # safe | push-only
CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if [[ "${CURRENT_BRANCH}" == "HEAD" ]]; then
  echo "Error: detached HEAD. Checkout your working branch first." >&2
  exit 1
fi

if ! git remote get-url "${REMOTE}" >/dev/null 2>&1; then
  echo "Error: remote '${REMOTE}' is not configured." >&2
  echo "Tip: git remote add ${REMOTE} <repo-url>" >&2
  exit 1
fi

echo "[1/5] Fetching ${REMOTE}..."
git fetch "${REMOTE}"

echo "[2/5] Rebasing ${CURRENT_BRANCH} onto ${REMOTE}/${BASE_BRANCH} (auto strategy: -X theirs)..."
set +e
git rebase -X theirs "${REMOTE}/${BASE_BRANCH}"
REB_EXIT=$?
set -e

if [[ ${REB_EXIT} -ne 0 ]]; then
  echo
  echo "Rebase stopped due to conflicts. Quick fallback to keep your branch changes:" 
  echo "  git checkout --theirs attendance-web/src/app/attendance-list.component.ts attendance-web/src/app/attendance.service.ts backend/main.go || true"
  echo "  git add . && git rebase --continue"
  echo "Repeat until rebase finishes, then rerun this script."
  exit ${REB_EXIT}
fi

if [[ "${MODE}" == "safe" ]]; then
  echo "[3/5] Running frontend build..."
  (
    cd attendance-web
    npm run build
  )

  echo "[4/5] Running backend tests..."
  (
    cd backend
    go test ./...
  )
else
  echo "[3/5] push-only mode: skipping build/tests as requested."
fi

echo "[5/5] Pushing branch with force-with-lease..."
git push --force-with-lease "${REMOTE}" "${CURRENT_BRANCH}"

echo "Done. Branch '${CURRENT_BRANCH}' is synced and pushed."
