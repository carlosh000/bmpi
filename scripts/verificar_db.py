#!/usr/bin/env python3
"""Verificación rápida de PostgreSQL para BMPI."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime


def env(name: str, default: str) -> str:
    value = (os.getenv(name) or "").strip()
    return value if value else default


def is_production() -> bool:
    return env("BMPI_ENV", "").lower() == "production"


def main() -> int:
    try:
        import psycopg2
    except Exception as exc:
        print(json.dumps({
            "ok": False,
            "stage": "import",
            "error": f"psycopg2 no disponible: {exc}",
            "hint": "Instala dependencias IA o ejecuta scripts/preparar_entorno_ia.ps1",
        }, ensure_ascii=False, indent=2))
        return 1

    cfg = {
        "host": env("DB_HOST", "localhost"),
        "dbname": env("DB_NAME", "bmpi"),
        "user": env("DB_USER", "postgres"),
        "password": (os.getenv("DB_PASSWORD") or "").strip(),
        "sslmode": env("DB_SSLMODE", "require" if is_production() else "disable"),
    }

    if is_production() and not cfg["password"]:
        print(json.dumps({
            "ok": False,
            "stage": "config",
            "error": "DB_PASSWORD es obligatorio en production",
            "config": {
                "host": cfg["host"],
                "dbname": cfg["dbname"],
                "user": cfg["user"],
                "sslmode": cfg["sslmode"],
                "password": "<empty>",
            },
        }, ensure_ascii=False, indent=2))
        return 1

    masked_cfg = {
        "host": cfg["host"],
        "dbname": cfg["dbname"],
        "user": cfg["user"],
        "sslmode": cfg["sslmode"],
        "password": "<set>" if cfg["password"] else "<empty>",
    }

    report = {
        "ok": True,
        "checked_at": datetime.now().isoformat(timespec="seconds"),
        "config": masked_cfg,
        "checks": {},
        "warnings": [],
    }

    try:
        conn = psycopg2.connect(**cfg)
    except Exception as exc:
        report["ok"] = False
        report["checks"]["connection"] = {"ok": False, "error": str(exc)}
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 1

    try:
        conn.autocommit = True
        with conn.cursor() as cur:
            cur.execute("SELECT 1")
            report["checks"]["connection"] = {"ok": cur.fetchone()[0] == 1}

            cur.execute(
                """
                SELECT table_name
                FROM information_schema.tables
                WHERE table_schema='public' AND table_name IN ('employees','attendance')
                ORDER BY table_name
                """
            )
            tables = [row[0] for row in cur.fetchall()]
            report["checks"]["tables"] = {
                "ok": set(tables) == {"employees", "attendance"},
                "found": tables,
            }

            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='employees'
                ORDER BY ordinal_position
                """
            )
            emp_cols = [row[0] for row in cur.fetchall()]
            required_emp_cols = {"id", "name", "employee_id", "embedding", "photo", "samples_count"}
            report["checks"]["employees_columns"] = {
                "ok": required_emp_cols.issubset(set(emp_cols)),
                "found": emp_cols,
            }

            cur.execute(
                """
                SELECT column_name
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name='attendance'
                ORDER BY ordinal_position
                """
            )
            att_cols = [row[0] for row in cur.fetchall()]
            required_att_cols = {"id", "employee_id", "timestamp"}
            report["checks"]["attendance_columns"] = {
                "ok": required_att_cols.issubset(set(att_cols)),
                "found": att_cols,
            }

            cur.execute("SELECT COUNT(*) FROM employees")
            employees_count = int(cur.fetchone()[0])
            cur.execute("SELECT COUNT(*) FROM attendance")
            attendance_count = int(cur.fetchone()[0])
            report["checks"]["counts"] = {
                "ok": True,
                "employees": employees_count,
                "attendance": attendance_count,
            }

            cur.execute(
                """
                SELECT employee_id, timestamp
                FROM attendance
                ORDER BY timestamp DESC
                LIMIT 5
                """
            )
            last_attendance = [
                {"employee_id": row[0], "timestamp": row[1].isoformat(sep=' ', timespec='seconds')}
                for row in cur.fetchall()
            ]
            report["checks"]["last_attendance"] = {
                "ok": True,
                "items": last_attendance,
            }

            if employees_count == 0:
                report["warnings"].append("No hay empleados registrados todavía.")
            if attendance_count == 0:
                report["warnings"].append("No hay asistencias registradas todavía.")

        report["ok"] = all(
            check.get("ok", False)
            for key, check in report["checks"].items()
            if key in {"connection", "tables", "employees_columns", "attendance_columns", "counts", "last_attendance"}
        )

        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["ok"] else 2
    finally:
        conn.close()


if __name__ == "__main__":
    sys.exit(main())
