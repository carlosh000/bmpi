# Checklist operativo de captura de dataset empresarial

## 1) Preparar estructura (una vez)

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\preparar_dataset_empresa.ps1
```

Opcional (IDs reales de empleados):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\preparar_dataset_empresa.ps1 -EmployeeIds "1001,1002,1003,..."
```

## 2) Reglas de captura obligatorias

- rostro frontal (sin perfil extremo)
- luz uniforme (sin contraluz)
- sin accesorios que oculten rasgos
- foto nítida (sin blur)
- encuadre estable

## 3) Volumen mínimo objetivo

- `known`: 5 fotos por empleado
- `genuine`: 10 fotos por empleado
- `impostor`: 300 fotos totales (sugerido: 30 identidades x 10)
- empleados distintos: 30 o más

## 4) Control de avance

- usa `capture_plan.csv` dentro del dataset generado
- marca cada fila como `pendiente` o `completo`
- reemplaza todos los `_CAPTURA_AQUI.txt` por imágenes reales

Verificación automática de avance (sin reconocimiento):

```powershell
C:/Users/practicante/Desktop/bmpi-main/.venv/Scripts/python.exe scripts/verificar_dataset_empresa.py --dataset "C:\ruta\dataset" --output reports\ia
```

Para además actualizar `capture_plan.csv` con estado sugerido (`completo`/`pendiente`):

```powershell
C:/Users/practicante/Desktop/bmpi-main/.venv/Scripts/python.exe scripts/verificar_dataset_empresa.py --dataset "C:\ruta\dataset" --output reports\ia --update-plan-status
```

## 4.1) Control de calidad de fotos (recomendado antes de calibrar)

Ejecuta análisis automático de calidad para detectar imágenes problemáticas (blur, iluminación, rostro pequeño, múltiples rostros):

```powershell
C:/Users/practicante/Desktop/bmpi-main/.venv/Scripts/python.exe scripts/verificar_calidad_fotos.py --dataset "C:\ruta\dataset" --output reports\ia
```

Opcional (ajuste técnico):

```powershell
C:/Users/practicante/Desktop/bmpi-main/.venv/Scripts/python.exe scripts/verificar_calidad_fotos.py --dataset "C:\ruta\dataset" --output reports\ia --blur-min 90 --brightness-min 55 --brightness-max 205 --face-height-ratio-min 0.20 --face-area-ratio-min 0.06 --center-distance-ratio-max 0.35
```

Usa el reporte generado para recapturar primero las fotos marcadas con problemas más frecuentes.
El script también genera un CSV de trabajo para campo:

- `reports/ia/recaptura_fotos_YYYYMMDD_HHMMSS.csv`

## 5) Calibración y reporte

```powershell
C:/Users/practicante/Desktop/bmpi-main/.venv/Scripts/python.exe scripts/evaluar_ia_empresa.py --dataset "C:\ruta\dataset" --output reports\ia
```

Si el dataset aún no cumple mínimos y quieres solo prueba técnica:

```powershell
C:/Users/practicante/Desktop/bmpi-main/.venv/Scripts/python.exe scripts/evaluar_ia_empresa.py --dataset "C:\ruta\dataset" --output reports\ia --allow-insufficient-dataset
```

## 6) Criterio de decisión

- solo liberar a compañía con semáforo `VERDE`
- si sale `AMARILLO`: solo piloto controlado
- si sale `ROJO`: no liberar, mejorar dataset/umbral/captura

## 7) Plan de trabajo sin cámara (hoy)

- preparar/validar estructura de dataset
- revisar avance con `verificar_dataset_empresa.py`
- dejar `capture_plan.csv` actualizado para ejecución de campo
- dejar comandos de calibración listos para correr apenas haya cámara/fotos

## 8) Ejecución rápida (todo en uno)

Para correr diagnóstico completo en una sola ejecución:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\diagnostico_dataset_empresa.ps1 -Dataset "datasets/empresa_eval_YYYYMMDD" -UpdatePlanStatus -AllowInsufficientDataset
```

Si quieres solo control operativo rápido (sin FAR/FRR):

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\diagnostico_dataset_empresa.ps1 -Dataset "datasets/empresa_eval_YYYYMMDD" -UpdatePlanStatus -SkipEvaluation
```

Incluye:

- verificación de avance de dataset
- verificación de calidad de fotos
- evaluación FAR/FRR por umbral (modo técnico si el dataset aún no está completo)
