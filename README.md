# BMPI - Sistema de Asistencia con Reconocimiento Facial

Sistema para registrar automáticamente entradas y salidas de empleados mediante reconocimiento facial.

## Stack objetivo (versión actual)

- **Frontend:** Angular (app web).
- **Backend:** API/servicio de asistencia y reconocimiento facial.
- **IA:** extracción y comparación de vectores faciales.
- **Base de datos:** PostgreSQL.

> Nota: el frontend objetivo ya **no** contempla C# / Windows Forms.

## ¿Cómo funciona?

El sistema conecta tres componentes principales:

1. **Frontend Angular** (interfaz de operación y administración)
2. **Cámara + motor de reconocimiento facial** (captura, detección, extracción y comparación biométrica)
3. **PostgreSQL** (almacenamiento de empleados y asistencias)

## Flujo operativo completo

1. **Captura del empleado frente a cámara**
   - Se toma imagen/video en tiempo real.

2. **Detección de rostro**
   - El sistema verifica si hay una cara visible.
   - En esta fase no se guarda ningún registro de asistencia.

3. **Extracción biométrica**
   - El rostro se convierte en un **vector biométrico** (embedding facial).
   - Este vector es la representación matemática del rostro.

4. **Comparación contra empleados registrados**
   - Se compara el vector capturado contra vectores almacenados.
   - Resultado:
     - ✅ Coincide: empleado identificado.
     - ❌ No coincide: persona no registrada.

5. **Registro automático de asistencia**
   - Si hay coincidencia, se guarda en PostgreSQL:
     - ID de empleado
     - fecha
     - hora exacta
     - tipo de marca (entrada/salida según reglas de horario)

6. **Control de duplicados**
   - Se aplica una ventana de tiempo para evitar múltiples marcas consecutivas del mismo empleado.

## Alta inicial de empleados

Antes de operar en automático, cada empleado debe registrarse:

1. Captura de múltiples imágenes del rostro.
2. Generación del vector facial.
3. Guardado del vector junto con datos administrativos:
   - nombre
   - número de empleado
   - área/departamento
   - estatus (activo/inactivo)

## Modelo de datos (PostgreSQL)

### Empleados
- Datos personales y administrativos.
- Vector biométrico facial.

### Asistencias
- Empleado identificado.
- Fecha.
- Hora.
- Tipo de marca (entrada/salida).

### Registros de sistema (opcional)
- Intentos fallidos.
- Rostros no reconocidos.

## Entorno de ejecución actual

Actualmente el sistema está planteado para ejecutarse en una **PC local dentro de BMPI**:

- Frontend Angular para operación del sistema.
- Cámara conectada directamente al equipo.
- PostgreSQL en la misma máquina.
- Procesamiento y registro en entorno local.

La arquitectura permite migrar después a un servidor interno, cambiando configuración de conexión sin alterar el flujo principal.

## Resumen rápido

📷 La cámara detecta un rostro.

🧠 El sistema lo convierte en vector biométrico.

🔍 Se compara contra empleados registrados.

✅ Si coincide, se registra la asistencia automáticamente.

🗄️ Todo queda almacenado en PostgreSQL.

## Documentación de seguimiento

Para llevar control del avance, pendientes y mejoras del proyecto:

```bash
ESTADO_PROYECTO_BMPI.md
```

## Limpieza del repositorio

Se retiraron componentes legacy de C#/.NET (proyectos de prueba y artefactos compilados) para mantener el repositorio enfocado en la arquitectura actual:

- Frontend Angular
- Backend Go
- IA en Python
- PostgreSQL


## Verificación rápida de IA y Backend

Puedes validar el estado técnico con:

```bash
scripts/verificar_ia_backend.sh
```

Este script comprueba:
- compilación y pruebas del backend Go,
- consistencia del contrato protobuf generado en Go,
- dependencias mínimas de IA en Python (`cv2`, `face_recognition`, `grpc`, `numpy`, `psycopg2`).

## Evaluación empresarial de IA (semáforo)

