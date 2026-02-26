# Dataset de evaluaciÃ³n empresarial BMPI

- Ruta: C:\Users\practicante\Desktop\bmpi-main\datasets\empresa_eval_20260224
- Empleados: 30
- Objetivo known: 5 por empleado (total mÃ­nimo: 150)
- Objetivo genuine: 10 por empleado (total mÃ­nimo: 300)
- Objetivo impostor: 10 por identidad (identidades: 30, total mÃ­nimo: 300)

## Estructura
- known/<employee_id>/
- genuine/<employee_id>/
- impostor/persona_XXX/

## Siguiente paso
1) Sustituye los archivos _CAPTURA_AQUI.txt por fotos reales.
2) Actualiza estados en capture_plan.csv.
3) Ejecuta: python scripts/evaluar_ia_empresa.py --dataset "C:\Users\practicante\Desktop\bmpi-main\datasets\empresa_eval_20260224" --output reports/ia
