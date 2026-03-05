# Dataset de evaluaciÃ³n empresarial BMPI

- Ruta: c:\Users\practicante\Desktop\bmpi-main\datasets\empresa_eval_20260302_lote1
- Empleados: 13
- Objetivo known: 5 por empleado (total mÃ­nimo: 65)
- Objetivo genuine: 10 por empleado (total mÃ­nimo: 130)
- Objetivo impostor: 10 por identidad (identidades: 2, total mÃ­nimo: 20)

## Estructura
- known/<employee_id>/
- genuine/<employee_id>/
- impostor/persona_XXX/

## Siguiente paso
1) Sustituye los archivos _CAPTURA_AQUI.txt por fotos reales.
2) Actualiza estados en capture_plan.csv.
3) Ejecuta: python scripts/evaluar_ia_empresa.py --dataset "c:\Users\practicante\Desktop\bmpi-main\datasets\empresa_eval_20260302_lote1" --output reports/ia
