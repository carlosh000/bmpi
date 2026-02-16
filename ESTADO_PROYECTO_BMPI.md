# 📌 Estado del Proyecto BMPI

> Documento vivo para llevar el registro de lo implementado, lo pendiente y las mejoras recomendadas.
> Última actualización: 2026-02-16.

---

## 1) Objetivo del proyecto

Construir un sistema de asistencia con reconocimiento facial que permita:

- identificar empleados por rostro,
- registrar entradas/salidas automáticamente,
- consultar y administrar registros desde interfaz web,
- sostener operación local inicial con posibilidad de escalar a servidor interno.

---

## 2) Arquitectura actual (resumen)

### Componentes

1. **Frontend Angular (`attendance-web`)**
   - UI para gestionar asistencia.
   - Consumo de endpoints REST (`/api/...`).

2. **Backend Go (`backend`)**
   - Servicio gRPC como capa principal.
   - Bridge REST para compatibilidad con frontend Angular.

3. **Servicio IA Python (`ml-model`)**
   - Registro/reconocimiento facial.
   - Integración con PostgreSQL para embeddings y asistencia.

4. **PostgreSQL**
   - Persistencia de empleados/asistencias (en servicio IA).

---

## 3) ✅ Avance logrado (lo que ya está hecho)

### 3.1 Frontend

- Existe una aplicación Angular funcional con módulo de asistencia.
- Implementación de consumo REST para:
  - `GET /api/attendance`
  - `POST /api/embeddings/extract`
- Interfaz con gestión de registros y flujo de carga de fotos para embeddings.

### 3.2 Backend

- Servicio gRPC operativo (`:50052`) que actúa como proxy hacia servicio facial (`:50051`).
- Métodos gRPC implementados y conectados:
  - `RegisterEmployee`
  - `RecognizeFace`
  - `LogAttendance`
  - `ListEmployees`
- Bridge REST añadido para compatibilizar con Angular:
  - `GET /api/attendance`
  - `POST /api/attendance`
  - `POST /api/embeddings/extract` (stub actual)
- Almacenamiento temporal en memoria para registros REST de asistencia.

### 3.3 Contrato protobuf

- Se detectó y corrigió desalineación entre fuentes.
- Contrato base actualmente sincronizado entre:
  - `backend/proto/face_recognition.proto`
  - `backend/pb/*.pb.go`
  - `backend/vendor/.../pb/*.pb.go`
- Se agregó script de verificación de drift: `scripts/verificar_proto_sync.sh`.

### 3.4 Operación técnica mínima

- Backend compila y pruebas Go ejecutan sin errores.
- Script de verificación IA/Backend disponible en repo.

---

## 4) ⚠️ Lo pendiente (brechas actuales)

## 4.1 Integración real REST ↔ IA

Actualmente el endpoint de embeddings en backend REST está en modo **stub**.

**Falta:**
- conectar `POST /api/embeddings/extract` con el servicio Python real,
- definir formato definitivo de request/response,
- manejar errores y tiempos de espera robustamente.

## 4.2 Persistencia consistente en backend Go

La asistencia REST actual usa almacenamiento en memoria.

**Falta:**
- persistencia en PostgreSQL desde backend o consolidar una sola capa de persistencia,
- evitar divergencia entre “registros en memoria” y “registros reales de DB”.

## 4.3 Contrato protobuf y generación automática

Aunque quedó alineado, hace falta automatizar su mantenimiento.

**Falta:**
- pipeline reproducible de generación `protoc` (go + python),
- validación CI que falle si hay drift,
- guía de versionado de contrato (breaking vs non-breaking changes).

## 4.4 Pruebas de frontend

Hay deuda en pruebas y build del frontend según entorno.

**Falta:**
- estabilizar entorno para `ng build`/`ng test`,
- actualizar pruebas unitarias a comportamiento actual,
- cobertura mínima para vistas críticas.

## 4.5 Infraestructura y despliegue

No está completamente estandarizado el arranque del stack.

**Falta:**
- `docker-compose` para levantar frontend/backend/IA/db,
- `.env.example` y política de variables por entorno,
- migraciones versionadas de base de datos,
- checklist de despliegue local/QA/producción.

---

## 5) 🧩 Lo que necesita el proyecto para salir a producción

1. **Unificación de la fuente de verdad de datos**
   - decidir claramente qué servicio “escribe” asistencia final.

2. **Persistencia real y auditoría**
   - registros con trazabilidad (quién, cuándo, origen, resultado).

3. **Seguridad y configuración**
   - remover credenciales hardcodeadas,
   - usar variables de entorno y secretos por entorno.

4. **Observabilidad**
   - logs estructurados,
   - métricas de latencia/errores,
   - health checks para cada servicio.

5. **Definición funcional formal**
   - reglas de entrada/salida,
   - ventana anti-duplicado,
   - casos de no reconocidos y reintentos.

---

## 6) 🚀 Mejoras recomendadas (prioridad sugerida)

## Prioridad Alta

- Integrar embeddings reales en endpoint REST.
- Consolidar persistencia en PostgreSQL.
- Pipeline de generación protobuf + validación CI.

## Prioridad Media

- Dockerización completa.
- Pruebas frontend/backend más robustas.
- Mejorar manejo de errores en UX.

## Prioridad Baja

- Dashboard de métricas de asistencia.
- Exportaciones avanzadas (PDF/CSV con filtros).
- Reportes por área/turno y alertas operativas.

---

## 7) Riesgos técnicos identificados

- **Riesgo de drift de contrato** si no se automatiza generación protobuf.
- **Riesgo de inconsistencia de datos** por coexistencia de memoria y DB.
- **Riesgo operativo** por ausencia de infraestructura estandarizada.
- **Riesgo de calidad** por cobertura de pruebas insuficiente.

---

## 8) Registro de decisiones (sugerido)

> Usar esta plantilla para nuevas decisiones técnicas.

- **Fecha:** YYYY-MM-DD
- **Decisión:** (ej. “La asistencia final se persiste en backend Go”).
- **Motivo:**
- **Impacto:**
- **Alternativas descartadas:**

---

## 9) Roadmap corto (4 bloques)

### Bloque 1 — Integración crítica
- Conectar embeddings reales en REST.
- Validar flujo E2E cámara → reconocimiento → asistencia.

### Bloque 2 — Datos y contrato
- Persistencia única en DB.
- Pipeline automático de protobuf.

### Bloque 3 — Operación
- Docker + envs + migraciones.
- Health checks y logs estructurados.

### Bloque 4 — Calidad y producto
- Pruebas automatizadas.
- Reglas de negocio completas.
- Métricas biométricas y operativas.

---

## 10) Checklist de seguimiento continuo

- [ ] Contrato protobuf versionado y con generación reproducible.
- [ ] CI validando drift protobuf y compilación de servicios.
- [ ] Persistencia de asistencia consolidada (sin memoria temporal en producción).
- [ ] Endpoint de embeddings integrado con IA real.
- [ ] Variables de entorno y secretos estandarizados.
- [ ] Docker Compose funcional para entorno local.
- [ ] Migraciones de DB versionadas.
- [ ] Pruebas frontend y backend en verde.
- [ ] Documento de reglas de negocio aprobado por operación.

---

## 11) Nota de uso del documento

Este archivo debe actualizarse en cada avance importante (features, fixes, decisiones de arquitectura, cambios de contrato o despliegue), para conservar historial técnico y claridad de pendientes.
