# ESTADO GENERAL BMPI

Ãšltima actualizaciÃ³n: 2026-03-13

Este documento unifica el contenido de anÃ¡lisis, inspecciÃ³n, estado y versiÃ³n final del proyecto BMPI en una sola fuente de verdad.

## 1) Resumen ejecutivo

El proyecto ya tiene una base funcional real para operar:

- Frontend Angular operativo para gestiÃ³n de asistencia y flujo de embeddings.
- Backend Go con bridge REST y conexiÃ³n a servicio IA por gRPC.
- Servicio IA Python (`face_server.py`) activo para registro y reconocimiento facial.
- Persistencia en PostgreSQL para empleados, embeddings, fotos y asistencias.

Se completÃ³ integraciÃ³n real entre frontend/backend/IA/DB para el flujo de registro por empleado con 5 a 10 fotos y confirmaciÃ³n de guardado.

## 2) Arquitectura vigente

- Frontend: Angular (`attendance-web`)
- Backend: Go (`backend`)
- IA facial: Python (`ml-model`)
- Base de datos: PostgreSQL
- Contrato de servicios: gRPC + protobuf, con bridge REST para UI

## 3) Avances completados

### 3.1 IntegraciÃ³n y funcionalidades

- Endpoint real de extracciÃ³n de embeddings (backend invoca Python y parsea JSON de salida).
- Registro de empleados por fotos en lote con una sola identidad por carpeta/empleado.
- Regla de precisiÃ³n activa: se aceptan Ãºnicamente lotes entre 5 y 10 fotos por empleado.
- Persistencia de embeddings y foto en DB, con consulta de almacenamiento desde frontend.
- Carga de empleados desde DB y visualizaciÃ³n en UI.
- ConfirmaciÃ³n en UI de guardado en base de datos.

### 3.2 Servicio IA (Python)

- `face_server.py` quedÃ³ como servicio principal.
- `face_recognition_service.py` quedÃ³ como wrapper legado.
- Registro incremental por empleado usando promedio de embeddings y `samples_count`.
- Refresh periÃ³dico de cache de embeddings en memoria.
- Manejo thread-safe del cache para operaciÃ³n concurrente.
- Ajustes para robustez de conexiones DB (uso seguro de pool y cierre correcto).
- Reconocimiento mejorado para considerar mÃºltiples caras detectadas en una imagen y elegir el mejor match.

### 3.3 Backend Go

- REST bridge activo en `:8080`.
- gRPC server activo en `:50052`.
- IntegraciÃ³n con servicio IA en `:50051`.
- Endpoints relevantes:
  - `GET /api/attendance`
  - `POST /api/attendance`
  - `POST /api/embeddings/extract`
  - `GET /api/employees`
  - `POST /api/employees/register-photos`
  - `GET /api/employees/storage`

### 3.4 Frontend Angular

- Flujo de carpeta de fotos para extracciÃ³n.
- AsignaciÃ³n de ID de empleado y guardado por lote.
- Mensajes/toasts de Ã©xito y error.
- CRUD de asistencia con persistencia local + sincronizaciÃ³n.
- ImportaciÃ³n/exportaciÃ³n (CSV/PDF) en mÃ³dulo de asistencia.

### 3.5 Scripts operativos agregados

- `scripts/verificar_proto_sync.sh`
- `scripts/verificar_ia_backend.sh`
- `scripts/sync_backend_vendor.sh`
- `scripts/sync_backend_vendor.ps1`
- `scripts/verificar_registro_fotos.ps1` (prueba automÃ¡tica 5 fotos PASS + 4 fotos FAIL)
- `scripts/iniciar_angular.ps1` (ajuste PATH Node + instalaciÃ³n + arranque Angular)

## 4) VerificaciÃ³n reciente ejecutada

Resultados confirmados:

- Frontend:
  - `ng test --watch=false` en verde.
  - `ng build` en verde.
- Backend Go:
  - `go test -mod=mod ./...` en verde (compilaciÃ³n OK).
- IntegraciÃ³n funcional:
  - Flujo 5 fotos por empleado procesa correctamente.
  - Flujo 4 fotos falla correctamente por regla de precisiÃ³n.
  - Persistencia validada vÃ­a API de storage (`embedding_bytes`, `photo_bytes` > 0).

## 5) EvaluaciÃ³n de la IA actual (para jornada laboral)

Estado actual: **apta para piloto/controlado** y con base sÃ³lida para operaciÃ³n continua, con estas consideraciones:

Fortalezas:

- ComparaciÃ³n vectorizada eficiente (1:N).
- Cache en memoria de embeddings.
- Control anti-duplicado en asistencias (ventana temporal).
- AcumulaciÃ³n de muestras por empleado para mejorar estabilidad de reconocimiento.

LÃ­mites actuales:

- El contrato de respuesta todavÃ­a retorna una sola coincidencia final por solicitud.
- Para escenarios de entrada masiva (varias personas simultÃ¡neas en una toma) se requiere ampliar proto + backend + frontend a respuesta mÃºltiple.

## 6) QuÃ© mejorar (priorizado)

### Prioridad alta

1. Implementar reconocimiento multipersona de extremo a extremo:
   - nuevo RPC/endpoint de resultados mÃºltiples,
   - registro de varias asistencias en un solo frame.
2. Calibrar umbral de reconocimiento con datos reales del sitio (FAR/FRR).
3. AÃ±adir health checks y mÃ©tricas operativas (latencia, errores, tasa de reconocimiento).

### Prioridad media

1. Estandarizar despliegue con `docker-compose`.
2. Definir `.env.example` completo y polÃ­tica de configuraciÃ³n por entorno.
3. Consolidar estrategia de migraciones versionadas de DB.

### Prioridad baja

1. Reportes avanzados de asistencia por turno/Ã¡rea.
2. Tablero de monitoreo y alertas operativas.

## 7) Riesgos vigentes

- Riesgo de deriva de contrato si no se automatiza generaciÃ³n protobuf en CI.
- Riesgo operativo en producciÃ³n sin observabilidad mÃ­nima (mÃ©tricas + healthcheck).
- Riesgo funcional en entradas masivas hasta implementar respuesta multipersona completa.

## 8) Pendientes por checar

- Prueba de campo con cÃ¡mara real en condiciones variables de iluminaciÃ³n.
- Prueba de carga (concurrencia de solicitudes de reconocimiento).
- ValidaciÃ³n de precisiÃ³n por sede/cÃ¡mara y ajuste fino de `THRESHOLD`.
- ConfirmaciÃ³n de estrategia final de despliegue 24/7 (servicios, reinicios, logs).

## 9) Criterio de versiÃ³n base

La base actual del repositorio se considera estable para continuar mejoras.
Las siguientes implementaciones deben tomar este documento como referencia oficial de estado.

## 10) Avances de operaciÃ³n (2026-02-19)

Se completÃ³ estabilizaciÃ³n operativa de arranque y apagado para trabajo diario en VS Code y ejecuciÃ³n repetitiva sin fallos.

### 10.1 Start/Stop unificado

- Script maestro Ãºnico de arranque: `scripts/iniciar_bmpi.ps1` (`dev` / `prod`).
- Script dedicado de apagado: `scripts/detener_bmpi.ps1` (`dev` / `prod` / `all`).
- Variables de entorno de desarrollo formalizadas en `scripts/.env.dev` y `scripts/.env.dev.example`.
- ValidaciÃ³n explÃ­cita de `DB_PASSWORD` en desarrollo para evitar bloqueos silenciosos de IA.

### 10.2 Robustez de apagado (idempotencia)

- Se eliminÃ³ lÃ³gica agresiva de kill por patrones amplios.
- Se implementÃ³ estado runtime por PID en `scripts/.bmpi-runtime.json`.
- `iniciar_bmpi.ps1` registra PIDs de terminales/procesos levantados.
- `detener_bmpi.ps1` detiene primero por estado runtime y despuÃ©s por puertos objetivo.
- Stop repetido (sin procesos activos) responde limpio sin error.

### 10.3 Flujo VS Code (1 click)

- ConfiguraciÃ³n de lanzamiento y tareas orientada a ejecuciÃ³n por terminal (`node-terminal` / `tasks`) para evitar dependencia del depurador PowerShell.
- Runbook operativo en README con comandos de `start` y `stop`.

### 10.4 VerificaciÃ³n ejecutada

- Ciclos validados: `Start -> Stop`, `Start -> Stop`, `Stop` adicional inmediato.
- Con frontend activo: respuesta `200` en `http://localhost:4200/`.
- Backend activo: respuesta `200` en `http://localhost:8080/api/attendance`.
- Proxy frontend->backend activo: `200` en `http://localhost:4200/api/attendance`.
- Post-stop: puertos `4200`, `8080` y `50051` sin listeners activos.

## 11) Avance general del dÃ­a (2026-02-19)

Durante la jornada del 19-feb-2026 se consolidÃ³ la estabilidad operativa del stack y se cerraron ajustes funcionales crÃ­ticos del mÃ³dulo de asistencia para que el comportamiento en UI, API y BD sea consistente y permanente.

### 11.1 Estado operativo integrado

- Arranque y apagado del stack validados en ciclos repetidos sin errores crÃ­ticos.
- ConfirmaciÃ³n de servicios clave en ejecuciÃ³n: frontend (`:4200`), backend (`:8080`), IA gRPC (`:50051`).
- Flujo de trabajo en VS Code estabilizado para operaciÃ³n diaria con scripts unificados.

### 11.2 Asistencia CRUD con persistencia real

