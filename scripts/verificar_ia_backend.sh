#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "== Verificando backend (Go) =="
(
  cd "$ROOT_DIR/backend"
  go build ./...
  go test ./...
)

echo "== Verificando consistencia protobuf (Go) =="
PB_FILE="$ROOT_DIR/backend/pb/face_recognition.pb.go"
if ! rg -q 'EmployeeId string' "$PB_FILE"; then
  echo "ERROR: face_recognition.pb.go no tiene EmployeeId como string"
  exit 1
fi
if ! rg -q 'Image      \[]byte' "$PB_FILE"; then
  echo "ERROR: face_recognition.pb.go no tiene campo Image []byte"
  exit 1
fi
if rg -q 'Email      string' "$PB_FILE"; then
  echo "ERROR: face_recognition.pb.go todavía tiene el campo Email heredado"
  exit 1
fi

echo "== Verificando dependencias mínimas de IA (Python) =="
python3 - <<'PY'
import importlib
mods=["cv2","face_recognition","grpc","numpy","psycopg2"]
missing=[]
for m in mods:
    try:
        importlib.import_module(m)
        print(f"OK {m}")
    except Exception as e:
        print(f"MISSING {m}: {e}")
        missing.append(m)
if missing:
    raise SystemExit(2)
PY

echo "== Resultado =="
echo "Backend + IA listos para ejecutar en este entorno."
