#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:-origin}"
BASE_BRANCH="${2:-main}"
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

echo "[1/6] Fetching ${REMOTE}..."
git fetch "${REMOTE}"

echo "[2/6] Rebasing ${CURRENT_BRANCH} onto ${REMOTE}/${BASE_BRANCH}..."
set +e
git rebase "${REMOTE}/${BASE_BRANCH}"
REB_EXIT=$?
set -e

if [[ ${REB_EXIT} -ne 0 ]]; then
  echo
  echo "Rebase stopped due to conflicts. Resolve files, then run:"
  echo "  git add <resolved-files>"
  echo "  git rebase --continue"
  echo "When finished, rerun this script."
  exit ${REB_EXIT}
fi

echo "[3/6] Running frontend build..."
(
  cd attendance-web
  npm run build
)

echo "[4/6] Running backend tests..."
(
  cd backend
  go test ./...
)

echo "[5/6] Pushing branch with force-with-lease..."
git push --force-with-lease "${REMOTE}" "${CURRENT_BRANCH}"

echo "[6/6] Done. Branch '${CURRENT_BRANCH}' is synced and pushed."
