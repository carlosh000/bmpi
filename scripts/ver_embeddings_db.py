#!/usr/bin/env python3
"""Inspecciona embeddings guardados en PostgreSQL para BMPI.

Uso rápido:
  python scripts/ver_embeddings_db.py --employee-id 9303 --show-vector --vector-limit 12
  python scripts/ver_embeddings_db.py --show-hash --limit 20
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import pickle
import sys
from dataclasses import dataclass
from typing import Any


@dataclass
class DbConfig:
    host: str
    dbname: str
    user: str
    password: str
    sslmode: str


def env(name: str, default: str) -> str:
    value = (os.getenv(name) or "").strip()
    return value if value else default


def resolve_db_config() -> DbConfig:
    is_prod = env("BMPI_ENV", "").lower() == "production"
    password = (os.getenv("DB_PASSWORD") or "").strip()

    return DbConfig(
        host=env("DB_HOST", "localhost"),
        dbname=env("DB_NAME", "bmpi"),
        user=env("DB_USER", "postgres"),
        password=password,
        sslmode=env("DB_SSLMODE", "require" if is_prod else "disable"),
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Ver embeddings guardados en PostgreSQL")
    parser.add_argument("--employee-id", default="", help="Filtra por employee_id exacto")
    parser.add_argument("--limit", type=int, default=50, help="Máximo de filas a mostrar")
    parser.add_argument("--show-vector", action="store_true", help="Muestra valores del embedding")
    parser.add_argument("--vector-limit", type=int, default=16, help="Cantidad de dimensiones a mostrar")
    parser.add_argument("--show-hash", action="store_true", help="Muestra hash md5 del embedding")
    parser.add_argument("--only-duplicates", action="store_true", help="Muestra solo embeddings repetidos por hash")
    return parser.parse_args()


def to_float_list(value: Any) -> list[float]:
    if hasattr(value, "tolist"):
        value = value.tolist()
    if isinstance(value, tuple):
        value = list(value)
    if not isinstance(value, list):
        return []

    out: list[float] = []
    for item in value:
        try:
            out.append(float(item))
        except Exception:
            return []
    return out


def main() -> int:
    args = parse_args()

    try:
        import psycopg2
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "stage": "import",
            "error": f"psycopg2 no disponible: {exc}",
            "hint": "Ejecuta scripts/preparar_entorno_ia.ps1 o instala dependencias en .venv",
        }, ensure_ascii=False, indent=2))
        return 1

    cfg = resolve_db_config()

    query = """
        SELECT id, employee_id, name, embedding, photo, samples_count
        FROM employees
    """
    conditions: list[str] = []
    params: list[Any] = []

    if args.employee_id.strip():
        conditions.append("employee_id = %s")
        params.append(args.employee_id.strip())

    if conditions:
        query += " WHERE " + " AND ".join(conditions)

    query += " ORDER BY id DESC LIMIT %s"
    params.append(max(1, args.limit))

    try:
        conn = psycopg2.connect(
            host=cfg.host,
            dbname=cfg.dbname,
            user=cfg.user,
            password=cfg.password,
            sslmode=cfg.sslmode,
        )
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "stage": "connect",
            "error": str(exc),
            "config": {
                "host": cfg.host,
                "dbname": cfg.dbname,
                "user": cfg.user,
                "sslmode": cfg.sslmode,
                "password": "<set>" if cfg.password else "<empty>",
            },
        }, ensure_ascii=False, indent=2))
        return 2

    try:
        with conn.cursor() as cur:
            cur.execute(query, params)
            rows = cur.fetchall()
    finally:
        conn.close()

    parsed_rows: list[dict[str, Any]] = []
    hash_index: dict[str, list[str]] = {}

    for row in rows:
        row_id, employee_id, name, embedding_blob, photo_blob, samples_count = row

        emb_hash = ""
        emb_dims = 0
        vector_preview: list[float] = []
        vector_error = ""

        if embedding_blob:
            emb_hash = hashlib.md5(bytes(embedding_blob)).hexdigest()
            hash_index.setdefault(emb_hash, []).append(str(employee_id))
            try:
                restored = pickle.loads(bytes(embedding_blob))
                float_vec = to_float_list(restored)
                emb_dims = len(float_vec)
                if args.show_vector and float_vec:
                    vector_preview = [round(v, 6) for v in float_vec[: max(1, args.vector_limit)]]
            except Exception as exc:
                vector_error = str(exc)

        item: dict[str, Any] = {
            "id": int(row_id),
            "employee_id": str(employee_id),
            "name": name,
            "embedding_bytes": len(embedding_blob) if embedding_blob else 0,
            "photo_bytes": len(photo_blob) if photo_blob else 0,
            "samples_count": int(samples_count or 0),
            "embedding_dims": emb_dims,
        }

        if args.show_hash:
            item["embedding_hash"] = emb_hash
        if args.show_vector:
            item["embedding_preview"] = vector_preview
        if vector_error:
            item["embedding_decode_error"] = vector_error

        parsed_rows.append(item)

    duplicate_groups = {
        emb_hash: employee_ids
        for emb_hash, employee_ids in hash_index.items()
        if len(employee_ids) > 1
    }

    if args.only_duplicates:
        dup_set = {employee_id for values in duplicate_groups.values() for employee_id in values}
        parsed_rows = [item for item in parsed_rows if item["employee_id"] in dup_set]

    output = {
        "ok": True,
        "total_rows": len(parsed_rows),
        "filters": {
            "employee_id": args.employee_id.strip() or None,
            "limit": args.limit,
            "only_duplicates": bool(args.only_duplicates),
        },
        "duplicate_embedding_groups": duplicate_groups,
        "rows": parsed_rows,
    }

    print(json.dumps(output, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
