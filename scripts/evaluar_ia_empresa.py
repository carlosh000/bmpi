#!/usr/bin/env python3
"""Evaluación de preparación empresarial para IA facial (offline).

Este script calcula métricas clave con un dataset local:
- FRR (False Rejection Rate) para casos genuinos
- FAR (False Acceptance Rate) para casos impostores
- Tasa de detección de rostro
- Latencia promedio y p95 por imagen

Además genera:
- reporte JSON (métricas por umbral)
- reporte Markdown con semáforo (VERDE/AMARILLO/ROJO)

Estructura de dataset recomendada:

dataset/
  known/
    <employee_id>/img1.jpg
    <employee_id>/img2.jpg
  genuine/
    <employee_id>/test1.jpg
    <employee_id>/test2.jpg
  impostor/
    persona_x/1.jpg
    persona_y/2.jpg
"""

from __future__ import annotations

import argparse
import json
import os
import statistics
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Iterable, Sequence

import face_recognition
import numpy as np


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


@dataclass
class EvaluationConfig:
    dataset_dir: Path
    output_dir: Path
    model: str
    thresholds: list[float]
    green_far_max: float
    green_frr_max: float
    green_p95_ms_max: float
    green_detection_min: float
    yellow_far_max: float
    yellow_frr_max: float
    yellow_p95_ms_max: float
    yellow_detection_min: float
    allow_insufficient_dataset: bool
    max_image_dim: int


def parse_args() -> EvaluationConfig:
    parser = argparse.ArgumentParser(description="Evaluación empresarial IA facial (offline).")
    parser.add_argument("--dataset", required=True, help="Ruta a dataset raíz (known/genuine/impostor).")
    parser.add_argument("--output", default="reports/ia", help="Directorio de salida de reportes.")
    parser.add_argument("--model", default=os.getenv("BMPI_FACE_MODEL", "hog"), choices=["hog", "cnn"], help="Modelo de detección de rostro.")
    parser.add_argument(
        "--thresholds",
        default="0.35,0.40,0.45,0.50,0.55,0.60",
        help="Lista de umbrales separados por coma.",
    )

    parser.add_argument("--green-far-max", type=float, default=0.005)
    parser.add_argument("--green-frr-max", type=float, default=0.030)
    parser.add_argument("--green-p95-ms-max", type=float, default=1200.0)
    parser.add_argument("--green-detection-min", type=float, default=0.980)

    parser.add_argument("--yellow-far-max", type=float, default=0.020)
    parser.add_argument("--yellow-frr-max", type=float, default=0.080)
    parser.add_argument("--yellow-p95-ms-max", type=float, default=2200.0)
    parser.add_argument("--yellow-detection-min", type=float, default=0.920)
    parser.add_argument(
        "--allow-insufficient-dataset",
        action="store_true",
        help="Permite ejecutar aun con dataset no representativo (solo para pruebas técnicas).",
    )
    parser.add_argument(
        "--max-image-dim",
        type=int,
        default=1280,
        help="Redimensiona imágenes grandes para acelerar evaluación (0 desactiva).",
    )

    args = parser.parse_args()

    thresholds = []
    for item in args.thresholds.split(","):
        value = item.strip()
        if not value:
            continue
        thresholds.append(float(value))
    thresholds = sorted(set(thresholds))
    if not thresholds:
        raise SystemExit("Debes proporcionar al menos un umbral válido en --thresholds")

    return EvaluationConfig(
        dataset_dir=Path(args.dataset).resolve(),
        output_dir=Path(args.output).resolve(),
        model=args.model,
        thresholds=thresholds,
        green_far_max=args.green_far_max,
        green_frr_max=args.green_frr_max,
        green_p95_ms_max=args.green_p95_ms_max,
        green_detection_min=args.green_detection_min,
        yellow_far_max=args.yellow_far_max,
        yellow_frr_max=args.yellow_frr_max,
        yellow_p95_ms_max=args.yellow_p95_ms_max,
        yellow_detection_min=args.yellow_detection_min,
        allow_insufficient_dataset=args.allow_insufficient_dataset,
        max_image_dim=max(0, int(args.max_image_dim)),
    )


def list_images(root: Path) -> list[Path]:
    if not root.exists():
        return []
    images = [p for p in root.rglob("*") if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS]
    return sorted(images)


def employee_from_path(path: Path, group_root: Path) -> str:
    rel = path.relative_to(group_root)
    if len(rel.parts) < 2:
        return ""
    return rel.parts[0].strip()


