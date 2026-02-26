# ESTADO GENERAL BMPI

Última actualización: 2026-02-25

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

## 11) Avance general del día (2026-02-19)

Durante la jornada del 19-feb-2026 se consolidó la estabilidad operativa del stack y se cerraron ajustes funcionales críticos del módulo de asistencia para que el comportamiento en UI, API y BD sea consistente y permanente.

### 11.1 Estado operativo integrado

- Arranque y apagado del stack validados en ciclos repetidos sin errores críticos.
- Confirmación de servicios clave en ejecución: frontend (`:4200`), backend (`:8080`), IA gRPC (`:50051`).
- Flujo de trabajo en VS Code estabilizado para operación diaria con scripts unificados.

### 11.2 Asistencia CRUD con persistencia real

- Registro manual de asistencia reforzado con validaciones de negocio (ID y nombre obligatorios).
- Edición y eliminación conectadas a backend con persistencia real en PostgreSQL (ya no solo cambios locales de frontend).
- Operaciones de editar/eliminar validadas por identificador de fila (`row_id`) para evitar inconsistencias.
- Confirmado que los cambios sobreviven recarga de pantalla y reinicio de servicios.

### 11.3 Consistencia de fecha/hora

- Normalización del manejo de fecha/hora para evitar desfases por zona horaria entre UI y backend.
- La fecha/hora seleccionada por el usuario se refleja de forma consistente en listado, exportaciones y respuestas API.
- Regla de negocio aplicada: no se permite registrar asistencias en fechas futuras.

### 11.4 Política vigente de captura por fecha (actualizada hoy)

- Se aplicó restricción adicional para bloquear registros manuales con fecha de ayer o anteriores.
- Política efectiva actual: solo se permite capturar asistencia con fecha del día en curso.
- La restricción se implementó tanto en frontend como en backend para impedir bypass por llamadas directas a API.

### 11.5 Validación ejecutada hoy

- Compilación frontend (build) en verde tras ajustes de fecha/hora y validaciones de captura.
- Compilación backend (go test) en verde tras endurecimiento de reglas de timestamp.
- Pruebas de API confirmaron comportamiento esperado:
  - intento con fecha anterior: rechazado (`400`),
  - intento con fecha de hoy: permitido y persistido.

### 11.6 Conclusión del estado al cierre del día

El proyecto queda al cierre del 19-feb-2026 con operación estable para entorno local de trabajo, reglas de captura de asistencia alineadas a negocio y consistencia de persistencia end-to-end en el módulo CRUD de asistencias.

## 12) Avance general del día (2026-02-20)

Durante la jornada del 20-feb-2026 se cerró una ronda intensiva de estabilización funcional sobre el registro manual de asistencias, validaciones de negocio y mensajes de usuario, con foco en eliminar falsos errores y asegurar consistencia frontend/backend.

### 12.1 UX del módulo de asistencias

- Se consolidó navegación por vistas internas (`home`, `manual`, `embedding`) con retorno limpio a principal.
- Se limpiaron mensajes residuales al cambiar de vista para evitar toasts de contexto anterior.
- Se mantuvo la vista principal enfocada en tabla/filtros/import-export y formularios en vistas dedicadas.

### 12.2 Validaciones del formulario manual

- Validación robusta de ID y nombre (captura desde input visible + estado interno) para evitar falsos "obligatorio".
- Restricción efectiva para fecha/hora: solo día actual y sin hora futura.
- Se corrigió el flujo de edición inválida para que no bloquee con mensajes incorrectos y procese correctamente.

### 12.3 Duplicados y reglas de negocio

- Se evaluó y ajustó la regla de duplicados exactos (mismo ID + nombre) en frontend y backend.
- Resultado final del día: se retiró la regla estricta de duplicado exacto por causar falsos positivos en operación manual.
- Se conserva el control anti-duplicado temporal existente en backend (ventana de tiempo por empleado).

### 12.4 Backend y mensajes API

- Se agregaron y luego normalizaron validaciones para mantener coherencia con comportamiento esperado por negocio.
- Se tradujeron mensajes de error visibles al usuario al español en endpoints principales.
- Se verificó compilación backend y reinicio de servicios con scripts operativos.

### 12.5 Incidencia de botón "Guardar" (registro manual)