- Registro manual de asistencia reforzado con validaciones de negocio (ID y nombre obligatorios).
- EdiciÃ³n y eliminaciÃ³n conectadas a backend con persistencia real en PostgreSQL (ya no solo cambios locales de frontend).
- Operaciones de editar/eliminar validadas por identificador de fila (`row_id`) para evitar inconsistencias.
- Confirmado que los cambios sobreviven recarga de pantalla y reinicio de servicios.

### 11.3 Consistencia de fecha/hora

- NormalizaciÃ³n del manejo de fecha/hora para evitar desfases por zona horaria entre UI y backend.
- La fecha/hora seleccionada por el usuario se refleja de forma consistente en listado, exportaciones y respuestas API.
- Regla de negocio aplicada: no se permite registrar asistencias en fechas futuras.

### 11.4 PolÃ­tica vigente de captura por fecha (actualizada hoy)

- Se aplicÃ³ restricciÃ³n adicional para bloquear registros manuales con fecha de ayer o anteriores.
- PolÃ­tica efectiva actual: solo se permite capturar asistencia con fecha del dÃ­a en curso.
- La restricciÃ³n se implementÃ³ tanto en frontend como en backend para impedir bypass por llamadas directas a API.

### 11.5 ValidaciÃ³n ejecutada hoy

- CompilaciÃ³n frontend (build) en verde tras ajustes de fecha/hora y validaciones de captura.
- CompilaciÃ³n backend (go test) en verde tras endurecimiento de reglas de timestamp.
- Pruebas de API confirmaron comportamiento esperado:
  - intento con fecha anterior: rechazado (`400`),
  - intento con fecha de hoy: permitido y persistido.

### 11.6 ConclusiÃ³n del estado al cierre del dÃ­a

El proyecto queda al cierre del 19-feb-2026 con operaciÃ³n estable para entorno local de trabajo, reglas de captura de asistencia alineadas a negocio y consistencia de persistencia end-to-end en el mÃ³dulo CRUD de asistencias.

## 12) Avance general del dÃ­a (2026-02-20)

Durante la jornada del 20-feb-2026 se cerrÃ³ una ronda intensiva de estabilizaciÃ³n funcional sobre el registro manual de asistencias, validaciones de negocio y mensajes de usuario, con foco en eliminar falsos errores y asegurar consistencia frontend/backend.

### 12.1 UX del mÃ³dulo de asistencias

- Se consolidÃ³ navegaciÃ³n por vistas internas (`home`, `manual`, `embedding`) con retorno limpio a principal.
- Se limpiaron mensajes residuales al cambiar de vista para evitar toasts de contexto anterior.
- Se mantuvo la vista principal enfocada en tabla/filtros/import-export y formularios en vistas dedicadas.

### 12.2 Validaciones del formulario manual

- ValidaciÃ³n robusta de ID y nombre (captura desde input visible + estado interno) para evitar falsos "obligatorio".
- RestricciÃ³n efectiva para fecha/hora: solo dÃ­a actual y sin hora futura.
- Se corrigiÃ³ el flujo de ediciÃ³n invÃ¡lida para que no bloquee con mensajes incorrectos y procese correctamente.

### 12.3 Duplicados y reglas de negocio

- Se evaluÃ³ y ajustÃ³ la regla de duplicados exactos (mismo ID + nombre) en frontend y backend.
- Resultado final del dÃ­a: se retirÃ³ la regla estricta de duplicado exacto por causar falsos positivos en operaciÃ³n manual.
- Se conserva el control anti-duplicado temporal existente en backend (ventana de tiempo por empleado).

### 12.4 Backend y mensajes API

- Se agregaron y luego normalizaron validaciones para mantener coherencia con comportamiento esperado por negocio.
- Se tradujeron mensajes de error visibles al usuario al espaÃ±ol en endpoints principales.
- Se verificÃ³ compilaciÃ³n backend y reinicio de servicios con scripts operativos.

### 12.5 Incidencia de botÃ³n "Guardar" (registro manual)

- Se investigaron varias hipÃ³tesis (doble submit, ciclo de render, backend HTTP, estado de carga).
- Se aplicaron ajustes y rollback controlado para volver al comportamiento estable previo.
- Estado al cierre: el guardado volviÃ³ a operar de forma normal sin bloquear operaciÃ³n.

### 12.6 ValidaciÃ³n tÃ©cnica ejecutada

- Compilaciones repetidas en verde:
  - Frontend: `ng build`
  - Backend: `go build ./...`
- Pruebas API de duplicado create/edit ejecutadas durante la jornada para validar reglas activas.
- Reinicio completo del stack (`detener_bmpi.ps1` / `iniciar_bmpi.ps1 -Modo dev`) para confirmar carga de cambios.

### 12.7 Estado de cierre (20-feb-2026)