Para decidir salida a compañía con métricas objetivas (FAR/FRR/latencia/detección):

```powershell
python scripts/evaluar_ia_empresa.py --dataset C:\ruta\dataset --output reports\ia
```

Guía completa y checklist go-live:

- `scripts/GUIA_EVALUACION_IA_EMPRESA.md`
- `scripts/SQL_EMBEDDINGS_POSTGRES.md` (queries rápidas para validar embeddings en PostgreSQL)

Verificación de avance de dataset (sin cámara, sin reconocimiento facial):

```powershell
python scripts/verificar_dataset_empresa.py --dataset C:\ruta\dataset --output reports\ia
```

Verificación de calidad de fotos (detección de blur, luz, rostro pequeño y múltiples rostros):

```powershell
python scripts/verificar_calidad_fotos.py --dataset C:\ruta\dataset --output reports\ia
```

Salida adicional automática:

- `reports/ia/recaptura_fotos_YYYYMMDD_HHMMSS.csv` con lista priorizada de imágenes a recapturar por identidad.

Integración automática en flujo frontend:

- `POST /api/employees/register-photos` ahora evalúa calidad por foto en backend y devuelve `qualityWarnings` en la respuesta (sin bloquear el guardado).
- La UI muestra estas advertencias para recapturar solo las fotos con problemas.

Diagnóstico unificado (avance + calidad + evaluación) en un solo comando:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\diagnostico_dataset_empresa.ps1 -Dataset "datasets/empresa_eval_YYYYMMDD" -UpdatePlanStatus -AllowInsufficientDataset
```

Modo rápido (sin cálculo FAR/FRR):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\diagnostico_dataset_empresa.ps1 -Dataset "datasets/empresa_eval_YYYYMMDD" -UpdatePlanStatus -SkipEvaluation
```

Este comando genera además un resumen:

- `reports/ia/diagnostico_dataset_YYYYMMDD_HHMMSS.json`
- `reports/ia/diagnostico_dataset_YYYYMMDD_HHMMSS.md`

Si además deseas actualizar `capture_plan.csv` con estado sugerido (`completo`/`pendiente`):

```powershell
python scripts/verificar_dataset_empresa.py --dataset C:\ruta\dataset --output reports\ia --update-plan-status
```

Para validar específicamente que no haya drift entre `proto`, `backend/pb` y `backend/vendor/.../pb`:

```bash
scripts/verificar_proto_sync.sh
```

## Variables de entorno recomendadas

### Comunes

- `BMPI_ENV`: `development` o `production`.
- `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`.
- `DB_SSLMODE`: por ejemplo `disable` (local) o `require` (producciÃ³n).

### Backend Go

- `BMPI_ALLOWED_ORIGINS`: lista separada por coma para CORS.
- `BMPI_OPERATOR_API_KEY`: clave para operaciones de asistencia y registro.
- `BMPI_ADMIN_API_KEY`: clave para operaciones administrativas (incluye fotos en storage).
- `BMPI_FACE_GRPC_ADDR`: direcciÃ³n del servicio IA (default `localhost:50051`).
- `BMPI_FACE_GRPC_TLS`: `true/false` para dial gRPC con TLS.
- `BMPI_FACE_GRPC_CA_CERT`: ruta a CA PEM (si TLS habilitado).
- `BMPI_EXTRACT_MODE`: `auto` (default), `batch` o `legacy` para extracción de embeddings.
- `BMPI_EXTRACT_WORKERS`: número de workers para modo `legacy` (default: núcleos CPU).
- `BMPI_REGISTER_PHOTO_WORKERS`: número de workers para `POST /api/employees/register-photos` (default: núcleos CPU).
- `BMPI_GRPC_MAX_MSG_MB`: tamaño máximo de mensaje gRPC en MB para backend↔IA (recomendado: `20`).
- `BMPI_REGISTER_PHOTO_TIMEOUT_MS`: timeout por foto en ms al registrar en IA (recomendado: `12000`).
- `BMPI_REGISTER_PHOTO_RETRIES`: reintentos por foto ante errores transitorios (`Unavailable`/`DeadlineExceeded`), recomendado: `1`.
- `BMPI_REGISTER_PHOTO_RETRY_BACKOFF_MS`: espera entre reintentos por foto en ms, recomendado: `300`.
- `BMPI_QUALITY_MIN_DIMENSION`: tamaño mínimo (ancho/alto) para advertencia de resolución, default `220`.
- `BMPI_QUALITY_BRIGHTNESS_MIN`: brillo mínimo para advertencia de iluminación baja, default `55`.
- `BMPI_QUALITY_BRIGHTNESS_MAX`: brillo máximo para advertencia de iluminación alta, default `210`.
- `BMPI_QUALITY_DETAIL_MIN`: umbral de detalle mínimo para advertencia de posible blur, default `2.5`.
- `BMPI_EMBEDDING_SCRIPT`: ruta explícita de `face_server.py` (opcional si autodetección funciona).

