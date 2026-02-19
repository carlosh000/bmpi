#!/usr/bin/env bash
set -euo pipefail

# Uso:
#   scripts/publicar_github.sh https://github.com/USUARIO/REPO.git [rama]
# Ejemplo:
#   scripts/publicar_github.sh https://github.com/juan/bmpi.git work

REMOTE_URL="${1:-}"
BRANCH="${2:-work}"

if [[ -z "$REMOTE_URL" ]]; then
  echo "❌ Falta la URL del repo remoto."
  echo "Uso: scripts/publicar_github.sh https://github.com/USUARIO/REPO.git [rama]"
  exit 1
fi

current_branch="$(git branch --show-current)"
if [[ "$current_branch" != "$BRANCH" ]]; then
  echo "ℹ️ Cambiando de rama '$current_branch' a '$BRANCH'..."
  git checkout "$BRANCH"
fi

if git remote get-url origin >/dev/null 2>&1; then
  git remote set-url origin "$REMOTE_URL"
  echo "✅ origin actualizado: $REMOTE_URL"
else
  git remote add origin "$REMOTE_URL"
  echo "✅ origin agregado: $REMOTE_URL"
fi

echo "ℹ️ Subiendo rama '$BRANCH'..."
git push -u origin "$BRANCH"

echo "✅ Listo. Tus cambios ya quedaron en GitHub (rama: $BRANCH)."
