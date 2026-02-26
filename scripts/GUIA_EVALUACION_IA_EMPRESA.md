# Guía de evaluación IA para salida empresarial

Fecha base: 2026-02-20

Esta guía define cómo validar si el reconocimiento facial de BMPI está listo para uso en compañía con evidencia objetiva (no por percepción).

## 1) Objetivo

Determinar semáforo de salida:

- VERDE: listo para despliegue controlado
- AMARILLO: piloto con mitigaciones
- ROJO: no apto para salida

con base en:

- FAR (False Acceptance Rate)
- FRR (False Rejection Rate)
- tasa de detección de rostro
- latencia p95

## 2) Dataset mínimo recomendado

Estructura esperada:

```
<dataset>/
  known/
    1001/ img1.jpg img2.jpg ...
    1002/ img1.jpg img2.jpg ...
  genuine/
    1001/ test1.jpg test2.jpg ...
    1002/ test1.jpg test2.jpg ...
  impostor/
    persona_a/ img1.jpg ...
    persona_b/ img1.jpg ...
```

Mínimos para evaluación inicial confiable:

- empleados conocidos: >= 30
- imágenes `known` por empleado: >= 5
- imágenes `genuine` por empleado: >= 10
- imágenes `impostor` totales: >= 300

## 2.1) Protocolo de captura estandarizado (obligatorio)

Para reducir falsos rechazos y falsos aceptados, cada campaña debe seguir la misma calidad de captura:

- rostro frontal (variaciones leves izquierda/derecha, sin perfiles extremos)
- iluminación uniforme (evitar contraluz y sombras duras)
- sin accesorios que oculten rasgos (lentes oscuros, gorra, cubrebocas)
- foco nítido (sin movimiento/blur)
- encuadre estable (rostro ocupando zona central con tamaño consistente)
- mínimo de 5 a 10 fotos limpias por empleado en registro inicial

## 3) Ejecución

Antes de capturar, puedes preparar la estructura del dataset automáticamente:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\preparar_dataset_empresa.ps1
```

Checklist operativo rápido de captura:

- `scripts/CHECKLIST_CAPTURA_DATASET_EMPRESA.md`

Comando:

```powershell
python scripts/evaluar_ia_empresa.py --dataset C:\ruta\dataset --output reports\ia
```

Antes de calibrar umbral, se recomienda depurar calidad de fotos:

```powershell
python scripts/verificar_calidad_fotos.py --dataset C:\ruta\dataset --output reports\ia
```

Recaptura primero las imágenes reportadas con problemas (`desenfoque_alto`, `iluminacion_baja`, `rostro_pequeno`, `multiples_rostros`).

Para operación diaria rápida, puedes ejecutar todo el flujo con un solo comando:

```powershell
powershell.exe -ExecutionPolicy Bypass -File .\scripts\diagnostico_dataset_empresa.ps1 -Dataset "datasets/empresa_eval_YYYYMMDD" -UpdatePlanStatus -AllowInsufficientDataset
```

Opciones útiles:

- `--model hog|cnn`
- `--thresholds 0.35,0.40,0.45,0.50,0.55,0.60`
- límites de semáforo:
  - `--green-far-max`
  - `--green-frr-max`
  - `--green-p95-ms-max`
  - `--green-detection-min`
- forzar ejecución técnica con dataset incompleto:
  - `--allow-insufficient-dataset` (solo laboratorio, no decisión de negocio)

Salida:

- JSON con detalle por umbral
- Markdown con resumen ejecutivo + tabla comparativa

## 4) Criterios sugeridos de liberación

VERDE (recomendado para despliegue controlado):

- FAR <= 0.005
- FRR <= 0.03
- detection_rate >= 0.98
- p95 <= 1200 ms

AMARILLO (solo piloto):

- FAR <= 0.02
- FRR <= 0.08
- detection_rate >= 0.92
- p95 <= 2200 ms

ROJO:

- cualquier métrica fuera de AMARILLO

## 5) Checklist go-live IA (empresa)

### 5.1 Calidad biométrica

- [ ] campaña de pruebas por sede/cámara ejecutada
- [ ] umbral seleccionado con evidencia (reporte JSON/MD)
- [ ] FAR/FRR aprobados por Seguridad + RH

### 5.2 Rendimiento

- [ ] latencia p95 medida en horario pico
- [ ] capacidad validada para concurrencia esperada
- [ ] sin degradación crítica por memoria/CPU en jornada completa

### 5.3 Seguridad

- [ ] API keys obligatorias en producción (`BMPI_OPERATOR_API_KEY`, `BMPI_ADMIN_API_KEY`)
- [ ] TLS activo para gRPC entre backend e IA donde aplique
- [ ] política de acceso a DB y respaldos validada

### 5.4 Operación

- [ ] monitoreo básico activo (errores, latencia, disponibilidad)
- [ ] runbook de incidentes documentado
- [ ] piloto controlado 7-14 días sin incidentes críticos

## 6) Decisión final

Solo pasar a operación empresa cuando:

- semáforo VERDE sostenido,
- criterios de Seguridad/RH aprobados,
- piloto estable sin incidentes críticos.