El sistema queda al cierre del dÃ­a con registro manual operativo, reglas de fecha/hora vigentes (solo hoy y no futuro), mensajes mayormente estabilizados y consistencia funcional entre frontend y backend para continuar la siguiente jornada sin bloqueos crÃ­ticos.

## 13) Avance general del dÃ­a (2026-02-24)

Durante la jornada del 24-feb-2026 se documentÃ³ y operativizÃ³ el proceso de captura/calibraciÃ³n empresarial para mejorar precisiÃ³n biomÃ©trica con evidencia real de campo.

### 13.1 Trabajo completado hoy

- Se creÃ³ el script operativo `scripts/preparar_dataset_empresa.ps1` para preparar automÃ¡ticamente la estructura de dataset empresarial:
  - `known/<employee_id>/`
  - `genuine/<employee_id>/`
  - `impostor/persona_XXX/`
- El script genera ademÃ¡s:
  - `capture_plan.csv` (plan de captura y estado)
  - `employee_ids_used.txt`
  - `README_CAPTURA.md`
  - placeholders `_CAPTURA_AQUI.txt` por carpeta
- Se creÃ³ checklist de ejecuciÃ³n en `scripts/CHECKLIST_CAPTURA_DATASET_EMPRESA.md`.
- Se actualizÃ³ la guÃ­a principal `scripts/GUIA_EVALUACION_IA_EMPRESA.md` para incluir el nuevo flujo de preparaciÃ³n y captura.

### 13.2 ValidaciÃ³n ejecutada hoy

- Script validado en PowerShell 5.1 tras correcciones de compatibilidad y robustez.
- Dataset scaffold generado correctamente en `datasets/empresa_eval_20260224`.
- Plan de captura verificado:
  - `known`: 30 identidades
  - `genuine`: 30 identidades
  - `impostor`: 30 identidades
  - total filas en plan: 90

### 13.3 Incidencias resueltas hoy

- Se corrigieron incompatibilidades de sintaxis para PowerShell 5.1.
- Se resolviÃ³ una colisiÃ³n por nombres de variables insensibles a mayÃºsculas/minÃºsculas en PowerShell (`EmployeeIds` vs variable local), que causaba conteo incorrecto de IDs.
- Se reescribiÃ³ el script con flujo determinista y validaciones explÃ­citas.

### 13.4 Pendiente por hacer

- Capturar y cargar fotos reales en `datasets/empresa_eval_20260224` segÃºn `capture_plan.csv`.
- Marcar avance de cada identidad (`pendiente` -> `completo`) en el plan.
- Ejecutar evaluaciÃ³n final con dataset representativo:
  - `python scripts/evaluar_ia_empresa.py --dataset "datasets/empresa_eval_20260224" --output reports/ia`
- Definir umbral final de producciÃ³n con base en FAR/FRR reales del dataset completo.
- Criterio de salida: no pasar a compaÃ±Ã­a mientras el semÃ¡foro permanezca en `ROJO`.

### 13.5 Estado de cierre (24-feb-2026)

Queda cerrado el componente de preparaciÃ³n y gobierno del dataset empresarial (estructura + checklist + guÃ­a + validaciÃ³n tÃ©cnica del script). Queda pendiente la etapa de campo (captura real) y la calibraciÃ³n final para decisiÃ³n de liberaciÃ³n.

## 14) Avance general del dÃ­a (2026-02-25)

Durante la jornada del 25-feb-2026 se avanzÃ³ en tareas desbloqueables sin cÃ¡mara, enfocadas en control operativo del dataset y trazabilidad del progreso.

### 14.1 Trabajo completado hoy (sin cÃ¡mara)

- Se creÃ³ `scripts/verificar_dataset_empresa.py` para validar avance del dataset sin ejecutar reconocimiento facial.
- El script compara `capture_plan.csv` contra imÃ¡genes realmente encontradas por grupo/identidad.
- Genera reportes JSON y Markdown con avance global y por grupo.
- Soporta actualizaciÃ³n opcional de estado en `capture_plan.csv` (`pendiente`/`completo`) con `--update-plan-status`.

### 14.2 DocumentaciÃ³n y operaciÃ³n actualizada

- Se actualizÃ³ `scripts/CHECKLIST_CAPTURA_DATASET_EMPRESA.md` con flujo de trabajo sin cÃ¡mara y comandos de verificaciÃ³n.
- Se actualizÃ³ `README.md` para incluir el nuevo comando de verificaciÃ³n operativa del dataset.

### 14.3 ValidaciÃ³n ejecutada hoy

- EjecuciÃ³n sobre dataset actual:
  - `python scripts/verificar_dataset_empresa.py --dataset "datasets/empresa_eval_20260224" --output reports/ia --update-plan-status`
- Resultado:
  - filas completas: `0 / 90`
  - avance global: `0.00%`
  - filas actualizadas en plan: `0`
- Reportes generados:
  - `reports/ia/verificacion_dataset_20260225_090503.json`
  - `reports/ia/verificacion_dataset_20260225_090503.md`

