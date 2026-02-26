#!/usr/bin/env python3
"""Verificación rápida de calidad de fotos para reconocimiento facial BMPI.

Evalúa imágenes de un dataset y marca problemas típicos que aumentan falsos rechazos:
- no se detecta rostro
- múltiples rostros
- desenfoque
- iluminación extrema
- rostro demasiado pequeño
- rostro fuera de zona central
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable

import cv2
import face_recognition

VALID_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".webp"}

ISSUE_PRIORITY = {
    "sin_rostro_detectado": 1,
    "multiples_rostros": 2,
    "desenfoque_alto": 3,
    "rostro_pequeno": 4,
    "rostro_area_baja": 5,
    "rostro_fuera_centro": 6,
    "iluminacion_baja": 7,
    "iluminacion_alta": 8,
    "no_se_pudo_abrir_imagen": 9,
}


@dataclass
class QualityThresholds:
    blur_min: float
    brightness_min: float
    brightness_max: float
    face_height_ratio_min: float
    face_area_ratio_min: float
    center_distance_ratio_max: float


@dataclass
class ImageResult:
    path: str
    group: str
    identity: str
    ok: bool
    issues: list[str]
    metrics: dict[str, float | int]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Verifica calidad de fotos para reconocimiento facial")
    parser.add_argument("--dataset", required=True, help="Ruta del dataset (known/genuine/impostor)")
    parser.add_argument("--output", default="reports/ia", help="Directorio de salida para reportes")
    parser.add_argument("--model", choices=["hog", "cnn"], default="hog", help="Modelo de detección facial")
    parser.add_argument("--upsample", type=int, default=1, help="number_of_times_to_upsample")

    parser.add_argument("--blur-min", type=float, default=80.0)
    parser.add_argument("--brightness-min", type=float, default=60.0)
    parser.add_argument("--brightness-max", type=float, default=200.0)
    parser.add_argument("--face-height-ratio-min", type=float, default=0.20)
    parser.add_argument("--face-area-ratio-min", type=float, default=0.06)
    parser.add_argument("--center-distance-ratio-max", type=float, default=0.35)
    parser.add_argument("--max-files", type=int, default=0, help="Límite opcional de imágenes a procesar (0 = sin límite)")

    return parser.parse_args()


def list_images(dataset_dir: Path) -> list[Path]:
    images: list[Path] = []
    for root_name in ("known", "genuine", "impostor"):
        root = dataset_dir / root_name
        if not root.exists():
            continue
        for path in root.rglob("*"):
            if path.is_file() and path.suffix.lower() in VALID_EXTS:
                images.append(path)
    return sorted(images)


def infer_group_and_identity(dataset_dir: Path, image_path: Path) -> tuple[str, str]:
    rel = image_path.relative_to(dataset_dir)
    parts = rel.parts
    if len(parts) < 2:
        return "unknown", "unknown"
    return parts[0], parts[1]


def compute_blur_score(gray_img) -> float:
    return float(cv2.Laplacian(gray_img, cv2.CV_64F).var())


def compute_brightness(gray_img) -> float:
    return float(gray_img.mean())


def evaluate_image(
    dataset_dir: Path,
    image_path: Path,
    thresholds: QualityThresholds,
    model: str,
    upsample: int,
) -> ImageResult:
    group, identity = infer_group_and_identity(dataset_dir, image_path)

    bgr = cv2.imread(str(image_path))
    if bgr is None:
        return ImageResult(
            path=str(image_path),
            group=group,
            identity=identity,
            ok=False,
            issues=["no_se_pudo_abrir_imagen"],
            metrics={},
        )

    gray = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)

    height, width = gray.shape
    frame_area = float(max(1, width * height))

    blur_score = compute_blur_score(gray)
    brightness = compute_brightness(gray)

    face_locations = face_recognition.face_locations(
        rgb,
        number_of_times_to_upsample=max(0, upsample),
        model=model,
    )

    issues: list[str] = []
    metrics: dict[str, float | int] = {
        "blur_score": round(blur_score, 3),
        "brightness_mean": round(brightness, 3),
        "faces_detected": len(face_locations),
        "image_width": int(width),
        "image_height": int(height),
    }

    if len(face_locations) == 0:
        issues.append("sin_rostro_detectado")
        return ImageResult(str(image_path), group, identity, False, issues, metrics)

    if len(face_locations) > 1:
        issues.append("multiples_rostros")

    top, right, bottom, left = max(
        face_locations,
        key=lambda loc: max(0, loc[2] - loc[0]) * max(0, loc[1] - loc[3]),
    )

    face_w = max(1, right - left)
    face_h = max(1, bottom - top)
    face_area = float(face_w * face_h)
    face_area_ratio = face_area / frame_area
    face_height_ratio = face_h / float(max(1, height))

    face_center_x = (left + right) / 2.0
    face_center_y = (top + bottom) / 2.0
    image_center_x = width / 2.0
    image_center_y = height / 2.0

    dx = (face_center_x - image_center_x) / float(max(1, width))
    dy = (face_center_y - image_center_y) / float(max(1, height))
    center_distance_ratio = (dx * dx + dy * dy) ** 0.5

    metrics.update(
        {
            "face_width_px": int(face_w),
            "face_height_px": int(face_h),
            "face_area_ratio": round(face_area_ratio, 4),
            "face_height_ratio": round(face_height_ratio, 4),
            "center_distance_ratio": round(center_distance_ratio, 4),
        }
    )

    if blur_score < thresholds.blur_min:
        issues.append("desenfoque_alto")

    if brightness < thresholds.brightness_min:
        issues.append("iluminacion_baja")
    elif brightness > thresholds.brightness_max:
        issues.append("iluminacion_alta")

    if face_height_ratio < thresholds.face_height_ratio_min:
        issues.append("rostro_pequeno")

    if face_area_ratio < thresholds.face_area_ratio_min:
        issues.append("rostro_area_baja")

    if center_distance_ratio > thresholds.center_distance_ratio_max:
        issues.append("rostro_fuera_centro")

    return ImageResult(
        path=str(image_path),
        group=group,
        identity=identity,
        ok=len(issues) == 0,
        issues=issues,
        metrics=metrics,
    )


def summarize(results: Iterable[ImageResult]) -> dict:
    rows = list(results)
    total = len(rows)
    ok_count = sum(1 for item in rows if item.ok)
    fail_count = total - ok_count

    issue_counter: Counter[str] = Counter()
    group_counter: dict[str, Counter[str]] = {}

    for item in rows:
        group_counter.setdefault(item.group, Counter())
        if item.ok:
            group_counter[item.group]["ok"] += 1
        else:
            group_counter[item.group]["fail"] += 1
        for issue in item.issues:
            issue_counter[issue] += 1

    worst_images = [
        {
            "path": item.path,
            "group": item.group,
            "identity": item.identity,
            "issues": item.issues,
            "metrics": item.metrics,
        }
        for item in rows
        if not item.ok
    ][:50]

    return {
        "total_images": total,
        "ok_images": ok_count,
        "fail_images": fail_count,
        "ok_rate": round((ok_count / total) if total else 0.0, 4),
        "issues": dict(issue_counter.most_common()),
        "by_group": {
            group: {
                "ok": counts.get("ok", 0),
                "fail": counts.get("fail", 0),
                "total": counts.get("ok", 0) + counts.get("fail", 0),
            }
            for group, counts in group_counter.items()
        },
        "worst_images_preview": worst_images,
    }


def build_retake_rows(dataset_dir: Path, results: Iterable[ImageResult]) -> list[dict[str, str | int]]:
    rows: list[dict[str, str | int]] = []

    for item in results:
        if item.ok:
            continue

        ordered_issues = sorted(item.issues, key=lambda issue: ISSUE_PRIORITY.get(issue, 99))
        top_issue = ordered_issues[0] if ordered_issues else "desconocido"
        priority = ISSUE_PRIORITY.get(top_issue, 99)

        try:
            rel_path = str(Path(item.path).resolve().relative_to(dataset_dir))
        except Exception:
            rel_path = item.path

        rows.append(
            {
                "priority": priority,
                "group": item.group,
                "identity": item.identity,
                "path": rel_path,
                "top_issue": top_issue,
                "issues": ",".join(ordered_issues),
            }
        )

    rows.sort(key=lambda row: (int(row["priority"]), str(row["group"]), str(row["identity"]), str(row["path"])))
    return rows


def summarize_retake_by_identity(retake_rows: Iterable[dict[str, str | int]]) -> list[dict[str, str | int]]:
    counter: dict[tuple[str, str], int] = {}

    for row in retake_rows:
        key = (str(row["group"]), str(row["identity"]))
        counter[key] = counter.get(key, 0) + 1

    summary_rows = [
        {
            "group": group,
            "identity": identity,
            "photos_to_retake": count,
        }
        for (group, identity), count in counter.items()
    ]
    summary_rows.sort(key=lambda item: (-int(item["photos_to_retake"]), str(item["group"]), str(item["identity"])))
    return summary_rows


def write_retake_csv(csv_path: Path, retake_rows: Iterable[dict[str, str | int]]) -> None:
    rows = list(retake_rows)
    with csv_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=["priority", "group", "identity", "path", "top_issue", "issues"],
        )
        writer.writeheader()
        writer.writerows(rows)


def build_markdown(report: dict, thresholds: QualityThresholds) -> str:
    lines = [
        "# Verificación de calidad de fotos",
        "",
        f"- Fecha: {report['created_at']}",
        f"- Dataset: {report['dataset']}",
        f"- Imágenes evaluadas: {report['summary']['total_images']}",
        f"- OK: {report['summary']['ok_images']}",
        f"- Con problemas: {report['summary']['fail_images']}",
        f"- OK rate: {report['summary']['ok_rate']:.2%}",
        "",
        "## Umbrales usados",
        "",
        f"- blur_min: `{thresholds.blur_min}`",
        f"- brightness_min: `{thresholds.brightness_min}`",
        f"- brightness_max: `{thresholds.brightness_max}`",
        f"- face_height_ratio_min: `{thresholds.face_height_ratio_min}`",
        f"- face_area_ratio_min: `{thresholds.face_area_ratio_min}`",
        f"- center_distance_ratio_max: `{thresholds.center_distance_ratio_max}`",
        "",
        "## Problemas más frecuentes",
        "",
    ]

    issues = report["summary"]["issues"]
    if issues:
        for key, value in issues.items():
            lines.append(f"- {key}: `{value}`")
    else:
        lines.append("- Sin incidencias detectadas")

    lines.extend(
        [
            "",
            "## Sugerencias",
            "",
            "- Si predomina `desenfoque_alto`: estabilizar cámara y repetir captura.",
            "- Si predomina `iluminacion_baja`/`iluminacion_alta`: ajustar luz uniforme frontal.",
            "- Si predomina `rostro_pequeno`/`rostro_area_baja`: acercar cámara o recortar mejor.",
            "- Si predomina `rostro_fuera_centro`: pedir encuadre centrado del rostro.",
            "- Si aparece `multiples_rostros`: recapturar imagen individual por empleado.",
        ]
    )

    retake_summary = report.get("retake_summary_by_identity", [])
    if retake_summary:
        lines.extend(
            [
                "",
                "## Prioridad de recaptura por identidad",
                "",
                "| group | identity | photos_to_retake |",
                "|---|---|---:|",
            ]
        )
        for item in retake_summary[:20]:
            lines.append(
                f"| {item['group']} | {item['identity']} | {item['photos_to_retake']} |"
            )

        if report.get("retake_csv"):
            lines.extend(
                [
                    "",
                    f"- CSV completo de recaptura: `{report['retake_csv']}`",
                ]
            )

    return "\n".join(lines) + "\n"


def main() -> int:
    args = parse_args()

    dataset_dir = Path(args.dataset).resolve()
    if not dataset_dir.exists() or not dataset_dir.is_dir():
        raise SystemExit(f"Dataset no encontrado: {dataset_dir}")

    images = list_images(dataset_dir)
    if args.max_files > 0:
        images = images[: args.max_files]

    if not images:
        raise SystemExit("No se encontraron imágenes para evaluar (known/genuine/impostor)")

    thresholds = QualityThresholds(
        blur_min=args.blur_min,
        brightness_min=args.brightness_min,
        brightness_max=args.brightness_max,
        face_height_ratio_min=args.face_height_ratio_min,
        face_area_ratio_min=args.face_area_ratio_min,
        center_distance_ratio_max=args.center_distance_ratio_max,
    )

    rows: list[ImageResult] = []
    for image_path in images:
        rows.append(
            evaluate_image(
                dataset_dir=dataset_dir,
                image_path=image_path,
                thresholds=thresholds,
                model=args.model,
                upsample=args.upsample,
            )
        )

    created_at = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    summary = summarize(rows)
    retake_rows = build_retake_rows(dataset_dir, rows)
    retake_summary = summarize_retake_by_identity(retake_rows)
    report = {
        "created_at": created_at,
        "dataset": str(dataset_dir),
        "model": args.model,
        "upsample": args.upsample,
        "thresholds": {
            "blur_min": thresholds.blur_min,
            "brightness_min": thresholds.brightness_min,
            "brightness_max": thresholds.brightness_max,
            "face_height_ratio_min": thresholds.face_height_ratio_min,
            "face_area_ratio_min": thresholds.face_area_ratio_min,
            "center_distance_ratio_max": thresholds.center_distance_ratio_max,
        },
        "summary": summary,
        "retake_summary_by_identity": retake_summary,
        "results": [
            {
                "path": item.path,
                "group": item.group,
                "identity": item.identity,
                "ok": item.ok,
                "issues": item.issues,
                "metrics": item.metrics,
            }
            for item in rows
        ],
    }

    out_dir = Path(args.output)
    out_dir.mkdir(parents=True, exist_ok=True)

    json_path = out_dir / f"verificacion_calidad_fotos_{timestamp}.json"
    md_path = out_dir / f"verificacion_calidad_fotos_{timestamp}.md"
    retake_csv_path = out_dir / f"recaptura_fotos_{timestamp}.csv"

    write_retake_csv(retake_csv_path, retake_rows)
    report["retake_csv"] = str(retake_csv_path)

    json_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    md_path.write_text(build_markdown(report, thresholds), encoding="utf-8")

    print(json.dumps({
        "ok": True,
        "dataset": str(dataset_dir),
        "total_images": summary["total_images"],
        "ok_images": summary["ok_images"],
        "fail_images": summary["fail_images"],
        "ok_rate": summary["ok_rate"],
        "top_issues": summary["issues"],
        "retake_rows": len(retake_rows),
        "json_report": str(json_path),
        "md_report": str(md_path),
        "retake_csv": str(retake_csv_path),
    }, ensure_ascii=False, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
