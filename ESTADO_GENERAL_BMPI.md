# ESTADO GENERAL BMPI

Última actualización: 2026-02-19

Este documento unifica el contenido de análisis, inspección, estado y versión final del proyecto BMPI en una sola fuente de verdad.

## 1) Resumen ejecutivo

El proyecto ya tiene una base funcional real para operar:

- Frontend Angular operativo para gestión de asistencia y flujo de embeddings.
- Backend Go con bridge REST y conexión a servicio IA por gRPC.
- Servicio IA Python (`face_server.py`) activo para registro y reconocimiento facial.
- Persistencia en PostgreSQL para empleados, embeddings, fotos y asistencias.

Se completó integración real entre frontend/backend/IA/DB para el flujo de registro por empleado con 5 a 10 fotos y confirmación de guardado.

## 2) Arquitectura vigente

- Frontend: Angular (`attendance-web`)
- Backend: Go (`backend`)
- IA facial: Python (`ml-model`)
- Base de datos: PostgreSQL
- Contrato de servicios: gRPC + protobuf, con bridge REST para UI

## 3) Avances completados

### 3.1 Integración y funcionalidades

- Endpoint real de extracción de embeddings (backend invoca Python y parsea JSON de salida).
- Registro de empleados por fotos en lote con una sola identidad por carpeta/empleado.
- Regla de precisión activa: se aceptan únicamente lotes entre 5 y 10 fotos por empleado.
- Persistencia de embeddings y foto en DB, con consulta de almacenamiento desde frontend.
- Carga de empleados desde DB y visualización en UI.
- Confirmación en UI de guardado en base de datos.

### 3.2 Servicio IA (Python)

- `face_server.py` quedó como servicio principal.
- `face_recognition_service.py` quedó como wrapper legado.
- Registro incremental por empleado usando promedio de embeddings y `samples_count`.
- Refresh periódico de cache de embeddings en memoria.
- Manejo thread-safe del cache para operación concurrente.
- Ajustes para robustez de conexiones DB (uso seguro de pool y cierre correcto).
- Reconocimiento mejorado para considerar múltiples caras detectadas en una imagen y elegir el mejor match.

### 3.3 Backend Go

- REST bridge activo en `:8080`.
- gRPC server activo en `:50052`.
- Integración con servicio IA en `:50051`.
- Endpoints relevantes:
  - `GET /api/attendance`
  - `POST /api/attendance`
  - `POST /api/embeddings/extract`
  - `GET /api/employees`
  - `POST /api/employees/register-photos`
  - `GET /api/employees/storage`

### 3.4 Frontend Angular

- Flujo de carpeta de fotos para extracción.
- Asignación de ID de empleado y guardado por lote.
- Mensajes/toasts de éxito y error.
- CRUD de asistencia con persistencia local + sincronización.
- Importación/exportación (CSV/PDF) en módulo de asistencia.

### 3.5 Scripts operativos agregados

- `scripts/verificar_proto_sync.sh`
- `scripts/verificar_ia_backend.sh`
- `scripts/sync_backend_vendor.sh`
- `scripts/sync_backend_vendor.ps1`
- `scripts/verificar_registro_fotos.ps1` (prueba automática 5 fotos PASS + 4 fotos FAIL)
- `scripts/iniciar_angular.ps1` (ajuste PATH Node + instalación + arranque Angular)

## 4) Verificación reciente ejecutada

Resultados confirmados:

- Frontend:
  - `ng test --watch=false` en verde.
  - `ng build` en verde.
- Backend Go:
  - `go test -mod=mod ./...` en verde (compilación OK).
- Integración funcional:
  - Flujo 5 fotos por empleado procesa correctamente.
  - Flujo 4 fotos falla correctamente por regla de precisión.
  - Persistencia validada vía API de storage (`embedding_bytes`, `photo_bytes` > 0).

## 5) Evaluación de la IA actual (para jornada laboral)

Estado actual: **apta para piloto/controlado** y con base sólida para operación continua, con estas consideraciones:

Fortalezas:

- Comparación vectorizada eficiente (1:N).
- Cache en memoria de embeddings.
- Control anti-duplicado en asistencias (ventana temporal).
- Acumulación de muestras por empleado para mejorar estabilidad de reconocimiento.

Límites actuales:

- El contrato de respuesta todavía retorna una sola coincidencia final por solicitud.
- Para escenarios de entrada masiva (varias personas simultáneas en una toma) se requiere ampliar proto + backend + frontend a respuesta múltiple.

## 6) Qué mejorar (priorizado)

### Prioridad alta

1. Implementar reconocimiento multipersona de extremo a extremo:
   - nuevo RPC/endpoint de resultados múltiples,
   - registro de varias asistencias en un solo frame.
2. Calibrar umbral de reconocimiento con datos reales del sitio (FAR/FRR).
3. Añadir health checks y métricas operativas (latencia, errores, tasa de reconocimiento).

### Prioridad media

1. Estandarizar despliegue con `docker-compose`.
2. Definir `.env.example` completo y política de configuración por entorno.
3. Consolidar estrategia de migraciones versionadas de DB.

### Prioridad baja

1. Reportes avanzados de asistencia por turno/área.
2. Tablero de monitoreo y alertas operativas.

## 7) Riesgos vigentes

- Riesgo de deriva de contrato si no se automatiza generación protobuf en CI.
- Riesgo operativo en producción sin observabilidad mínima (métricas + healthcheck).
- Riesgo funcional en entradas masivas hasta implementar respuesta multipersona completa.

## 8) Pendientes por checar

- Prueba de campo con cámara real en condiciones variables de iluminación.
- Prueba de carga (concurrencia de solicitudes de reconocimiento).
- Validación de precisión por sede/cámara y ajuste fino de `THRESHOLD`.
- Confirmación de estrategia final de despliegue 24/7 (servicios, reinicios, logs).

## 9) Criterio de versión base

La base actual del repositorio se considera estable para continuar mejoras.
Las siguientes implementaciones deben tomar este documento como referencia oficial de estado.

## 10) Avances de operación (2026-02-19)

Se completó estabilización operativa de arranque y apagado para trabajo diario en VS Code y ejecución repetitiva sin fallos.

### 10.1 Start/Stop unificado

- Script maestro único de arranque: `scripts/iniciar_bmpi.ps1` (`dev` / `prod`).
- Script dedicado de apagado: `scripts/detener_bmpi.ps1` (`dev` / `prod` / `all`).
- Variables de entorno de desarrollo formalizadas en `scripts/.env.dev` y `scripts/.env.dev.example`.
- Validación explícita de `DB_PASSWORD` en desarrollo para evitar bloqueos silenciosos de IA.

### 10.2 Robustez de apagado (idempotencia)

- Se eliminó lógica agresiva de kill por patrones amplios.
- Se implementó estado runtime por PID en `scripts/.bmpi-runtime.json`.
- `iniciar_bmpi.ps1` registra PIDs de terminales/procesos levantados.
- `detener_bmpi.ps1` detiene primero por estado runtime y después por puertos objetivo.
- Stop repetido (sin procesos activos) responde limpio sin error.

### 10.3 Flujo VS Code (1 click)

- Configuración de lanzamiento y tareas orientada a ejecución por terminal (`node-terminal` / `tasks`) para evitar dependencia del depurador PowerShell.
- Runbook operativo en README con comandos de `start` y `stop`.

### 10.4 Verificación ejecutada

- Ciclos validados: `Start -> Stop`, `Start -> Stop`, `Stop` adicional inmediato.
- Con frontend activo: respuesta `200` en `http://localhost:4200/`.
- Backend activo: respuesta `200` en `http://localhost:8080/api/attendance`.
- Proxy frontend->backend activo: `200` en `http://localhost:4200/api/attendance`.
- Post-stop: puertos `4200`, `8080` y `50051` sin listeners activos.