def _downscale_image(image: np.ndarray, max_dim: int) -> np.ndarray:
    if max_dim <= 0:
        return image
    height, width = image.shape[:2]
    current_max = max(height, width)
    if current_max <= max_dim:
        return image

    scale = max_dim / float(current_max)
    new_width = max(1, int(round(width * scale)))
    new_height = max(1, int(round(height * scale)))

    y_idx = np.linspace(0, height - 1, new_height).astype(np.int32)
    x_idx = np.linspace(0, width - 1, new_width).astype(np.int32)
    return image[np.ix_(y_idx, x_idx)]


def extract_first_encoding(image_path: Path, model: str, max_dim: int) -> tuple[np.ndarray | None, bool, float]:
    started = time.perf_counter()
    image = face_recognition.load_image_file(str(image_path))
    image = _downscale_image(image, max_dim)
    locations = face_recognition.face_locations(image, model=model)
    if not locations:
        elapsed_ms = (time.perf_counter() - started) * 1000.0
        return None, False, elapsed_ms

    encodings = face_recognition.face_encodings(image, known_face_locations=locations)
    elapsed_ms = (time.perf_counter() - started) * 1000.0
    if not encodings:
        return None, False, elapsed_ms
    return np.array(encodings[0], dtype=np.float64), True, elapsed_ms


def percentile(values: Sequence[float], q: float) -> float:
    if not values:
        return 0.0
    idx = max(0, min(len(values) - 1, int(round((q / 100.0) * (len(values) - 1)))))
    sorted_values = sorted(values)
    return float(sorted_values[idx])


def summarize_latency(values: Sequence[float]) -> dict:
    if not values:
        return {"count": 0, "avg_ms": 0.0, "p95_ms": 0.0, "max_ms": 0.0}
    return {
        "count": len(values),
        "avg_ms": round(float(statistics.fmean(values)), 2),
        "p95_ms": round(percentile(values, 95), 2),
        "max_ms": round(float(max(values)), 2),
    }


def build_known_embeddings(known_dir: Path, model: str, max_dim: int) -> tuple[list[str], np.ndarray, dict]:
    employee_vectors: dict[str, list[np.ndarray]] = {}
    parse_stats = {"images_total": 0, "images_with_face": 0, "images_without_face": 0}

    for image_path in list_images(known_dir):
        employee_id = employee_from_path(image_path, known_dir)
        if not employee_id:
            continue
        parse_stats["images_total"] += 1
        encoding, has_face, _ = extract_first_encoding(image_path, model, max_dim)
        if not has_face or encoding is None:
            parse_stats["images_without_face"] += 1
            continue

        parse_stats["images_with_face"] += 1
        employee_vectors.setdefault(employee_id, []).append(encoding)

    known_ids: list[str] = []
    known_matrix: list[np.ndarray] = []
    for employee_id, vectors in sorted(employee_vectors.items(), key=lambda item: item[0]):
        averaged = np.mean(np.vstack(vectors), axis=0)
        known_ids.append(employee_id)
        known_matrix.append(averaged)

    if known_matrix:
        return known_ids, np.vstack(known_matrix), parse_stats
    return known_ids, np.array([]), parse_stats


def classify_embedding(embedding: np.ndarray, known_ids: list[str], known_matrix: np.ndarray, threshold: float) -> tuple[str | None, float | None]:
    if len(known_matrix) == 0:
        return None, None

    distances = face_recognition.face_distance(known_matrix, embedding)
    best_idx = int(np.argmin(distances))
    best_distance = float(distances[best_idx])
    if best_distance < threshold:
        return known_ids[best_idx], best_distance
    return None, best_distance


def evaluate_group(
    image_paths: Iterable[Path],
    model: str,
    known_ids: list[str],
    known_matrix: np.ndarray,
    threshold: float,
    expect_known: bool,
    group_root: Path,
    max_dim: int,
) -> dict:
    latency_values: list[float] = []
    total = 0
    detected = 0
    accepted = 0
    correct = 0
    rejected = 0
    wrong_identity = 0

    for image_path in image_paths:
        total += 1
        expected_id = employee_from_path(image_path, group_root) if expect_known else None

        encoding, has_face, elapsed_ms = extract_first_encoding(image_path, model, max_dim)
        latency_values.append(elapsed_ms)
        if not has_face or encoding is None:
            continue

        detected += 1
        predicted_id, _ = classify_embedding(encoding, known_ids, known_matrix, threshold)
        if predicted_id is None:
            rejected += 1
            continue

        accepted += 1
        if expect_known and expected_id and predicted_id == expected_id:
            correct += 1
        else:
            wrong_identity += 1

    return {
        "total": total,
        "detected": detected,
        "accepted": accepted,
        "correct": correct,
        "rejected": rejected,
        "wrong_identity": wrong_identity,
        "detection_rate": round((detected / total), 6) if total > 0 else 0.0,
        "latency": summarize_latency(latency_values),
    }


