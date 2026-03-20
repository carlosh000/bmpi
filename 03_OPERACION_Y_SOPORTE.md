# 03 OPERACION Y SOPORTE - BMPI

Fecha de emision: 2026-03-19
Objetivo: permitir operacion, soporte y continuidad del sistema sin dependencia del desarrollador saliente.

## 1. Operacion diaria (modo recomendado)

### 1.1 Arranque en desarrollo

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode dev
```

Verificar servicios:

1. Frontend: `http://localhost:4200`
2. Backend: `http://localhost:8080`
3. IA gRPC: `127.0.0.1:50051` (puerto escuchando)

### 1.2 Apagado limpio

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode dev
```

### 1.3 Arranque en produccion local controlada

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode prod
```

Usar checklist:

- `scripts/CHECKLIST_GO_LIVE_RAPIDO.md`

## 2. Configuracion por entorno

Archivos:

- Dev: `scripts/.env.dev`
- Prod: `scripts/.env.production`

Reglas operativas:

1. No subir secretos reales al repositorio.
2. Mantener `.env.production` solo en servidor/host autorizado.
3. Validar en cada despliegue:
   - `DB_PASSWORD`
   - `BMPI_BOOTSTRAP_ADMIN_USER`
   - `BMPI_BOOTSTRAP_ADMIN_PASS`
   - `BMPI_FACE_GRPC_ADDR`
   - `BMPI_FACE_THRESHOLD`

## 3. Pruebas minimas antes de liberar

### 3.1 Validacion tecnica rapida

1. Backend:

```powershell
cd backend
go test ./...
```

2. Frontend:

```powershell
cd attendance-web
npm run build
npm run test -- --watch=false
```

### 3.2 Smoke funcional recomendado

1. Login con usuario valido.
2. Consulta de asistencias (`GET /api/attendance`).
3. Registro de un empleado con 5 fotos (`/api/employees/register-photos`).
4. Prueba de reconocimiento por rafaga (`/api/attendance/recognize-burst`).
5. Confirmar registro en BD de asistencia.

Script disponible para smoke de registro por fotos:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\smoke_prod_registro_fotos.ps1 -EmployeeId 9500 -EmployeeName "Prod Smoke" -PhotoDir "datasets/empresa_eval_20260220/known/200"
```

## 4. Monitoreo minimo sugerido

## 4.1 Indicadores clave

1. Disponibilidad de backend (`:8080`) e IA (`:50051`).
2. Latencia de endpoints criticos:
   - `POST /api/employees/register-photos`
   - `POST /api/attendance/recognize-burst`
3. Tasa de error HTTP (4xx y 5xx).
4. Tasa de no reconocimiento en flujo de entrada.
5. Errores gRPC (`Unavailable`, `DeadlineExceeded`).

### 4.2 Frecuencia de revision

1. Inicio de turno: estado de servicios y prueba de login.
2. Mitad de turno: latencia y errores acumulados.
3. Fin de turno: resumen de incidentes y acciones pendientes.

## 5. Fallas comunes y resolucion

### F1. Frontend no levanta o falla `ng build` con `spawn EPERM`

Sintoma:

- Error `spawn EPERM` en Angular/esbuild.

Acciones:

1. Reintentar fuera de entorno restringido (sandbox).
2. Ejecutar con `npm.cmd` en lugar de `npm` si hay politica de PowerShell.
3. Confirmar permisos de ejecucion y antivirus/EDR.

### F2. Error de PowerShell al ejecutar `npm`

Sintoma:

- `npm.ps1` bloqueado por execution policy.

Acciones:

1. Usar `npm.cmd run ...`.
2. O abrir shell con politica permitida para la sesion.

### F3. Backend no conecta a DB

Sintoma:

- Mensajes de error de conexion PostgreSQL o endpoints sin datos.

Acciones:

1. Revisar `DB_HOST`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSLMODE`.
2. Verificar que PostgreSQL este activo y accesible.
3. Confirmar credenciales en `.env` correcto.

### F4. Reconocimiento no detecta rostro con frecuencia

Sintoma:

- Muchas respuestas sin match o sin deteccion.

Acciones:

1. Revisar calidad de fotos e iluminacion.
2. Ejecutar verificadores de dataset/calidad.
3. Ajustar parametros IA:
   - `BMPI_FACE_THRESHOLD`
   - `BMPI_FACE_DETECT_RETRY_UPSAMPLE`
   - `BMPI_FACE_MODEL(_FALLBACK)`

### F5. Registro de asistencia duplicado/bloqueado

Sintoma:

- Registro rechazado en el mismo dia.

Acciones:

1. Validar regla de unicidad por empleado/dia.
2. Verificar zona horaria de servidor/BD.
3. Confirmar que no sea intento legitimo duplicado.

## 6. Operacion de dataset y calibracion

Scripts clave:

1. Preparar dataset:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\preparar_dataset_empresa.ps1
```

2. Verificar avance:

```powershell
python scripts\verificar_dataset_empresa.py --dataset datasets\empresa_eval_YYYYMMDD --output reports\ia
```

3. Verificar calidad:

```powershell
python scripts\verificar_calidad_fotos.py --dataset datasets\empresa_eval_YYYYMMDD --output reports\ia
```

4. Evaluacion semaforo:

```powershell
python scripts\evaluar_ia_empresa.py --dataset datasets\empresa_eval_YYYYMMDD --output reports\ia
```

## 7. Politica de despliegue sugerida

1. Congelar parametros (`.env.production`) antes de release.
2. Ejecutar checklist y smoke en ambiente candidato.
3. Aplicar despliegue en ventana controlada.
4. Monitorear 24-48 horas primeras.
5. Tener rollback operativo preparado (stop + restauracion de version previa).

## 8. Respaldo y recuperacion

Minimo requerido:

1. Backup diario de PostgreSQL.
2. Backup de `.env.production` en almacenamiento seguro.
3. Resguardo de reportes de calibracion (`reports/ia`) por version.

Prueba obligatoria:

- Simular restauracion de BD al menos una vez antes de salida formal.

## 9. Relevo operativo (handoff)

Checklist de transferencia a nuevo responsable:

1. Entregar este paquete de documentos.
2. Mostrar arranque/parada en vivo (`iniciar_bmpi`/`detener_bmpi`).
3. Ejecutar un ciclo completo:
   - login
   - registro fotos
   - reconocimiento
   - validacion en asistencia.
4. Entregar valores de configuracion no sensibles por ambiente.
5. Transferir accesos y contactos de soporte (sin secretos en texto plano).

## 10. Contactos y accesos (plantilla para completar)

Completar por la organizacion antes de cierre formal:

- Responsable tecnico entrante: `PENDIENTE`
- Responsable de infraestructura: `PENDIENTE`
- Responsable de BD: `PENDIENTE`
- Responsable de operacion de camaras/sitio: `PENDIENTE`
- Ruta segura de secretos: `PENDIENTE`
- Ruta de backups y restauracion: `PENDIENTE`

Sin esta seccion completa, no se recomienda declarar cierre operativo definitivo.
