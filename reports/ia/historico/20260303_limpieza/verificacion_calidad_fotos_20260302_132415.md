# Verificación de calidad de fotos

- Fecha: 2026-03-02T13:24:15
- Dataset: C:\Users\practicante\Desktop\bmpi-main\datasets\empresa_eval_20260302_lote1
- Imágenes evaluadas: 96
- OK: 8
- Con problemas: 88
- OK rate: 8.33%

## Umbrales usados

- blur_min: `80.0`
- brightness_min: `60.0`
- brightness_max: `200.0`
- face_height_ratio_min: `0.2`
- face_area_ratio_min: `0.06`
- center_distance_ratio_max: `0.35`

## Problemas más frecuentes

- rostro_area_baja: `66`
- rostro_pequeno: `28`
- desenfoque_alto: `16`
- sin_rostro_detectado: `13`
- multiples_rostros: `12`

## Sugerencias

- Si predomina `desenfoque_alto`: estabilizar cámara y repetir captura.
- Si predomina `iluminacion_baja`/`iluminacion_alta`: ajustar luz uniforme frontal.
- Si predomina `rostro_pequeno`/`rostro_area_baja`: acercar cámara o recortar mejor.
- Si predomina `rostro_fuera_centro`: pedir encuadre centrado del rostro.
- Si aparece `multiples_rostros`: recapturar imagen individual por empleado.

## Prioridad de recaptura por identidad

| group | identity | photos_to_retake |
|---|---|---:|
| known | 10 | 5 |
| known | 11 | 5 |
| known | 12 | 5 |
| known | 2 | 5 |
| known | 3 | 5 |
| known | 5 | 5 |
| known | 6 | 5 |
| known | 7 | 5 |
| known | 8 | 5 |
| genuine | 12 | 4 |
| genuine | 7 | 4 |
| genuine | 8 | 4 |
| known | 1 | 4 |
| known | 13 | 4 |
| known | 14 | 4 |
| known | 4 | 4 |
| genuine | 1 | 3 |
| genuine | 6 | 3 |
| genuine | 11 | 2 |
| genuine | 2 | 2 |

- CSV completo de recaptura: `reports\ia\recaptura_fotos_20260302_132415.csv`