### Recomendación de producción (benchmark final)

- Para el entorno BMPI actual, usar `BMPI_EXTRACT_MODE=legacy`.
- En pruebas finales locales con payloads de 4 y 5 fotos, `legacy` resultó más rápido que `batch` y `auto`.
- Archivos de evidencia de benchmark:
   - `tmp-test-photos/benchmark_modes_result.json`
   - `tmp-test-photos/benchmark_modes_result_5photos.json`

### Servicio IA (Python)

- `BMPI_GRPC_TLS`: `true/false` para exponer gRPC con TLS.
- `BMPI_GRPC_CERT_FILE`, `BMPI_GRPC_KEY_FILE`: rutas de certificado y llave PEM.
- `BMPI_FACE_MODEL`, `BMPI_EMBEDDINGS_REFRESH_SECONDS`, `BMPI_GRPC_WORKERS`.
- `BMPI_FACE_THRESHOLD`: umbral de reconocimiento (menor = más estricto, mayor = más tolerante). Recomendado inicial: `0.55`.
- `BMPI_FACE_DETECT_UPSAMPLE`: detalle base de detección de rostro (default `1`).
- `BMPI_FACE_DETECT_RETRY_UPSAMPLE`: reintento automático con mayor detalle cuando una foto no detecta rostro (recomendado `2`).
- `BMPI_FACE_ENCODE_CONCURRENCY`: concurrencia interna de codificación facial (`face_recognition`), recomendado `1` para máxima estabilidad.

## Script maestro (dev + producción)

Para ahorrar tiempo y arrancar todo con un solo comando (IA + backend + frontend):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode dev
```

Antes de dev (recomendado):

```powershell
Copy-Item scripts/.env.dev.example scripts/.env.dev
```

Luego edita `scripts/.env.dev` y define al menos `DB_PASSWORD` para que el servicio IA pueda iniciar.

Producción:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode prod
```

Detener servicios (recomendado al terminar):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode all
```

Opcional por entorno:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode dev
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode prod
```

Opciones útiles:

- `-AutoPrepareIA`: crea/actualiza `.venv` automáticamente si falta.
- `-SkipInstall`: en dev evita `npm install`.
- `-SkipBuild`: en producción evita recompilar frontend SSR.
- `-SkipFrontend`, `-SkipBackend`, `-SkipIA`: arranque parcial según necesidad.
- `-NoHealthCheck`: arranca sin esperar validaciones de puertos/endpoints.

Preparación para producción:

1. Crear archivo real de entorno:

```powershell
Copy-Item scripts/.env.production.example scripts/.env.production
```

2. Editar `scripts/.env.production` con claves y credenciales reales.

3. Ejecutar:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode prod
```

Notas:

- El frontend en producción usa `attendance-web/src/server.ts` para reenviar `/api/*` al backend vía `BMPI_API_BASE_URL`.
- `ng serve` y `proxy.conf.json` quedan para desarrollo; en producción se usa build SSR + Node.