- Se investigaron varias hipótesis (doble submit, ciclo de render, backend HTTP, estado de carga).
- Se aplicaron ajustes y rollback controlado para volver al comportamiento estable previo.
- Estado al cierre: el guardado volvió a operar de forma normal sin bloquear operación.

### 12.6 Validación técnica ejecutada

- Compilaciones repetidas en verde:
  - Frontend: `ng build`
  - Backend: `go build ./...`
- Pruebas API de duplicado create/edit ejecutadas durante la jornada para validar reglas activas.
- Reinicio completo del stack (`detener_bmpi.ps1` / `iniciar_bmpi.ps1 -Modo dev`) para confirmar carga de cambios.

### 12.7 Estado de cierre (20-feb-2026)

El sistema queda al cierre del día con registro manual operativo, reglas de fecha/hora vigentes (solo hoy y no futuro), mensajes mayormente estabilizados y consistencia funcional entre frontend y backend para continuar la siguiente jornada sin bloqueos críticos.

## 13) Avance general del día (2026-02-24)

Durante la jornada del 24-feb-2026 se documentó y operativizó el proceso de captura/calibración empresarial para mejorar precisión biométrica con evidencia real de campo.

### 13.1 Trabajo completado hoy

- Se creó el script operativo `scripts/preparar_dataset_empresa.ps1` para preparar automáticamente la estructura de dataset empresarial:
  - `known/<employee_id>/`
  - `genuine/<employee_id>/`
  - `impostor/persona_XXX/`
- El script genera además:
  - `capture_plan.csv` (plan de captura y estado)
  - `employee_ids_used.txt`
  - `README_CAPTURA.md`
  - placeholders `_CAPTURA_AQUI.txt` por carpeta
- Se creó checklist de ejecución en `scripts/CHECKLIST_CAPTURA_DATASET_EMPRESA.md`.
- Se actualizó la guía principal `scripts/GUIA_EVALUACION_IA_EMPRESA.md` para incluir el nuevo flujo de preparación y captura.

### 13.2 Validación ejecutada hoy

- Script validado en PowerShell 5.1 tras correcciones de compatibilidad y robustez.
- Dataset scaffold generado correctamente en `datasets/empresa_eval_20260224`.
- Plan de captura verificado:
  - `known`: 30 identidades
  - `genuine`: 30 identidades
  - `impostor`: 30 identidades
  - total filas en plan: 90

### 13.3 Incidencias resueltas hoy

- Se corrigieron incompatibilidades de sintaxis para PowerShell 5.1.
- Se resolvió una colisión por nombres de variables insensibles a mayúsculas/minúsculas en PowerShell (`EmployeeIds` vs variable local), que causaba conteo incorrecto de IDs.
- Se reescribió el script con flujo determinista y validaciones explícitas.

### 13.4 Pendiente por hacer

- Capturar y cargar fotos reales en `datasets/empresa_eval_20260224` según `capture_plan.csv`.
- Marcar avance de cada identidad (`pendiente` -> `completo`) en el plan.
- Ejecutar evaluación final con dataset representativo:
  - `python scripts/evaluar_ia_empresa.py --dataset "datasets/empresa_eval_20260224" --output reports/ia`
- Definir umbral final de producción con base en FAR/FRR reales del dataset completo.
- Criterio de salida: no pasar a compañía mientras el semáforo permanezca en `ROJO`.

### 13.5 Estado de cierre (24-feb-2026)

Queda cerrado el componente de preparación y gobierno del dataset empresarial (estructura + checklist + guía + validación técnica del script). Queda pendiente la etapa de campo (captura real) y la calibración final para decisión de liberación.

## 14) Avance general del día (2026-02-25)

Durante la jornada del 25-feb-2026 se avanzó en tareas desbloqueables sin cámara, enfocadas en control operativo del dataset y trazabilidad del progreso.

### 14.1 Trabajo completado hoy (sin cámara)

- Se creó `scripts/verificar_dataset_empresa.py` para validar avance del dataset sin ejecutar reconocimiento facial.
- El script compara `capture_plan.csv` contra imágenes realmente encontradas por grupo/identidad.
- Genera reportes JSON y Markdown con avance global y por grupo.
- Soporta actualización opcional de estado en `capture_plan.csv` (`pendiente`/`completo`) con `--update-plan-status`.

