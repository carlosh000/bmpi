#!/usr/bin/env python3
"""Valida completitud de dataset empresarial sin ejecutar reconocimiento.

Uso principal:
- contar imágenes reales por identidad y grupo (known/genuine/impostor)
- comparar contra objetivos de capture_plan.csv
- emitir reporte JSON/Markdown para seguimiento operativo
- opcionalmente actualizar columna estado en capture_plan.csv
"""

from __future__ import annotations

import argparse
import csv
import json
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


@dataclass
class PlanRow:
    grupo: str
    identidad: str
    fotos_objetivo: int
    estado: str


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verifica avance de dataset empresarial (sin cámara).")
    parser.add_argument("--dataset", required=True, help="Ruta al dataset raíz.")
    parser.add_argument("--output", default="reports/ia", help="Directorio de salida para reporte.")
    parser.add_argument(
        "--update-plan-status",
        action="store_true",
        help="Actualiza capture_plan.csv cambiando estado a 'completo' cuando cumpla objetivo.",
    )
    return parser.parse_args()


def read_capture_plan(plan_path: Path) -> list[PlanRow]:
    if not plan_path.exists():
        raise SystemExit(f"No existe capture_plan.csv en: {plan_path}")

    rows: list[PlanRow] = []
    with plan_path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"grupo", "identidad", "fotos_objetivo", "estado"}
        if not reader.fieldnames or not required.issubset(set(reader.fieldnames)):
            raise SystemExit("capture_plan.csv no tiene columnas esperadas: grupo, identidad, fotos_objetivo, estado")

        for item in reader:
            try:
                target = int(str(item["fotos_objetivo"]).strip())
            except ValueError as exc:
                raise SystemExit(f"fotos_objetivo inválido para fila {item}") from exc

            rows.append(
                PlanRow(
                    grupo=str(item["grupo"]).strip(),
                    identidad=str(item["identidad"]).strip(),
                    fotos_objetivo=target,
                    estado=str(item["estado"]).strip() or "pendiente",
                )
            )
    return rows


def count_images(identity_dir: Path) -> int:
    if not identity_dir.exists():
        return 0
    return sum(1 for path in identity_dir.rglob("*") if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS)


def evaluate_rows(dataset_root: Path, rows: list[PlanRow]) -> tuple[list[dict], dict]:
    details: list[dict] = []
    summary = {
        "rows_total": len(rows),
        "rows_complete": 0,
        "rows_pending": 0,
        "images_expected_total": 0,
        "images_found_total": 0,
        "groups": {},
    }

    for row in rows:
        identity_dir = dataset_root / row.grupo / row.identidad
        found = count_images(identity_dir)
        expected = row.fotos_objetivo
        is_complete = found >= expected
        missing = max(0, expected - found)

        summary["images_expected_total"] += expected
        summary["images_found_total"] += found
        if is_complete:
            summary["rows_complete"] += 1
        else:
            summary["rows_pending"] += 1

        group_data = summary["groups"].setdefault(
            row.grupo,
            {
                "rows_total": 0,
                "rows_complete": 0,
                "rows_pending": 0,
                "images_expected_total": 0,
                "images_found_total": 0,
            },
        )
        group_data["rows_total"] += 1
        group_data["images_expected_total"] += expected
        group_data["images_found_total"] += found
        if is_complete:
            group_data["rows_complete"] += 1
        else:
            group_data["rows_pending"] += 1

        details.append(
            {
                "grupo": row.grupo,
                "identidad": row.identidad,
                "fotos_objetivo": expected,
                "fotos_encontradas": found,
                "faltantes": missing,
                "estado_sugerido": "completo" if is_complete else "pendiente",
            }
        )

    completion_rate = 0.0
    if summary["rows_total"] > 0:
        completion_rate = summary["rows_complete"] / summary["rows_total"]
    summary["completion_rate"] = round(completion_rate, 6)
    return details, summary


def update_capture_plan(plan_path: Path, rows: list[PlanRow], details: list[dict]) -> int:
    suggested = {(d["grupo"], d["identidad"]): d["estado_sugerido"] for d in details}
    updated = 0

    output_rows = []
    for row in rows:
        next_status = suggested.get((row.grupo, row.identidad), row.estado)
        if row.estado != next_status:
            updated += 1
        output_rows.append(
            {
                "grupo": row.grupo,
                "identidad": row.identidad,
                "fotos_objetivo": row.fotos_objetivo,
                "estado": next_status,
            }
        )

    with plan_path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=["grupo", "identidad", "fotos_objetivo", "estado"])
        writer.writeheader()
        writer.writerows(output_rows)
    return updated


def write_reports(output_dir: Path, payload: dict) -> tuple[Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = output_dir / f"verificacion_dataset_{timestamp}.json"
    md_path = output_dir / f"verificacion_dataset_{timestamp}.md"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    summary = payload["summary"]
    lines = [
        "# Verificación de dataset empresarial",
        "",
        f"- Fecha: {payload['generated_at']}",
        f"- Dataset: {payload['dataset']}",
        f"- Filas completas: {summary['rows_complete']} / {summary['rows_total']}",
        f"- Avance global: {summary['completion_rate'] * 100:.2f}%",
        f"- Imágenes esperadas: {summary['images_expected_total']}",
        f"- Imágenes encontradas: {summary['images_found_total']}",
        "",
        "## Resumen por grupo",
        "",
        "| grupo | completas | total | avance | esperadas | encontradas |",
        "|---|---:|---:|---:|---:|---:|",
    ]

    for group, values in sorted(summary["groups"].items()):
        rate = 0.0
        if values["rows_total"] > 0:
            rate = values["rows_complete"] / values["rows_total"]
        lines.append(
            f"| {group} | {values['rows_complete']} | {values['rows_total']} | {rate * 100:.2f}% | {values['images_expected_total']} | {values['images_found_total']} |"
        )

    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def main() -> int:
    args = parse_args()
    dataset_root = Path(args.dataset).resolve()
    output_dir = Path(args.output).resolve()
    plan_path = dataset_root / "capture_plan.csv"

    rows = read_capture_plan(plan_path)
    details, summary = evaluate_rows(dataset_root, rows)

    updated_rows = 0
    if args.update_plan_status:
        updated_rows = update_capture_plan(plan_path, rows, details)

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "dataset": str(dataset_root),
        "summary": summary,
        "updated_rows": updated_rows,
        "details": details,
    }

    json_path, md_path = write_reports(output_dir, payload)
    print(f"Filas completas: {summary['rows_complete']} / {summary['rows_total']}")
    print(f"Avance global: {summary['completion_rate'] * 100:.2f}%")
    if args.update_plan_status:
        print(f"Filas actualizadas en capture_plan.csv: {updated_rows}")
    print(f"Reporte JSON: {json_path}")
    print(f"Reporte MD: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
