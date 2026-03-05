# Verificación de calidad de fotos

- Fecha: 2026-03-03T09:33:13
- Dataset: C:\Users\practicante\Desktop\bmpi-main\datasets\empresa_eval_20260303_sin5
- Imágenes evaluadas: 91
- OK: 67
- Con problemas: 24
- OK rate: 73.63%

## Umbrales usados

- blur_min: `80.0`
- brightness_min: `60.0`
- brightness_max: `200.0`
- face_height_ratio_min: `0.2`
- face_area_ratio_min: `0.06`
- center_distance_ratio_max: `0.35`

## Problemas más frecuentes

- sin_rostro_detectado: `22`
- rostro_area_baja: `2`
- rostro_pequeno: `1`

## Sugerencias

- Si predomina `desenfoque_alto`: estabilizar cámara y repetir captura.
- Si predomina `iluminacion_baja`/`iluminacion_alta`: ajustar luz uniforme frontal.
- Si predomina `rostro_pequeno`/`rostro_area_baja`: acercar cámara o recortar mejor.
- Si predomina `rostro_fuera_centro`: pedir encuadre centrado del rostro.
- Si aparece `multiples_rostros`: recapturar imagen individual por empleado.

## Prioridad de recaptura por identidad

| group | identity | photos_to_retake |
|---|---|---:|
| known | 2 | 3 |
| known | 3 | 3 |
| genuine | 1 | 2 |
| genuine | 2 | 2 |
| genuine | 6 | 2 |
| genuine | 8 | 2 |
| known | 1 | 2 |
| genuine | 12 | 1 |
| genuine | 3 | 1 |
| impostor | persona_001 | 1 |
| known | 11 | 1 |
| known | 12 | 1 |
| known | 5 | 1 |
| known | 7 | 1 |
| known | 8 | 1 |

- CSV completo de recaptura: `reports\ia\recaptura_fotos_20260303_093313.csv`
