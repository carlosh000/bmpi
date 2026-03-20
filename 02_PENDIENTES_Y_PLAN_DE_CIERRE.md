# 02 PENDIENTES Y PLAN DE CIERRE - BMPI

Fecha de plan: 2026-03-19
Objetivo: dejar ruta clara para terminar y liberar el proyecto con control de riesgo.

## 1. Pendientes priorizados (backlog ejecutable)

### P1. Calibracion final de precision biometrica en campo

- Prioridad: Alta
- Impacto si no se hace: Riesgo de falsos positivos/falsos negativos en operacion real.
- Estado actual: Parcial (hay scripts y metodologia; falta cierre con dataset de campo final).
- Evidencia actual:
  - `scripts/evaluar_ia_empresa.py`
  - `scripts/verificar_dataset_empresa.py`
  - `scripts/verificar_calidad_fotos.py`
  - `scripts/GUIA_EVALUACION_IA_EMPRESA.md`

Pasos tecnicos:

1. Completar dataset final en `datasets/empresa_eval_YYYYMMDD` (known/genuine/impostor).
2. Ejecutar verificacion de completitud y calidad.
3. Ejecutar evaluacion principal con reporte en `reports/ia`.
4. Ajustar `BMPI_FACE_THRESHOLD` y repetir hasta quedar en rango aceptable de negocio.
5. Congelar threshold final por sede/camara y documentarlo.

Esfuerzo estimado: 3 a 5 dias laborales (depende de captura real).
Dependencias: disponibilidad de camara real, personal para capturas y validacion de negocio.
Definicion de terminado (DoD): reporte final firmado con threshold y criterio de aceptacion.

### P2. Pruebas de carga y estabilidad operativa

- Prioridad: Alta
- Impacto si no se hace: Riesgo de caidas o latencia alta en horas pico.
- Estado actual: Pendiente.

Pasos tecnicos:

1. Definir escenarios de carga (n usuarios concurrentes, rafagas de reconocimiento).
2. Ejecutar pruebas de 1h y 4h en entorno similar a produccion.
3. Medir tiempo de respuesta en:
   - `/api/attendance/recognize-burst`
   - `/api/employees/register-photos`
   - login/refresh.
4. Afinar variables:
   - `BMPI_REGISTER_PHOTO_WORKERS`
   - `BMPI_GRPC_WORKERS`
   - `BMPI_GRPC_MAX_MSG_MB`
5. Documentar limites operativos y capacidad recomendada.

Esfuerzo estimado: 2 a 4 dias.
Dependencias: entorno estable, dataset suficiente, ventana de pruebas.
DoD: informe de capacidad + configuracion final recomendada.

### P3. Observabilidad minima y health checks

- Prioridad: Alta
- Impacto si no se hace: Diagnostico lento ante fallas en produccion.
- Estado actual: Parcial (scripts de verificacion, sin monitoreo estructurado).

Pasos tecnicos:

1. Agregar endpoint de health tecnico en backend (`/health` y `/ready`).
2. Registrar metricas minimas (latencia, errores por endpoint, timeout gRPC).
3. Definir rotacion de logs y ubicacion estandar.
4. Crear checklist de verificacion diaria de servicio.

Esfuerzo estimado: 2 a 3 dias.
Dependencias: decision del stack de monitoreo (prometheus/grafana o equivalente).
DoD: health + metrica + procedimiento de consulta documentado.

### P4. Migraciones versionadas de base de datos

- Prioridad: Alta
- Impacto si no se hace: Riesgo de inconsistencias entre ambientes.
- Estado actual: Pendiente formal (hay autocreacion de esquema desde codigo).

Pasos tecnicos:

1. Seleccionar herramienta de migraciones (golang-migrate o equivalente).
2. Extraer estado actual de esquema a migraciones SQL versionadas.
3. Agregar flujo de apply/rollback por entorno.
4. Probar migracion en base vacia y base con datos reales.

Esfuerzo estimado: 2 a 4 dias.
Dependencias: respaldo de BD y ventana de mantenimiento.
DoD: pipeline de migracion reproducible y validado.

### P5. Cierre de QA funcional end-to-end

- Prioridad: Media
- Impacto si no se hace: Regresiones silenciosas al tocar frontend/backend.
- Estado actual: Parcial (build/test basico de frontend; backend sin pruebas funcionales robustas).

Pasos tecnicos:

