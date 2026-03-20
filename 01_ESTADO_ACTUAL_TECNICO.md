# 01 ESTADO ACTUAL TECNICO - BMPI

Fecha de corte tecnico: 2026-03-19
Repositorio: `c:\Users\practicante\Desktop\bmpi-main`

## 1. Arquitectura vigente

Componentes:

1. Frontend Angular (`attendance-web`)
2. Backend Go (`backend/main.go`)
3. Servicio IA gRPC en Python (`ml-model/face_server.py`)
4. Base de datos PostgreSQL

Flujo general:

1. Usuario opera desde UI Angular.
2. UI consume API REST del backend (`/api/...`).
3. Backend aplica reglas de negocio, autenticacion y autorizacion por rol.
4. Para biometria, backend llama al servicio IA por gRPC (`127.0.0.1:50051` por defecto).
5. Backend/IA persisten en PostgreSQL (empleados, embeddings, asistencias, auth).

## 2. Estructura de carpetas relevante

- `attendance-web/`: frontend Angular.
- `backend/`: API Go + bridge gRPC + auth + reglas de asistencia.
- `ml-model/`: servidor IA Python + protobuf Python.
- `scripts/`: operacion (start/stop/smoke/diagnostico/evaluacion).
- `datasets/`: datasets de evaluacion/captura.
- `reports/`: salidas de evaluaciones y diagnosticos.

Estructura frontend aplicada en este cierre (para reducir saturacion del componente principal):

- `attendance-web/src/app/core/dto/`: contratos tipados de dominio (auth, attendance, employee, recognition).
- `attendance-web/src/app/core/helpers/`: helpers reutilizables (token/auth y parseo de errores HTTP).
- `attendance-web/src/app/shared/ui/`: componentes reutilizables de UI (actualmente `ui-button`).
- `attendance-web/src/app/attendance-list.component.*`: se mantiene como contenedor principal de flujo, consumiendo DTOs/helpers/shared UI.

## 3. Estado funcional por componente

### 3.1 Frontend (`attendance-web`)

Disponible y funcional:

- Login y sesion con token.
- Vista principal de asistencias.
- Registro manual de asistencia.
- Extraccion/registro por fotos por empleado.
- Reconocimiento de entrada por rafaga.
- Vista de cuenta y cambio de password.
- Administracion de usuarios/roles (solo admin).
- Exportaciones CSV/PDF.

Referencia principal:

- `attendance-web/src/app/attendance-list.component.ts`
- `attendance-web/src/app/attendance.service.ts`

### 3.2 Backend (`backend/main.go`)

Disponible y funcional:

- API REST en `:8080`.
- gRPC server en `:50052` (bridge/servicio backend).
- Cliente gRPC hacia IA (`BMPI_FACE_GRPC_ADDR`, default `127.0.0.1:50051`).
- Reglas de negocio de asistencia (duplicados por dia, validaciones de fecha/hora).
- Auth con sesiones token y bloqueo por intentos.
- Bootstrap de usuario admin inicial por variables de entorno.

Endpoints principales detectados:

- `GET /api/attendance`
- `POST /api/attendance`
- `PUT /api/attendance/{row_id}`
- `DELETE /api/attendance/{row_id}`
- `POST /api/attendance/recognize-burst`
- `POST /api/embeddings/extract`
- `GET /api/employees`
- `DELETE /api/employees?employee_id=...`
- `GET /api/employees/storage`
- `POST /api/employees/register-photos`
- `POST /api/auth/login`
- `GET /api/auth/me`
- `POST /api/auth/refresh`
- `POST /api/auth/password`
- `POST /api/auth/logout`
- `GET/POST/PUT /api/auth/users`

### 3.3 IA (`ml-model/face_server.py`)

Disponible y funcional:

- Servicio gRPC para `RegisterEmployee`, `RecognizeFace`, `LogAttendance`, `ListEmployees`.
- Extraccion de embeddings con fallback de deteccion y robustez de imagen.
- Cache de embeddings en memoria y refresh periodico.
- Opcion de aceleracion con FAISS (si esta disponible).
- Control por multiples variables `BMPI_*` para threshold y rendimiento.

Observacion funcional:

- El flujo actual esta orientado a devolver una identidad final por solicitud de reconocimiento.
- Para escenario multipersona simultaneo, se requiere ampliacion de contrato y flujo end-to-end.

## 4. Base de datos y esquema

### 4.1 Entidades funcionales observadas

Desde backend/IA se usan y/o aseguran tablas:

- `employees`
- `attendance`
- `users`
- `auth_sessions`
- `auth_audit`

### 4.2 Reglas relevantes en BD

- `attendance` maneja unicidad por empleado/dia local con indice:
  - `ux_attendance_employee_day_mx`
  - basado en zona `America/Mexico_City`.
- Backend asegura columna `attendance.name` cuando falta.
- IA asegura columnas en `employees` (incluye `embedding`, `photo`, `samples_count`).

## 5. Seguridad y roles

Roles detectados:

- `admin`
- `operator`
- `vigilante`
- `rh`
- `jefe`

Resumen de permisos (alto nivel):

- `admin`: gestion total + usuarios/roles.
- `operator`: registro manual, registro de fotos.
- `rh`: extraccion y reconocimiento de entrada por rafaga.
- `jefe`: consulta de asistencias/empleados.
- `vigilante`: accesos operativos segun UI/backend.

## 6. Variables de entorno criticas

Archivos base:

- Desarrollo: `scripts/.env.dev` (ejemplo `scripts/.env.dev.example`)
- Produccion: `scripts/.env.production` (ejemplo `scripts/.env.production.example`)

Minimo para operar:

- `BMPI_ENV`
- `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSLMODE`
- `BMPI_FACE_GRPC_ADDR`
- `BMPI_BOOTSTRAP_ADMIN_USER`, `BMPI_BOOTSTRAP_ADMIN_PASS`

Recomendadas para estabilidad biometrica:

- `BMPI_FACE_THRESHOLD`
- `BMPI_FACE_MODEL`, `BMPI_FACE_MODEL_FALLBACK`
- `BMPI_FACE_DETECT_RETRY_UPSAMPLE`
- `BMPI_FACE_ENCODING_JITTERS_REGISTER`
- `BMPI_RECOGNIZE_BURST_*`
- `BMPI_QUALITY_*`

## 7. Como levantar el proyecto

### 7.1 Desarrollo local

Comando recomendado:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode dev
```

Esperado:

- IA gRPC: `localhost:50051`
- Backend REST: `localhost:8080`
- Frontend Angular: `localhost:4200` (o siguiente puerto disponible)

Parar stack:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode dev
```

### 7.2 Produccion local controlada

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode prod
```

Checklist rapido:

- `scripts/CHECKLIST_GO_LIVE_RAPIDO.md`

## 8. Estado de validacion actual (ejecutado en este corte)

Ejecucion realizada el 2026-03-19:

1. Backend build/check:
   - `go test ./...` en `backend`.
   - Resultado: OK (`[no test files]`, compilacion valida).

2. Frontend build:
   - `npm run build` en `attendance-web`.
   - Resultado: OK.

3. Frontend pruebas:
   - `npm run test -- --watch=false` en `attendance-web`.
   - Resultado: OK, 2 tests pasando.

Nota operativa:

- En sandbox restringido aparecio `spawn EPERM`; al ejecutar fuera de sandbox, build/test corrieron correctamente.

## 9. Estado de deuda tecnica

Abierto:

1. Pruebas automatizadas de backend casi inexistentes (solo compilacion).
2. Falta observabilidad formal (metricas/health endpoints dedicados/alertas).
3. Falta estrategia formal de migraciones versionadas de BD.
4. Falta validacion estadistica final de precision en campo real (FAR/FRR final por camara/sede).
5. Falta plan de despliegue 24/7 con runbook de incidentes y respaldo operativo.

## 10. Estado recomendado para traspaso

Este repositorio esta en un estado util para continuidad inmediata. El siguiente responsable puede iniciar por:

1. Levantar con `scripts/iniciar_bmpi.ps1`.
2. Validar login y flujo de asistencia + reconocimiento.
3. Ejecutar plan de cierre operativo de `02_PENDIENTES_Y_PLAN_DE_CIERRE.md`.
4. Aplicar runbook de `03_OPERACION_Y_SOPORTE.md`.
