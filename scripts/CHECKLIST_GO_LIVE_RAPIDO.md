# Checklist Go-Live Rápido BMPI (5 pasos)

1. Completar secretos en `scripts/.env.production`
   - `BMPI_OPERATOR_API_KEY`
   - `BMPI_ADMIN_API_KEY`
   - `DB_PASSWORD`

2. Validar conectividad antes de arrancar
   - DB PostgreSQL accesible con `DB_SSLMODE=require` en producción.
   - Puerto IA `50051` y backend `8080` libres.

3. Arrancar en modo producción
   - `powershell.exe -ExecutionPolicy Bypass -File .\scripts\iniciar_bmpi.ps1 -Mode prod`

4. Ejecutar smoke tests de salida
   - `GET /api/attendance` responde 200.
   - Flujo de extracción + guardado con 1 empleado (5 fotos) responde éxito.
   - Script recomendado:
     - `powershell.exe -ExecutionPolicy Bypass -File .\scripts\smoke_prod_registro_fotos.ps1 -EmployeeId 9500 -EmployeeName "Prod Smoke" -PhotoDir "datasets/empresa_eval_20260220/known/200"`

5. Verificación post-arranque y rollback
   - Confirmar que no hay errores gRPC `Unavailable` en primer ciclo.
   - Si falla estabilidad, detener y volver a último entorno estable:
     - `powershell.exe -ExecutionPolicy Bypass -File .\scripts\detener_bmpi.ps1 -Mode prod`