1. Definir casos criticos E2E:
   - login/logout/refresh
   - alta de empleado por fotos
   - reconocimiento rafaga con y sin coincidencia
   - registro manual de asistencia
   - CRUD de usuarios (admin).
2. Automatizar al menos smoke E2E.
3. Integrar ejecucion en pipeline de entrega.

Esfuerzo estimado: 3 a 5 dias.
Dependencias: datos semilla y entorno de pruebas.
DoD: suite smoke E2E pasando en cada release.

### P6. Cierre de despliegue y operacion 24/7

- Prioridad: Media
- Impacto si no se hace: dependencia de arranque manual y riesgo operativo.
- Estado actual: Parcial (scripts listos; falta orquestacion y endurecimiento final).

Pasos tecnicos:

1. Definir mecanismo de servicio persistente (task scheduler/servicio Windows/contenedores).
2. Formalizar procedimiento de arranque automatico post reinicio.
3. Definir backup de BD y prueba de restauracion.
4. Cerrar runbook de incidentes con escalamiento.

Esfuerzo estimado: 2 a 4 dias.
Dependencias: politica de TI interna.
DoD: operacion estable sin intervencion manual continua.

### P7. Mejora multipersona (fase evolutiva)

- Prioridad: Media (funcionalidad evolutiva)
- Impacto si no se hace: limitacion en entradas simultaneas.
- Estado actual: Pendiente.

Pasos tecnicos:

1. Extender protobuf para respuesta multipersona.
2. Actualizar IA para retornar lista de matches por frame.
3. Actualizar backend y endpoint REST para consumir/validar multiples resultados.
4. Adaptar frontend para mostrar resultados y registrar asistencias multiples.

Esfuerzo estimado: 4 a 8 dias.
Dependencias: definicion de reglas de negocio para colisiones y duplicados.
DoD: reconocimiento multipersona funcional y probado.

## 2. Plan sugerido por fases (orden recomendado)

### Fase 1: Estabilizacion de salida (Semana 1)

1. P1 Calibracion final en campo.
2. P2 Carga/estabilidad.
3. P3 Observabilidad minima.

Resultado esperado: sistema estable y medible para operacion controlada.

### Fase 2: Endurecimiento tecnico (Semana 2)

1. P4 Migraciones versionadas.
2. P5 QA E2E smoke.
3. P6 Operacion 24/7 y backup.

Resultado esperado: despliegue reproducible y mantenible.

### Fase 3: Evolutivos (Semana 3+)

1. P7 Multipersona.
2. Mejoras UX/reportes segun negocio.

Resultado esperado: escalamiento funcional.

## 3. Registro de estado por pendiente

| ID | Pendiente | Prioridad | Estado al 2026-03-19 | Esfuerzo | Riesgo | Responsable recomendado |
|---|---|---|---|---|---|---|
| P1 | Calibracion FAR/FRR en campo | Alta | En progreso | 3-5 dias | Alto | IA + Operacion |
| P2 | Pruebas de carga/estabilidad | Alta | Pendiente | 2-4 dias | Alto | Backend + QA |
| P3 | Health + metricas | Alta | Pendiente | 2-3 dias | Alto | Backend |
| P4 | Migraciones versionadas | Alta | Pendiente | 2-4 dias | Medio-alto | Backend/DBA |
| P5 | QA E2E smoke | Media | Parcial | 3-5 dias | Medio | QA + Frontend |
| P6 | Operacion 24/7 | Media | Parcial | 2-4 dias | Medio | DevOps/Infra |
| P7 | Multipersona | Media | Pendiente | 4-8 dias | Medio | Fullstack + IA |

## 4. Riesgos de traspaso y mitigacion

1. Riesgo: perdida de contexto funcional.
   - Mitigacion: usar este plan + `03_OPERACION_Y_SOPORTE.md` como runbook obligatorio.

2. Riesgo: cambio de parametros sin evidencia.
   - Mitigacion: todo ajuste de threshold debe quedar con reporte en `reports/ia`.

3. Riesgo: salida a produccion sin validacion final.
   - Mitigacion: no liberar sin completar P1, P2 y P3.

## 5. Criterio de cierre final del proyecto

El proyecto se considera listo para cierre tecnico cuando:

1. Precision biometrica final validada y documentada en entorno real.
2. Pruebas de carga superadas con umbrales acordados.
3. Health checks y metricas en operacion.
4. Migraciones de BD versionadas y reversibles.
5. Smoke E2E ejecutado en cada release candidata.
6. Runbook 24/7 y respaldo de BD validados.
