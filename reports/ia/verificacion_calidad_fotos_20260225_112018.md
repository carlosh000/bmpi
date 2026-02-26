# Verificación de calidad de fotos

- Fecha: 2026-02-25T11:20:18
- Dataset: C:\Users\practicante\Desktop\bmpi-main\datasets\empresa_eval_20260220
- Imágenes evaluadas: 11
- OK: 0
- Con problemas: 11
- OK rate: 0.00%

## Umbrales usados

- blur_min: `80.0`
- brightness_min: `60.0`
- brightness_max: `200.0`
- face_height_ratio_min: `0.2`
- face_area_ratio_min: `0.08`
- center_distance_ratio_max: `0.35`

## Problemas más frecuentes

- rostro_area_baja: `11`

## Sugerencias

- Si predomina `desenfoque_alto`: estabilizar cámara y repetir captura.
- Si predomina `iluminacion_baja`/`iluminacion_alta`: ajustar luz uniforme frontal.
- Si predomina `rostro_pequeno`/`rostro_area_baja`: acercar cámara o recortar mejor.
- Si predomina `rostro_fuera_centro`: pedir encuadre centrado del rostro.
- Si aparece `multiples_rostros`: recapturar imagen individual por empleado.

## Prioridad de recaptura por identidad

| group | identity | photos_to_retake |
|---|---|---:|
| genuine | 200 | 5 |
| known | 200 | 5 |
| impostor | otro | 1 |

- CSV completo de recaptura: `reports\ia\recaptura_fotos_20260225_112018.csv`
