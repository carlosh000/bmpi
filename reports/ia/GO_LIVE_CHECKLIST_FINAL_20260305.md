# GO-LIVE Checklist Final - 2026-03-05

## 1) Pre-condiciones

- [ ] `scripts/.env.production` completado y validado.
- [ ] API keys definidas (`BMPI_OPERATOR_API_KEY`, `BMPI_ADMIN_API_KEY`).
- [ ] Cámara de acceso fija y con luz frontal estable.
- [ ] Dataset de empleados actualizado y sin fotos bloqueadas por calidad.

## 2) Arranque producción

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode prod
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode prod
```

## 3) Smoke técnico mínimo

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8080/api/attendance -Headers @{ 'X-API-Key'='<OPERATOR_KEY>' }
```

```powershell
# Probar register-photos (5 fotos)
# Esperado: saved[0].photosProcessed=5 y failedPhotos=0 (o bloqueos claros por calidad si aplica)
```

```powershell
# Probar reconocimiento ráfaga en entrada
# Endpoint: POST /api/attendance/recognize-burst
# Esperado: recognized=true y attendanceLogged=true en paso válido
```

## 4) Parámetros recomendados de entrada caminando

- `burstFrameCount=4`
- `burstFrameDelayMs=220`
- `minVotes=2`
- `minConfidence=0.35`

## 5) Criterios de aceptación de salida

- [ ] Frontend, backend e IA arriba sin reinicios inesperados.
- [ ] Registro de asistencia por ráfaga funcionando en operación real.
- [ ] Sin errores 5xx recurrentes en backend.
- [ ] FRR/FAR de campo dentro de objetivo de negocio acordado.

## 6) Rollback rápido

1. Detener stack:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode prod
```

2. Restaurar `.env.production` previo (backup).
3. Levantar stack con configuración anterior:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode prod
```

4. Validar `GET /api/attendance` y operación manual.
