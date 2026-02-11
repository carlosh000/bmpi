# 🔎 Análisis: ¿Qué le falta al proyecto BMPI?

Este documento resume brechas técnicas detectadas al revisar el estado actual del repositorio y ejecutar verificaciones básicas.

## 1) Integración frontend ↔ backend incompleta (brecha crítica)

### Hallazgo
- El frontend consume un endpoint REST fijo: `http://localhost:8080/api/attendance`.
- El backend implementado expone **gRPC** en `:50052` y depende de otro servicio gRPC en `:50051`.

### Impacto
- La UI no puede mostrar asistencias reales porque no existe un bridge REST/gRPC visible en este repo.
- La aplicación queda funcionalmente partida: frontend espera HTTP/JSON, backend ofrece gRPC.

### Qué falta
- Definir una estrategia única de integración:
  1. Exponer REST en el backend Go (o gRPC-gateway), **o**
  2. Consumir gRPC desde frontend mediante BFF/proxy.
- Documentar contrato API final y puertos oficiales por entorno.

---

## 2) Contrato protobuf desalineado (riesgo alto)

### Hallazgo
- `backend/proto/face_recognition.proto` no coincide con los campos reflejados en `backend/pb/face_recognition.pb.go`.
- Ejemplo: en el `.proto` aparece `employee_id` como `string` y `image`; en el `.pb.go` aparecen `employee_id int32`, `email`, `face_image`.

### Impacto
- Riesgo de incompatibilidad entre cliente y servidor (errores difíciles de depurar).
- Posible uso de código generado antiguo o de otro contrato.

### Qué falta
- Regenerar artefactos protobuf desde una única fuente de verdad.
- Alinear `proto`, `pb` de Go y `pb` de Python.
- Agregar check en CI para detectar drift de protobuf (por ejemplo, falla si `git diff` después de generar).

---

## 3) SSR del frontend hace llamadas reales en build (riesgo medio-alto)

### Hallazgo
- Durante `ng build`, SSR/prerender intenta llamar `http://localhost:8080/api/attendance` y dispara `HttpErrorResponse`.

### Impacto
- Build frágil/no determinístico según disponibilidad local del backend.
- Complicaciones en despliegue automatizado.

### Qué falta
- Manejar datos para SSR (mock, transferencia de estado, fallback seguro).
- Evitar llamadas directas duras en prerender sin backend disponible.

---

## 4) Calidad frontend: warnings y pruebas desactualizadas (riesgo medio)

### Hallazgos
- Warning Angular: `*ngFor` usado sin importar `NgFor`/`CommonModule` en componente standalone.
- Warning Angular: `RouterOutlet` importado pero no utilizado.
- Pruebas no corren por dependencia faltante para navegador de Vitest.
- `app.spec.ts` aún valida un `<h1>Hello, attendance-web>` que no existe en la plantilla actual.

### Impacto
- Menor mantenibilidad y riesgo de regresiones.
- Señales tempranas de deuda técnica activa.

### Qué falta
- Corregir imports standalone y limpiar warnings.
- Actualizar tests a comportamiento real de la app.
- Completar configuración de test runner para ejecución en CI.

---

## 5) Operación/infra: faltan piezas de despliegue y configuración (riesgo medio)

### Hallazgos
- No se observaron `Dockerfile` ni `docker-compose` en el repo.
- No se observaron migraciones SQL versionadas.
- En Python hay credenciales de PostgreSQL hardcodeadas (`host`, `user`, `password`).

### Impacto
- Entornos no reproducibles.
- Riesgo de seguridad por secretos en código.
- Difícil escalar a QA/producción.

### Qué falta
- Variables de entorno para configuración sensible.
- Plantilla `.env.example` y carga de configuración por entorno.
- Migraciones de DB (por ejemplo, goose/flyway/alembic) con esquema versionado.
- Contenedores para levantar stack local de forma consistente.

---

## 6) Ingeniería de producto: faltan criterios operativos

### Qué falta (a nivel funcional y de negocio)
- Definición formal de reglas de entrada/salida (turnos, tolerancias, nocturnidad).
- Estados y flujos para no reconocidos/reintentos.
- Métricas mínimas del modelo (FAR/FRR, umbral por sitio/cámara).
- Auditoría y trazabilidad (quién/qué/cuándo) para incidencias.

---

## 7) Prioridad sugerida (roadmap corto)

1. **Bloque 1 (crítico):** unificar contrato de integración (REST/gRPC) y alinear protobuf.
2. **Bloque 2:** robustecer frontend (SSR-safe data, warnings 0, tests actualizados).
3. **Bloque 3:** hardening operativo (env vars, migraciones, dockerización, CI).
4. **Bloque 4:** reglas de negocio y métricas biométricas para salida productiva.

---

## Verificaciones ejecutadas para este diagnóstico

- `npm --prefix attendance-web run build`
- `npm --prefix attendance-web run test -- --watch=false --browsers=ChromeHeadless`
- `go build ./...` (en `backend`)
- `go test ./...` (en `backend`)