def compute_result_for_threshold(
    threshold: float,
    config: EvaluationConfig,
    known_ids: list[str],
    known_matrix: np.ndarray,
    genuine_images: list[Path],
    impostor_images: list[Path],
    genuine_dir: Path,
    impostor_dir: Path,
) -> dict:
    genuine = evaluate_group(
        genuine_images,
        config.model,
        known_ids,
        known_matrix,
        threshold,
        expect_known=True,
        group_root=genuine_dir,
        max_dim=config.max_image_dim,
    )
    impostor = evaluate_group(
        impostor_images,
        config.model,
        known_ids,
        known_matrix,
        threshold,
        expect_known=False,
        group_root=impostor_dir,
        max_dim=config.max_image_dim,
    )

    genuine_total = genuine["total"]
    impostor_total = impostor["total"]

    false_rejects = genuine_total - genuine["correct"]
    false_accepts = impostor["accepted"]

    frr = (false_rejects / genuine_total) if genuine_total > 0 else 1.0
    far = (false_accepts / impostor_total) if impostor_total > 0 else 1.0

    all_latency = []
    all_latency.extend([genuine["latency"]["avg_ms"]] if genuine["latency"]["count"] > 0 else [])
    all_latency.extend([impostor["latency"]["avg_ms"]] if impostor["latency"]["count"] > 0 else [])
    avg_latency = float(statistics.fmean(all_latency)) if all_latency else 0.0
    p95_latency = max(genuine["latency"]["p95_ms"], impostor["latency"]["p95_ms"])

    combined_detected = genuine["detected"] + impostor["detected"]
    combined_total = genuine_total + impostor_total
    detection_rate = (combined_detected / combined_total) if combined_total > 0 else 0.0

    return {
        "threshold": threshold,
        "frr": round(frr, 6),
        "far": round(far, 6),
        "detection_rate": round(detection_rate, 6),
        "latency_avg_ms": round(avg_latency, 2),
        "latency_p95_ms": round(float(p95_latency), 2),
        "genuine": genuine,
        "impostor": impostor,
    }


def traffic_light(result: dict, config: EvaluationConfig) -> tuple[str, str]:
    far = result["far"]
    frr = result["frr"]
    p95 = result["latency_p95_ms"]
    detection = result["detection_rate"]

    if (
        far <= config.green_far_max
        and frr <= config.green_frr_max
        and p95 <= config.green_p95_ms_max
        and detection >= config.green_detection_min
    ):
        return "VERDE", "Listo para despliegue controlado (cumple objetivos estrictos)."

    if (
        far <= config.yellow_far_max
        and frr <= config.yellow_frr_max
        and p95 <= config.yellow_p95_ms_max
        and detection >= config.yellow_detection_min
    ):
        return "AMARILLO", "Apto para piloto con mitigaciones y recalibración."

    return "ROJO", "No apto para salida empresarial; requiere mejoras antes de liberar."


def choose_recommended(results: Sequence[dict]) -> dict:
    # Peso mayor a FAR para proteger seguridad.
    def score(item: dict) -> float:
        return (item["far"] * 3.0) + (item["frr"] * 1.5) + (item["latency_p95_ms"] / 10000.0) + ((1.0 - item["detection_rate"]) * 2.0)

    return min(results, key=score)


def write_reports(config: EvaluationConfig, payload: dict) -> tuple[Path, Path]:
    config.output_dir.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    json_path = config.output_dir / f"evaluacion_ia_{ts}.json"
    md_path = config.output_dir / f"evaluacion_ia_{ts}.md"

    json_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    rec = payload["recommended"]
    light = payload["traffic_light"]
    notes = payload["traffic_note"]
    lines = [
        "# Evaluación IA empresarial",
        "",
        f"- Fecha: {payload['generated_at']}",
        f"- Dataset: {payload['dataset']}",
        f"- Modelo de detección: {payload['model']}",
        f"- Semáforo: **{light}**",
        f"- Nota: {notes}",
        "",
        "## Umbral recomendado",
        "",
        f"- threshold: `{rec['threshold']}`",
        f"- FAR: `{rec['far']}`",
        f"- FRR: `{rec['frr']}`",
        f"- detection_rate: `{rec['detection_rate']}`",
        f"- latency_p95_ms: `{rec['latency_p95_ms']}`",
        "",
        "## Resultados por umbral",
        "",
        "| threshold | FAR | FRR | detection_rate | p95_ms |",
        "|---:|---:|---:|---:|---:|",
    ]
    for row in payload["results"]:
        lines.append(
            f"| {row['threshold']:.2f} | {row['far']:.4f} | {row['frr']:.4f} | {row['detection_rate']:.4f} | {row['latency_p95_ms']:.2f} |"
        )

    md_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return json_path, md_path


