# Avance Cierre IA - 2026-03-03

## Resumen ejecutivo

- Estado actual: **apto para piloto operativo**, **no apto aun para liberacion empresarial masiva** por FRR/FAR.
- Extraccion por interfaz (`/api/embeddings/extract`) validada con dataset actual: **96/96 OK (100.0%)**.
- Prueba dirigida de fotos conflictivas: **5/5 OK** en extraccion por API.
- Registro por lote (`/api/employees/register-photos`) verificado post-reinicio: **5/5 procesadas**, `failedPhotos=0`.

## Evidencia utilizada

- Dataset base: `datasets/empresa_eval_20260302_lote1`
- Reporte de evaluacion vigente (mas reciente):
  - `reports/ia/evaluacion_ia_20260303_141214.md`
- Reporte de calidad vigente:
  - `reports/ia/verificacion_calidad_fotos_20260303_140532.md`
- Registro de recaptura minima:
  - `reports/ia/recaptura_minima_server_like_20260303_092921.csv`
- Estado general actualizado:
  - `ESTADO_GENERAL_BMPI.md` (seccion 17)

## Nota de control documental

- Para evitar confusion, los reportes historicos fueron movidos a:
  - `reports/ia/historico/20260303_limpieza/`
- En `reports/ia/` solo quedan archivos vigentes de trabajo.

## Cambios tecnicos aplicados

- `ml-model/face_server.py`
  - auto-orientacion EXIF al procesar imagen,
  - normalizacion de imagen en runtime,
  - mas cobertura de candidatos para reconocimiento,
  - seleccion diversa de candidatos para robustez en perfil lateral,
  - `RecognizeFace` ahora usa decode auto-orientado (consistente con registro).
- `scripts/.env.dev` y `scripts/.env.production`
  - configuracion de fallback para deteccion lateral/condiciones dificiles.
- `scripts/evaluar_ia_empresa.py`
  - alineacion del evaluador offline con pipeline real de servicio IA.

## Checklist de control

### Ya no es necesario seguir revisando en esta fase

- [x] Integracion frontend-backend-IA para extraccion de embeddings.
- [x] Arranque tecnico del stack (`4200`, `8080`, `50051`).
- [x] Manejo de casos laterales en extraccion (lote actual validado al 100%).

### Aun se debe revisar antes de cierre empresarial final

- [ ] Recaptura puntual de identidades con baja muestra util (ej. `genuine/2`, `genuine/1`, `genuine/6`, `known/2`, `known/3`).
- [ ] Prueba de campo real 1-2 dias con camara/flujo operativo real.
- [ ] Calibrar y congelar umbral final por sede/camara (FAR/FRR objetivo negocio).
- [ ] Ejecutar smoke final de go-live y validar rollback documentado.

## Recomendacion de siguiente paso

1. Ejecutar prueba de campo corta con operadores reales.
2. Confirmar umbral final en produccion.
3. Emitir acta de cierre tecnico-operativo para liberacion.