### 14.2 Documentación y operación actualizada

- Se actualizó `scripts/CHECKLIST_CAPTURA_DATASET_EMPRESA.md` con flujo de trabajo sin cámara y comandos de verificación.
- Se actualizó `README.md` para incluir el nuevo comando de verificación operativa del dataset.

### 14.3 Validación ejecutada hoy

- Ejecución sobre dataset actual:
  - `python scripts/verificar_dataset_empresa.py --dataset "datasets/empresa_eval_20260224" --output reports/ia --update-plan-status`
- Resultado:
  - filas completas: `0 / 90`
  - avance global: `0.00%`
  - filas actualizadas en plan: `0`
- Reportes generados:
  - `reports/ia/verificacion_dataset_20260225_090503.json`
  - `reports/ia/verificacion_dataset_20260225_090503.md`

### 14.4 Pendiente por hacer

- Iniciar captura real de fotos al disponer de cámara.
- Re-ejecutar `verificar_dataset_empresa.py` diariamente para seguimiento cuantitativo.
- Ejecutar calibración final con `evaluar_ia_empresa.py` cuando el plan alcance cobertura representativa.

### 14.5 Estado de cierre (25-feb-2026)

El proyecto queda hoy con control de avance de dataset automatizado y documentado para operación sin cámara. La ruta de trabajo queda preparada para pasar a captura de campo apenas haya hardware disponible.

## 15) Validación E2E del flujo de registro y cache (2026-02-25)

Se ejecutó validación en vivo del flujo completo solicitado: carga de fotos, extracción de embeddings, persistencia en DB y disponibilidad inmediata en cache de reconocimiento.

### 15.1 Flujo validado

- `POST /api/employees/register-photos` con 5 imágenes reales de prueba para `employeeId=200`.
- Verificación de persistencia con `GET /api/employees/storage`.
- Verificación de cache en memoria con `GET /api/employees` inmediatamente después de registrar un empleado nuevo.

### 15.2 Evidencia de resultados

- Registro para `employeeId=200`:
  - `photosProcessed=5`
  - `failedPhotos=0`
- Persistencia para `employeeId=200`:
  - `embedding_bytes=1175`
  - `photo_bytes=279922`
- Prueba de actualización inmediata de cache:
  - se registró `employeeId=9200`
  - `GET /api/employees` lo devolvió en la consulta inmediata (`cache_list_contains_9200=true`)
- Persistencia para `employeeId=9200`:
  - `embedding_bytes=1175`
  - `photo_bytes=279922`

### 15.3 Conclusión

Queda validado de extremo a extremo el flujo operativo requerido: fotos subidas -> embeddings generados -> foto+embedding guardados en PostgreSQL -> identidad disponible de inmediato en cache para reconocimiento rápido.

### 15.4 Mejora de calidad para reducir no-reconocidos

- Se agregó `scripts/verificar_calidad_fotos.py` para análisis automático por imagen (blur, iluminación, múltiples rostros, tamaño/encuadre de rostro).
- Se integró el flujo en:
  - `scripts/CHECKLIST_CAPTURA_DATASET_EMPRESA.md`
  - `scripts/GUIA_EVALUACION_IA_EMPRESA.md`
  - `README.md`
- Validación técnica ejecutada (dataset de referencia local):
  - comando: `python scripts/verificar_calidad_fotos.py --dataset "datasets/empresa_eval_20260220" --output reports/ia --max-files 11`
  - resultado: `11/11` imágenes evaluadas en estado OK con umbrales actuales
  - reportes:
    - `reports/ia/verificacion_calidad_fotos_20260225_111759.json`
    - `reports/ia/verificacion_calidad_fotos_20260225_111759.md`

### 15.5 Flujo operativo todo-en-uno listo

- Se creó `scripts/diagnostico_dataset_empresa.ps1` para ejecutar en una sola corrida:
  - verificación de avance (`verificar_dataset_empresa.py`),
  - verificación de calidad (`verificar_calidad_fotos.py`),
  - evaluación FAR/FRR (`evaluar_ia_empresa.py`, opcional).