### 14.4 Pendiente por hacer

- Iniciar captura real de fotos al disponer de cÃ¡mara.
- Re-ejecutar `verificar_dataset_empresa.py` diariamente para seguimiento cuantitativo.
- Ejecutar calibraciÃ³n final con `evaluar_ia_empresa.py` cuando el plan alcance cobertura representativa.

### 14.5 Estado de cierre (25-feb-2026)

El proyecto queda hoy con control de avance de dataset automatizado y documentado para operaciÃ³n sin cÃ¡mara. La ruta de trabajo queda preparada para pasar a captura de campo apenas haya hardware disponible.

## 15) ValidaciÃ³n E2E del flujo de registro y cache (2026-02-25)

Se ejecutÃ³ validaciÃ³n en vivo del flujo completo solicitado: carga de fotos, extracciÃ³n de embeddings, persistencia en DB y disponibilidad inmediata en cache de reconocimiento.

### 15.1 Flujo validado

- `POST /api/employees/register-photos` con 5 imÃ¡genes reales de prueba para `employeeId=200`.
- VerificaciÃ³n de persistencia con `GET /api/employees/storage`.
- VerificaciÃ³n de cache en memoria con `GET /api/employees` inmediatamente despuÃ©s de registrar un empleado nuevo.

### 15.2 Evidencia de resultados

- Registro para `employeeId=200`:
  - `photosProcessed=5`
  - `failedPhotos=0`
- Persistencia para `employeeId=200`:
  - `embedding_bytes=1175`
  - `photo_bytes=279922`
- Prueba de actualizaciÃ³n inmediata de cache:
  - se registrÃ³ `employeeId=9200`
  - `GET /api/employees` lo devolviÃ³ en la consulta inmediata (`cache_list_contains_9200=true`)
- Persistencia para `employeeId=9200`:
  - `embedding_bytes=1175`
  - `photo_bytes=279922`

### 15.3 ConclusiÃ³n

Queda validado de extremo a extremo el flujo operativo requerido: fotos subidas -> embeddings generados -> foto+embedding guardados en PostgreSQL -> identidad disponible de inmediato en cache para reconocimiento rÃ¡pido.

### 15.4 Mejora de calidad para reducir no-reconocidos

- Se agregÃ³ `scripts/verificar_calidad_fotos.py` para anÃ¡lisis automÃ¡tico por imagen (blur, iluminaciÃ³n, mÃºltiples rostros, tamaÃ±o/encuadre de rostro).
- Se integrÃ³ el flujo en:
  - `scripts/CHECKLIST_CAPTURA_DATASET_EMPRESA.md`
  - `scripts/GUIA_EVALUACION_IA_EMPRESA.md`
  - `README.md`
- ValidaciÃ³n tÃ©cnica ejecutada (dataset de referencia local):
  - comando: `python scripts/verificar_calidad_fotos.py --dataset "datasets/empresa_eval_20260220" --output reports/ia --max-files 11`
  - resultado: `11/11` imÃ¡genes evaluadas en estado OK con umbrales actuales
  - reportes:
    - `reports/ia/verificacion_calidad_fotos_20260225_111759.json`
    - `reports/ia/verificacion_calidad_fotos_20260225_111759.md`

### 15.5 Flujo operativo todo-en-uno listo

- Se creÃ³ `scripts/diagnostico_dataset_empresa.ps1` para ejecutar en una sola corrida:
  - verificaciÃ³n de avance (`verificar_dataset_empresa.py`),
  - verificaciÃ³n de calidad (`verificar_calidad_fotos.py`),
  - evaluaciÃ³n FAR/FRR (`evaluar_ia_empresa.py`, opcional).