def distinct_identities(root: Path) -> set[str]:
    identities = set()
    for image_path in list_images(root):
        employee_id = employee_from_path(image_path, root)
        if employee_id:
            identities.add(employee_id)
    return identities


def validate_dataset_representativeness(
    known_ids: list[str],
    genuine_dir: Path,
    impostor_dir: Path,
    allow_insufficient_dataset: bool,
) -> None:
    known_set = set(known_ids)
    genuine_set = distinct_identities(genuine_dir)
    impostor_set = distinct_identities(impostor_dir)

    issues = []
    if len(known_set) < 2:
        issues.append("known/ debe incluir al menos 2 identidades distintas")
    if len(genuine_set.intersection(known_set)) < 1:
        issues.append("genuine/ debe contener pruebas de identidades incluidas en known/")
    if len(impostor_set) < 2:
        issues.append("impostor/ debe incluir al menos 2 identidades distintas")
    overlap = impostor_set.intersection(known_set)
    if overlap:
        issues.append(f"impostor/ no debe reutilizar identidades de known/ (solapadas: {sorted(overlap)})")

    if issues and not allow_insufficient_dataset:
        joined = "\n- " + "\n- ".join(issues)
        raise SystemExit(
            "Dataset no representativo para decisión empresarial. Corrige:\n"
            f"{joined}\n"
            "Si deseas ejecutar solo prueba técnica, usa --allow-insufficient-dataset"
        )


def main() -> int:
    config = parse_args()

    known_dir = config.dataset_dir / "known"
    genuine_dir = config.dataset_dir / "genuine"
    impostor_dir = config.dataset_dir / "impostor"

    if not known_dir.exists() or not genuine_dir.exists() or not impostor_dir.exists():
        raise SystemExit("Dataset inválido: se requieren carpetas known/, genuine/, impostor/")

    known_ids, known_matrix, known_stats = build_known_embeddings(known_dir, config.model, config.max_image_dim)
    if len(known_ids) == 0:
        raise SystemExit("No se pudieron construir embeddings conocidos (revisa known/ y calidad de fotos)")

    validate_dataset_representativeness(
        known_ids=known_ids,
        genuine_dir=genuine_dir,
        impostor_dir=impostor_dir,
        allow_insufficient_dataset=config.allow_insufficient_dataset,
    )

    genuine_images = list_images(genuine_dir)
    impostor_images = list_images(impostor_dir)
    if not genuine_images or not impostor_images:
        raise SystemExit("Dataset insuficiente: genuine/ e impostor/ deben contener imágenes")

    results = []
    for threshold in config.thresholds:
        result = compute_result_for_threshold(
            threshold,
            config,
            known_ids,
            known_matrix,
            genuine_images,
            impostor_images,
            genuine_dir,
            impostor_dir,
        )
        results.append(result)

    recommended = choose_recommended(results)
    light, note = traffic_light(recommended, config)

    payload = {
        "generated_at": datetime.now().isoformat(timespec="seconds"),
        "dataset": str(config.dataset_dir),
        "model": config.model,
        "known": {
            "employees": len(known_ids),
            "parse": known_stats,
        },
        "counts": {
            "genuine_images": len(genuine_images),
            "impostor_images": len(impostor_images),
        },
        "results": results,
        "recommended": recommended,
        "traffic_light": light,
        "traffic_note": note,
        "policy": {
            "green": {
                "far_max": config.green_far_max,
                "frr_max": config.green_frr_max,
                "p95_ms_max": config.green_p95_ms_max,
                "detection_min": config.green_detection_min,
            },
            "yellow": {
                "far_max": config.yellow_far_max,
                "frr_max": config.yellow_frr_max,
                "p95_ms_max": config.yellow_p95_ms_max,
                "detection_min": config.yellow_detection_min,
            },
        },
    }

    json_path, md_path = write_reports(config, payload)
    print(f"Semáforo: {light}")
    print(f"Umbral recomendado: {recommended['threshold']}")
    print(f"Reporte JSON: {json_path}")
    print(f"Reporte MD: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
