# Cierre tecnico BMPI - 2026-03-05

## Alcance cerrado hoy

1. Frontend con modo de reconocimiento en entrada caminando (rafaga + votacion).
2. Autenticacion por login con roles (sin API key en frontend).
3. Backend con bloqueo configurable de fotos de baja calidad al registrar.
4. Checklist de go-live + rollback documentado.

## Evidencia tecnica

- Frontend tests: OK (`ng test --watch=false`).
- Frontend build: OK (`ng build`).
- Backend compile/tests: OK (`go test ./...`).
- Smoke API:
  - `GET /api/attendance` -> `200`.
  - `POST /api/attendance/recognize-burst` -> `recognized=true`, `attendanceLogged=true`.
  - Seguridad en produccion:
    - `GET /api/attendance` sin token -> `401`.
    - `GET /api/attendance` con token valido -> `200`.

## Estado de cifrado en transito (actual)

- Backend <-> IA (gRPC): **TLS activo**.
- Auto-gestion TLS: en cada `iniciar_bmpi.ps1 -Mode prod` se valida certificado; si falta, vence pronto o cambia SAN/host, se regenera automaticamente (`scripts/ensure_tls_certs.py`).
- Frontend SSR -> Backend API local: protegido por token de usuario; se recomienda HTTPS en borde para red externa.
- Backend/IA -> PostgreSQL: **sin TLS** en este host local, porque el servicio PostgreSQL actual no soporta SSL habilitado.
  - Configuracion estable aplicada: `DB_SSLMODE=disable`.
  - Para cifrar DB en transito: habilitar SSL en PostgreSQL y luego pasar a `DB_SSLMODE=require` (ideal `verify-full`).

## Configuracion recomendada inicial (entrada real)

- `burstFrameCount=4`
- `burstFrameDelayMs=220`
- `minVotes=2`
- `minConfidence=0.35`

## Pendiente para cierre final empresarial

1. Prueba de campo 1-2 dias en punto de acceso.
2. Congelar parametros finales por sede/camara.
3. Cerrar objetivo FRR/FAR con muestra real de operacion.