- Se aÃ±adiÃ³ modo rÃ¡pido con `-SkipEvaluation` para operaciÃ³n diaria sin bloqueos.
- ValidaciÃ³n tÃ©cnica de ejecuciÃ³n rÃ¡pida realizada:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\diagnostico_dataset_empresa.ps1 -Dataset "datasets/empresa_eval_20260220" -SkipEvaluation`
  - salida OK y generaciÃ³n de resumen:
    - `reports/ia/diagnostico_dataset_20260225_112658.json`
    - `reports/ia/diagnostico_dataset_20260225_112658.md`

### 15.6 Calidad automÃ¡tica integrada al frontend

- Se implementÃ³ validaciÃ³n de calidad automÃ¡tica dentro de `POST /api/employees/register-photos`.
- El backend ahora devuelve `qualityWarnings` por archivo en la respuesta del registro (sin bloquear persistencia).
- El frontend (`attendance-list.component.ts`) ya muestra estas advertencias en el mismo flujo de guardado para guiar recaptura inmediata.
- ValidaciÃ³n en runtime realizada tras reinicio de servicios:
  - registro de 5 fotos exitoso para `employeeId=9301`
  - respuesta con advertencias de calidad por archivo (`qualityWarnings`) confirmada.

### 15.7 Preflight tÃ©cnico de producciÃ³n completado

- Arranque en modo `prod` validado con `scripts/iniciar_bmpi.ps1`.
- Build tÃ©cnico validado:
  - backend: `go test ./...` en verde
  - frontend SSR: `npm run build -- --configuration production` en verde
- Smoke E2E en modo producciÃ³n ejecutado:
  - `GET /api/attendance` OK
  - `POST /api/employees/register-photos` con 5 fotos OK (`failedPhotos=0`)
  - persistencia confirmada (`embedding_bytes > 0`, `photo_bytes > 0`)
  - visibilidad en cache inmediata confirmada (`GET /api/employees`)
- Se agregÃ³ script reproducible de smoke para go-live:
  - `scripts/smoke_prod_registro_fotos.ps1`

## 16) Avance general del dÃ­a (2026-02-25) â€” endurecimiento de reconocimiento facial

Durante la jornada se ejecutÃ³ una ronda de endurecimiento tÃ©cnico para reducir falsos "No face detected" y mejorar reconocimiento cuando la persona cambia condiciÃ³n (con lentes/sin lentes, Ã¡ngulos difÃ­ciles).

### 16.1 Motor IA (`ml-model/face_server.py`)

- Se migrÃ³ almacenamiento de embedding por empleado a payload con mÃºltiples prototipos (`version=2`, `prototypes`, `centroid`) manteniendo compatibilidad con formato legado.
- Se incorporÃ³ selecciÃ³n de prototipos diversos por empleado para robustez inter-poses/variantes de apariencia.
- Se agregÃ³ configuraciÃ³n de codificaciÃ³n facial por entorno:
  - `BMPI_FACE_ENCODING_MODEL`
  - `BMPI_FACE_ENCODING_JITTERS_REGISTER`
  - `BMPI_FACE_ENCODING_JITTERS_RECOGNIZE`
  - `BMPI_MAX_PROTOTYPES_PER_EMPLOYEE`
- Se aÃ±adiÃ³ cadena de fallback de detecciÃ³n:
  - detector principal (`BMPI_FACE_MODEL`),
  - detector alterno (`BMPI_FACE_MODEL_FALLBACK`),
  - fallback Haar frontal/perfil (`BMPI_FACE_HAAR_FALLBACK`, `BMPI_HAAR_MIN_FACE`).
- Se aÃ±adiÃ³ detecciÃ³n robusta por variantes de imagen para casos difÃ­ciles:
  - mejora de contraste CLAHE (`BMPI_FACE_CONTRAST_FALLBACK`),
  - rotaciones leves configurables (`BMPI_FACE_ROTATION_FALLBACK`, `BMPI_FACE_ROTATION_ANGLES`).

### 16.2 Frontend (`attendance-web/src/app/attendance-list.component.ts`)

- CorrecciÃ³n de consistencia en flujo de registro por lote:
  - ya no se muestran como "listo para guardar" fotos que el backend devolviÃ³ como fallidas.
- Mejora del reintento de fallidas:
  - emparejamiento de nombres case-insensitive para reconstruir correctamente la cola de reintento.

### 16.3 ConfiguraciÃ³n y documentaciÃ³n operativa

- Se actualizaron plantillas de entorno:
  - `scripts/.env.dev.example`
  - `scripts/.env.production.example`
- Se documentaron todas las nuevas llaves de calibraciÃ³n de reconocimiento/fallback.

### 16.4 Estado al cierre de hoy

- ImplementaciÃ³n tÃ©cnica completada y sin errores estÃ¡ticos en archivos modificados.
- Queda pendiente validaciÃ³n final en campo con las 3 fotos problemÃ¡ticas reportadas para cerrar calibraciÃ³n fina de umbral/captura por cÃ¡mara real.

## 17) Avance general del dia (2026-03-03) - cierre tecnico de reconocimiento lateral y estabilidad

Durante la jornada del 3-mar-2026 se consolido una ronda de hardening enfocada en reconocimiento de rostros en angulo (perfil parcial), estabilidad del flujo desde interfaz y evidencia operativa para decision de despliegue.

### 17.1 Mejoras aplicadas en codigo y configuracion

- Se mejoro `ml-model/face_server.py` para reconocimiento mas robusto:
  - mayor cobertura de candidatos durante reconocimiento,
  - seleccion de candidatos diversos (evita quedarse con variantes redundantes),
  - soporte de preprocesado automatico para orientacion EXIF y normalizacion en runtime.
- Se agregaron y activaron ajustes de entorno para robustez lateral:
  - `BMPI_FACE_MODEL_FALLBACK`,
  - `BMPI_FACE_HAAR_FALLBACK`,
  - `BMPI_FACE_CONTRAST_FALLBACK`,
  - `BMPI_FACE_ROTATION_FALLBACK`,
  - `BMPI_RECOGNIZE_MAX_CANDIDATES`,
  - `BMPI_RECOGNIZE_LOCATIONS_PER_VARIANT`.
- Se actualizo `scripts/evaluar_ia_empresa.py` para alinear evaluacion offline con un pipeline mas cercano al comportamiento real de IA en servicio.

### 17.2 Evidencia ejecutada (runtime real por API)

- Se reinicio stack en desarrollo con configuracion nueva (`detener_bmpi.ps1` / `iniciar_bmpi.ps1`).
- Salud de servicios validada:
  - frontend `:4200` activo,
  - backend `:8080` activo y respondiendo,
  - IA gRPC `:50051` activo.
- Prueba de extraccion desde interfaz (`POST /api/embeddings/extract`) sobre dataset empresarial local:
  - dataset: `datasets/empresa_eval_20260302_lote1`,
  - total evaluadas: `96`,
  - embeddings extraidos: `96`,
  - fallas: `0`,
  - tasa de exito: `100.0%`.

### 17.3 Manejo de fotos problematicas y cierre de recaptura minima

- Se valido la lista de 5 fotos inicialmente marcadas como problematicas.
- Resultado final tras ajustes y correccion dirigida:
  - `5/5` fotos extraen embedding correctamente por API.
- Se conservaron respaldos de originales en los casos corregidos automaticamente:
  - `known/6/20260223_114421.original.jpg`,
  - `genuine/12/20260223_115151.original.jpg`.

### 17.4 Estado actual para operacion

- Estado de ejecucion tecnica: **estable**.
- Flujo de extraccion desde interfaz: **operativo y validado** con evidencia sobre el lote actual.
- Recomendacion de uso:
  - apto para piloto operativo inmediato,
  - mantener ventana corta de observacion en campo para ajustar umbral final por sede/camara.

### 17.5 Que ya no es pendiente y que si se mantiene pendiente

No pendiente (cerrado):

- endurecimiento de reconocimiento lateral a nivel codigo,
- validacion de extraccion por interfaz en lote actual (`100%`),
- estabilizacion de arranque operativo tras cambios.

Pendiente (siguiente control):

- confirmar FRR/FAR final en prueba de campo (1-2 dias) con trafico real de acceso,
- congelar umbral final de produccion por sede/camara,
- ejecutar smoke final de go-live y documentar acta de cierre.

### 17.6 Estado tecnico verificado al cierre (2026-03-03 tarde)

- Servicios reiniciados y operativos:
  - frontend `:4200`,
  - backend `:8080`,
  - IA gRPC `:50051`,
  - gRPC backend `:50052`.
- Smoke runtime:
  - `GET /api/attendance` -> `200`.
  - `POST /api/embeddings/extract` en muestra conflictiva -> `5/5` OK.
  - `POST /api/employees/register-photos` (5 fotos) -> `photosProcessed=5`, `failedPhotos=0`.
- Evaluacion IA mas reciente:
  - `reports/ia/evaluacion_ia_20260303_141214.md`
  - `threshold=0.50`, `FRR=0.392857`, `FAR=0.153846`, `detection_rate=1.0`, `latency_p95_ms=1733.54`.

ConclusiÃ³n de cierre tecnico: el sistema esta estable y funcional para piloto, pero por metrica biometrica vigente (FRR/FAR) aun no cumple criterio de liberacion empresarial final sin ronda adicional de datos/calibracion de campo.

## 18) Avance general del dia (2026-03-05) - cierre de operacion para entrada caminando

Durante la jornada del 5-mar-2026 se cerraron mejoras de produccion para operacion en punto de acceso, enfocadas en reconocimiento en movimiento, coherencia de seguridad y checklist formal de salida.

### 18.1 Frontend (operacion diaria)

- Se integro vista `Reconocimiento entrada` con:
  - camara en navegador,
  - rafaga configurable,
  - reconocimiento automatico por lotes de frames,
  - registro de asistencia al confirmar votos/confianza.
- Se agrego panel de configuracion de API key en UI para entorno productivo (persistencia en `localStorage`).

### 18.2 Backend (calidad y robustez)

- Se mantiene endpoint de produccion `POST /api/attendance/recognize-burst` como flujo principal para paso caminando.
- Se agrego bloqueo configurable de fotos de mala calidad en `register-photos`:
  - `BMPI_QUALITY_BLOCKING_ENABLED`,
  - `BMPI_QUALITY_BLOCKING_ISSUES`.

### 18.3 Configuracion y documentacion

- Variables nuevas agregadas a `scripts/.env.dev`, `scripts/.env.production` y sus `.example`.
- README actualizado con:
  - flujo de reconocimiento por rafaga,
  - configuracion de API key en frontend,
  - bloqueo de calidad.
- Checklist formal de salida generado:
  - `reports/ia/GO_LIVE_CHECKLIST_FINAL_20260305.md`.

### 18.4 Verificacion tecnica ejecutada hoy

- Frontend:
  - `ng test --watch=false` en verde.
  - `ng build` en verde.
- Backend:
  - `go test ./...` en verde.
- Smoke runtime:
  - `GET /api/attendance` -> `200`.
  - `POST /api/attendance/recognize-burst` -> reconocido y asistencia registrada.

## 19) Estado actual consolidado (2026-03-05 noche)

### 19.1 Estado del proyecto

- Estado operativo general: **apto para despliegue controlado**.
- Stack productivo (`prod`) validado:
  - frontend SSR `:4000`,
  - backend `:8080`,
  - IA gRPC `:50051`.
- Seguridad API validada:
  - sin API key -> `401`,
  - con API key operador -> `200`.

### 19.2 Cifrado y seguridad en transito

- Backend <-> IA: **TLS activo**.
- Renovacion de certificados gRPC: **automatica** al iniciar `prod` si detecta falta, vencimiento cercano o cambio SAN/host.
- Frontend SSR: inyeccion automatica de API key para consumo de `/api/*`.
- PostgreSQL: se mantiene `DB_SSLMODE=disable` en este host local por limitacion del servidor DB actual (sin SSL habilitado).

### 19.3 Estado de repositorio

- Repositorio GitHub sincronizado con estado local al cierre:
  - rama: `main`,
  - commits de cierre aplicados y empujados a `origin/main`.

### 19.4 Pendiente unico para cierre empresarial 100%

- Ejecutar prueba en campo con camara real (bloque corto + 1-2 dias), congelar parametros finales por sede/camara y firmar acta go-live.

## 20) Avance general del dia (2026-03-10) - aceleracion de busqueda con FAISS

- Se integro FAISS en `ml-model/face_server.py` para acelerar busqueda de identidad con grandes volumenes (5k+ empleados).
- Estrategia: FAISS (HNSW) + verificacion exacta top-k + fallback a busqueda completa cerca del umbral para maxima precision.
- Configuracion agregada en `.env`:
  - `BMPI_USE_FAISS`, `BMPI_FAISS_INDEX`, `BMPI_FAISS_HNSW_M`, `BMPI_FAISS_HNSW_EF_SEARCH`, `BMPI_FAISS_HNSW_EF_CONSTRUCTION`
  - `BMPI_FAISS_TOPK`, `BMPI_FAISS_FALLBACK_RATIO`
- Dependencia agregada: `faiss-cpu` (si no esta disponible, se usa busqueda lineal automaticamente).

## 21) Avance general del dia (2026-03-11) - login y roles

- Login con token y roles implementado en backend y frontend.
- Permisos por rol:
  - admin: todo.
  - rh: lectura + export + embeddings (sin registro manual ni reconocimiento).
  - operator/vigilante: reconocimiento + registro manual + export.
  - jefe: lectura + export.
- Pantalla "Usuarios y roles" para admin con creacion, activacion/desactivacion y reset de password.
- Auditoria de cambios en tabla `auth_audit`.
- Sesion persiste en recarga (sessionStorage) y cierra tras 60 minutos de inactividad.
- Inicio DEV actualizado para recompilar backend y evitar binario viejo (login 404).
## Actualizacion 2026-03-13 (Auth y limpieza API key)

### Cambios clave
- Login obligatorio con roles; sin API key en frontend ni backend.
- Refresh de token automatico + heartbeat para logout inmediato si se desactiva usuario.
- "Mi cuenta" separada para cambio de password.
- Rate limit por intentos fallidos en login.
- Splash de inicio con logo BMPI y animacion.

### Limpieza tecnica
- Eliminado soporte de API key en frontend y servidor SSR.
- Scripts y docs actualizados a login/token.
- Smoke tests usan login y token.

### Scripts nuevos
- scripts/auth_login_token.ps1: obtiene token con usuario/password.

### Pendientes opcionales
- Ajustar heartbeat a 30s si se quiere logout casi inmediato.
- Agregar script de revocacion masiva si se requiere.

## Actualizacion 2026-03-13 (UI, sesion y arranque estable)

### Cambios clave
- Menu de sesion compacto en la esquina (Mi cuenta, Cerrar sesion) con confirmacion de cierre.
- Cierre de sesion inmediato en UI y desvanecido limpio de salida.
- Splash de entrada ajustado a fondo transparente para empatar con el tema de la app.

### Arranque/Node
- scripts/iniciar_bmpi.ps1 prioriza Node 22.12 (compatible con Angular) y configura NODE_OPTIONS para evitar errores de memoria en build.
- Nuevo soporte de ruta via BMPI_NODE_PATH (para equipos sin nvm).

### Plantillas de entorno
- scripts/.env.dev.example y scripts/.env.production.example incluyen BMPI_NODE_PATH.




