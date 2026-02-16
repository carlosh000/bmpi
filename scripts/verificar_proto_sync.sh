#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

PROTO_FILE="$ROOT_DIR/backend/proto/face_recognition.proto"
PB_FILE="$ROOT_DIR/backend/pb/face_recognition.pb.go"
PB_GRPC_FILE="$ROOT_DIR/backend/pb/face_recognition_grpc.pb.go"
VENDOR_PB_FILE="$ROOT_DIR/backend/vendor/github.com/example/face-attendance/backend/pb/face_recognition.pb.go"
VENDOR_GRPC_FILE="$ROOT_DIR/backend/vendor/github.com/example/face-attendance/backend/pb/face_recognition_grpc.pb.go"

required_proto_lines=(
  "rpc ListEmployees (Empty) returns (EmployeeList);"
  "message Empty {}"
  "string employee_id = 1;"
)

for line in "${required_proto_lines[@]}"; do
  if ! grep -Fq "$line" "$PROTO_FILE"; then
    echo "❌ Proto desalineado: falta línea '$line' en $PROTO_FILE"
    exit 1
  fi
done

cmp -s "$PB_FILE" "$VENDOR_PB_FILE" || {
  echo "❌ Drift detectado: backend/pb/face_recognition.pb.go != vendor copy"
  exit 1
}

cmp -s "$PB_GRPC_FILE" "$VENDOR_GRPC_FILE" || {
  echo "❌ Drift detectado: backend/pb/face_recognition_grpc.pb.go != vendor copy"
  exit 1
}

echo "✅ Contrato proto/pb/vendor alineado."
