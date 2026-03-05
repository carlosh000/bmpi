# Recaptura final priorizada - 2026-03-04

Objetivo: bajar FRR/FAR para cierre empresarial. Base: `reports/ia/recaptura_fotos_20260303_140532.csv`.

## 1) Prioridad critica (hacer primero)

Estas identidades tienen poca muestra util y hoy son las que mas pegan al FRR.

- `genuine/2` (2 fotos)
  - `genuine/2/20260223_113735.jpg`
  - `genuine/2/20260223_113739.jpg`
- `genuine/1` (2 fotos)
  - `genuine/1/20260223_113338.jpg`
  - `genuine/1/20260223_113345.jpg`
- `genuine/6` (2 fotos)
  - `genuine/6/20260223_114438.jpg`
  - `genuine/6/20260223_114441.jpg`
- `known/2` (3 fotos)
  - `known/2/20260223_113703.jpg`
  - `known/2/20260223_113720.jpg`
  - `known/2/20260223_113724.jpg`
- `known/3` (3 fotos)
  - `known/3/20260223_113923.jpg`
  - `known/3/20260223_113931.jpg`
  - `known/3/20260223_113940.jpg`

Total prioridad critica: **12 fotos**.

## 2) Prioridad alta (segunda pasada)

- `genuine/12/20260223_115151.jpg`
- `genuine/12/20260223_115156.jpg`
- `genuine/8/20260223_114711.jpg`
- `genuine/8/20260223_114715.jpg`
- `known/1/20260223_113151.jpg`
- `known/1/20260223_113156.jpg`

Total prioridad alta: **6 fotos**.

## 3) Resto recomendado

- `genuine/3/20260223_114005.jpg`
- `genuine/5/20260223_114208.jpg`
- `known/10/20260223_114948.jpg`
- `known/11/20260223_115030.jpg`
- `known/12/20260223_115134.jpg`
- `known/4/20260223_114046.jpg`
- `known/5/20260223_114136.jpg`
- `known/6/20260223_114421.jpg`
- `known/7/20260223_114615.jpg` (rostro pequeno/area baja)
- `known/8/20260223_114656.jpg`
- `impostor/persona_001/20260223_115256.jpg` (rostro_area_baja)

Total resto: **11 fotos**.

## 4) Regla de captura para que si entren

- Rostro centrado y ocupando aprox 25-45% del frame.
- Angulo lateral moderado (no perfil total), mantener ambos ojos visibles cuando sea posible.
- Sin contraluz; luz frontal uniforme.
- Distancia consistente (evitar rostro demasiado pequeno).

## 5) Cierre tecnico despues de recaptura

1. Reemplazar solo las rutas listadas arriba.
2. Ejecutar:
   - `python scripts/verificar_calidad_fotos.py --dataset datasets/empresa_eval_20260303_prodclean --output reports/ia`
   - `python scripts/evaluar_ia_empresa.py --dataset datasets/empresa_eval_20260303_prodclean --output reports/ia --allow-insufficient-dataset --no-rotation-fallback --model-fallback hog --thresholds 0.45,0.50,0.55`
3. Validar semaforo y actualizar `ESTADO_GENERAL_BMPI.md`.