- Se añadió modo rápido con `-SkipEvaluation` para operación diaria sin bloqueos.
- Validación técnica de ejecución rápida realizada:
  - `powershell -ExecutionPolicy Bypass -File .\scripts\diagnostico_dataset_empresa.ps1 -Dataset "datasets/empresa_eval_20260220" -SkipEvaluation`
  - salida OK y generación de resumen:
    - `reports/ia/diagnostico_dataset_20260225_112658.json`
    - `reports/ia/diagnostico_dataset_20260225_112658.md`

### 15.6 Calidad automática integrada al frontend

- Se implementó validación de calidad automática dentro de `POST /api/employees/register-photos`.
- El backend ahora devuelve `qualityWarnings` por archivo en la respuesta del registro (sin bloquear persistencia).
- El frontend (`attendance-list.component.ts`) ya muestra estas advertencias en el mismo flujo de guardado para guiar recaptura inmediata.
- Validación en runtime realizada tras reinicio de servicios:
  - registro de 5 fotos exitoso para `employeeId=9301`
  - respuesta con advertencias de calidad por archivo (`qualityWarnings`) confirmada.

### 15.7 Preflight técnico de producción completado

- Arranque en modo `prod` validado con `scripts/iniciar_bmpi.ps1`.
- Build técnico validado:
  - backend: `go test ./...` en verde
  - frontend SSR: `npm run build -- --configuration production` en verde
- Smoke E2E en modo producción ejecutado:
  - `GET /api/attendance` OK
  - `POST /api/employees/register-photos` con 5 fotos OK (`failedPhotos=0`)
  - persistencia confirmada (`embedding_bytes > 0`, `photo_bytes > 0`)
  - visibilidad en cache inmediata confirmada (`GET /api/employees`)
- Se agregó script reproducible de smoke para go-live:
  - `scripts/smoke_prod_registro_fotos.ps1`

## 16) Avance general del día (2026-02-25) — endurecimiento de reconocimiento facial

Durante la jornada se ejecutó una ronda de endurecimiento técnico para reducir falsos "No face detected" y mejorar reconocimiento cuando la persona cambia condición (con lentes/sin lentes, ángulos difíciles).

### 16.1 Motor IA (`ml-model/face_server.py`)

- Se migró almacenamiento de embedding por empleado a payload con múltiples prototipos (`version=2`, `prototypes`, `centroid`) manteniendo compatibilidad con formato legado.
- Se incorporó selección de prototipos diversos por empleado para robustez inter-poses/variantes de apariencia.
- Se agregó configuración de codificación facial por entorno:
  - `BMPI_FACE_ENCODING_MODEL`
  - `BMPI_FACE_ENCODING_JITTERS_REGISTER`
  - `BMPI_FACE_ENCODING_JITTERS_RECOGNIZE`
  - `BMPI_MAX_PROTOTYPES_PER_EMPLOYEE`
- Se añadió cadena de fallback de detección:
  - detector principal (`BMPI_FACE_MODEL`),
  - detector alterno (`BMPI_FACE_MODEL_FALLBACK`),
  - fallback Haar frontal/perfil (`BMPI_FACE_HAAR_FALLBACK`, `BMPI_HAAR_MIN_FACE`).
- Se añadió detección robusta por variantes de imagen para casos difíciles:
  - mejora de contraste CLAHE (`BMPI_FACE_CONTRAST_FALLBACK`),
  - rotaciones leves configurables (`BMPI_FACE_ROTATION_FALLBACK`, `BMPI_FACE_ROTATION_ANGLES`).

### 16.2 Frontend (`attendance-web/src/app/attendance-list.component.ts`)

- Corrección de consistencia en flujo de registro por lote:
  - ya no se muestran como "listo para guardar" fotos que el backend devolvió como fallidas.
- Mejora del reintento de fallidas:
  - emparejamiento de nombres case-insensitive para reconstruir correctamente la cola de reintento.

### 16.3 Configuración y documentación operativa

- Se actualizaron plantillas de entorno:
  - `scripts/.env.dev.example`
  - `scripts/.env.production.example`
- Se documentaron todas las nuevas llaves de calibración de reconocimiento/fallback.

### 16.4 Estado al cierre de hoy

- Implementación técnica completada y sin errores estáticos en archivos modificados.
- Queda pendiente validación final en campo con las 3 fotos problemáticas reportadas para cerrar calibración fina de umbral/captura por cámara real.
