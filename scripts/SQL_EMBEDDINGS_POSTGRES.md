# SQL útil para embeddings (PostgreSQL)

Guía rápida para revisar embeddings guardados en la tabla `employees`.

## 1) Ver estado general de embeddings por empleado

```sql
SELECT
  id,
  employee_id,
  name,
  OCTET_LENGTH(embedding) AS embedding_bytes,
  OCTET_LENGTH(photo) AS photo_bytes,
  samples_count
FROM employees
ORDER BY id DESC;
```

## 2) Ver hash del embedding por empleado (comparación real)

```sql
SELECT
  id,
  employee_id,
  name,
  md5(encode(embedding, 'hex')) AS emb_hash,
  OCTET_LENGTH(embedding) AS embedding_bytes,
  OCTET_LENGTH(photo) AS photo_bytes,
  samples_count
FROM employees
WHERE embedding IS NOT NULL
ORDER BY id DESC;
```

## 3) Detectar embeddings duplicados reales

```sql
SELECT
  emb_hash,
  COUNT(*) AS total,
  string_agg(employee_id, ', ' ORDER BY employee_id) AS employee_ids
FROM (
  SELECT
    employee_id,
    md5(encode(embedding, 'hex')) AS emb_hash
  FROM employees
  WHERE embedding IS NOT NULL
) t
GROUP BY emb_hash
HAVING COUNT(*) > 1
ORDER BY total DESC;
```

## 4) Revisar un empleado específico

Usa un `employee_id` objetivo (reemplaza `:employee_id` por el valor real en tu cliente SQL).

```sql
SELECT
  id,
  employee_id,
  name,
  md5(encode(embedding, 'hex')) AS emb_hash,
  OCTET_LENGTH(embedding) AS embedding_bytes,
  OCTET_LENGTH(photo) AS photo_bytes,
  samples_count
FROM employees
WHERE employee_id = ':employee_id';
```

## 5) Ver preview del embedding binario (hex)

```sql
SELECT
  employee_id,
  LEFT(encode(embedding, 'hex'), 120) AS emb_hex_preview,
  OCTET_LENGTH(embedding) AS embedding_bytes
FROM employees
WHERE employee_id = ':employee_id';
```

## 6) Confirmar que embedding no sea NULL ni vacío

```sql
SELECT
  employee_id,
  name,
  (embedding IS NOT NULL) AS has_embedding,
  (OCTET_LENGTH(embedding) > 0) AS embedding_not_empty,
  OCTET_LENGTH(embedding) AS embedding_bytes
FROM employees
ORDER BY id DESC;
```

## 7) Empleados sin embedding (pendientes de registro facial)

```sql
SELECT
  id,
  employee_id,
  name,
  samples_count,
  OCTET_LENGTH(photo) AS photo_bytes
FROM employees
WHERE embedding IS NULL OR OCTET_LENGTH(embedding) = 0
ORDER BY id DESC;
```

## 8) Empleados con embedding pero sin foto

```sql
SELECT
  id,
  employee_id,
  name,
  samples_count,
  OCTET_LENGTH(embedding) AS embedding_bytes,
  OCTET_LENGTH(photo) AS photo_bytes
FROM employees
WHERE embedding IS NOT NULL
  AND OCTET_LENGTH(embedding) > 0
  AND (photo IS NULL OR OCTET_LENGTH(photo) = 0)
ORDER BY id DESC;
```

## 9) Ver top empleados por cantidad de muestras

```sql
SELECT
  employee_id,
  name,
  samples_count,
  OCTET_LENGTH(embedding) AS embedding_bytes,
  OCTET_LENGTH(photo) AS photo_bytes
FROM employees
ORDER BY samples_count DESC, id DESC
LIMIT 20;
```

## 10) Comparar 2 empleados por hash de embedding

```sql
SELECT
  employee_id,
  name,
  md5(encode(embedding, 'hex')) AS emb_hash,
  OCTET_LENGTH(embedding) AS embedding_bytes,
  samples_count
FROM employees
WHERE employee_id IN ('9303', '9302')
ORDER BY employee_id;
```

## 11) Buscar posible duplicidad de persona por nombre (normalizado)

```sql
SELECT
  LOWER(TRIM(name)) AS normalized_name,
  COUNT(*) AS total_rows,
  string_agg(employee_id, ', ' ORDER BY employee_id) AS employee_ids
FROM employees
GROUP BY LOWER(TRIM(name))
HAVING COUNT(*) > 1
ORDER BY total_rows DESC;
```

## 12) Resumen rápido de salud biométrica

```sql
SELECT
  COUNT(*) AS total_employees,
  COUNT(*) FILTER (WHERE embedding IS NOT NULL AND OCTET_LENGTH(embedding) > 0) AS with_embedding,
  COUNT(*) FILTER (WHERE photo IS NOT NULL AND OCTET_LENGTH(photo) > 0) AS with_photo,
  COUNT(*) FILTER (WHERE samples_count >= 5) AS samples_ge_5,
  COUNT(*) FILTER (WHERE samples_count < 5) AS samples_lt_5
FROM employees;
```

## Nota rápida

- `embedding_bytes` puede repetirse entre empleados y eso no implica duplicado.
- Para verificar igualdad real usa `emb_hash` (`md5(encode(embedding, 'hex'))`).
- Si la query de duplicados (sección 3) no devuelve filas, no hay embeddings repetidos.
- Si usas `psql`, puedes definir variable así: `\set employee_id '9303'` y luego usar `WHERE employee_id = :'employee_id'`.
