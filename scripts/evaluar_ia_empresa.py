#!/usr/bin/env python3
"""Evaluacion de preparacion empresarial para IA facial (offline).

Este script calcula metricas clave con un dataset local:
- FRR (False Rejection Rate) para casos genuinos
- FAR (False Acceptance Rate) para casos impostores
- Tasa de deteccion de rostro
- Latencia promedio y p95 por imagen

Tambien genera:
- reporte JSON (metricas por umbral)
- reporte Markdown con semaforo (VERDE/AMARILLO/ROJO)

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

try:
    import cv2
except ImportError:
    cv2 = None


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp"}


@dataclass
class EvaluationConfig:
    dataset_dir: Path
    output_dir: Path
    model: str
    model_fallback: str
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
    detect_upsample: int
    detect_retry_upsample: int
    haar_fallback: bool
    haar_min_face: int
    contrast_fallback: bool
    rotation_fallback: bool
    rotation_angles: list[float]
    encoding_model: str
    encoding_jitters: int


def env_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def parse_rotation_angles(raw: str) -> list[float]:
    values: list[float] = []
    for token in (raw or "").split(","):
        token = token.strip()
        if not token:
            continue
        try:
            angle = float(token)
        except ValueError:
            continue
        if abs(angle) < 0.1:
            continue
        values.append(angle)
    return values or [-12.0, 12.0, -20.0, 20.0]


def parse_args() -> EvaluationConfig:
    parser = argparse.ArgumentParser(description="Evaluacion empresarial IA facial (offline).")
    parser.add_argument("--dataset", required=True, help="Ruta a dataset raiz (known/genuine/impostor).")
    parser.add_argument("--output", default="reports/ia", help="Directorio de salida de reportes.")
    parser.add_argument("--model", default=os.getenv("BMPI_FACE_MODEL", "hog"), choices=["hog", "cnn"], help="Modelo primario de deteccion.")
    parser.add_argument("--model-fallback", default=os.getenv("BMPI_FACE_MODEL_FALLBACK", "cnn"), help="Modelo secundario de deteccion.")
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
        help="Permite ejecutar aun con dataset no representativo (solo para pruebas tecnicas).",
    )
    parser.add_argument(
        "--max-image-dim",
        type=int,
        default=1280,
        help="Redimensiona imagenes grandes para acelerar evaluacion (0 desactiva).",
    )
    parser.add_argument("--detect-upsample", type=int, default=int(os.getenv("BMPI_FACE_DETECT_UPSAMPLE", "1")))
    parser.add_argument(
        "--detect-retry-upsample",
        type=int,
        default=int(os.getenv("BMPI_FACE_DETECT_RETRY_UPSAMPLE", "2")),
    )
    parser.add_argument(
        "--haar-fallback",
        action=argparse.BooleanOptionalAction,
        default=env_bool("BMPI_FACE_HAAR_FALLBACK", True),
        help="Usa Haar fallback cuando no detecta rostro con face_recognition.",
    )
    parser.add_argument("--haar-min-face", type=int, default=int(os.getenv("BMPI_HAAR_MIN_FACE", "64")))
    parser.add_argument(
        "--contrast-fallback",
        action=argparse.BooleanOptionalAction,
        default=env_bool("BMPI_FACE_CONTRAST_FALLBACK", True),
        help="Activa variante CLAHE para mejorar deteccion en baja luz.",
    )
    parser.add_argument(
        "--rotation-fallback",
        action=argparse.BooleanOptionalAction,
        default=env_bool("BMPI_FACE_ROTATION_FALLBACK", True),
        help="Activa variantes rotadas para mejorar deteccion de perfil.",
    )
    parser.add_argument(
        "--rotation-angles",
        default=os.getenv("BMPI_FACE_ROTATION_ANGLES", "-12,12,-20,20"),
        help="Angulos de rotacion fallback separados por coma.",
    )
    parser.add_argument("--encoding-model", default=os.getenv("BMPI_FACE_ENCODING_MODEL", "small"))
    parser.add_argument(
        "--encoding-jitters",
        type=int,
        default=max(1, int(os.getenv("BMPI_FACE_ENCODING_JITTERS_RECOGNIZE", "1"))),
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
        raise SystemExit("Debes proporcionar al menos un umbral valido en --thresholds")

    return EvaluationConfig(
        dataset_dir=Path(args.dataset).resolve(),
        output_dir=Path(args.output).resolve(),
        model=args.model.strip().lower(),
        model_fallback=args.model_fallback.strip().lower(),
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
        detect_upsample=max(0, int(args.detect_upsample)),
        detect_retry_upsample=max(0, int(args.detect_retry_upsample)),
        haar_fallback=bool(args.haar_fallback),
        haar_min_face=max(24, int(args.haar_min_face)),
        contrast_fallback=bool(args.contrast_fallback),
        rotation_fallback=bool(args.rotation_fallback),
        rotation_angles=parse_rotation_angles(args.rotation_angles),
        encoding_model=(args.encoding_model.strip() or "small"),
        encoding_jitters=max(1, int(args.encoding_jitters)),
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


def _enhance_contrast_clahe(rgb_image: np.ndarray) -> np.ndarray:
    if cv2 is None:
        return rgb_image
    lab = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_channel)
    merged = cv2.merge((l_enhanced, a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)


def _rotate_rgb_image(rgb_image: np.ndarray, angle_degrees: float) -> np.ndarray:
    if cv2 is None:
        return rgb_image
    h, w = rgb_image.shape[:2]
    center = (w / 2.0, h / 2.0)
    matrix = cv2.getRotationMatrix2D(center, angle_degrees, 1.0)
    return cv2.warpAffine(
        rgb_image,
        matrix,
        (w, h),
        flags=cv2.INTER_LINEAR,
        borderMode=cv2.BORDER_REFLECT,
    )


def _face_locations_safe(rgb_image: np.ndarray, model: str, upsample: int) -> list[tuple[int, int, int, int]]:
    try:
        return face_recognition.face_locations(
            rgb_image,
            number_of_times_to_upsample=max(0, int(upsample)),
            model=model,
        )
    except Exception:
        return []


def _haar_locations(rgb_image: np.ndarray, min_face: int) -> list[tuple[int, int, int, int]]:
    if cv2 is None:
        return []
    frontal = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    if frontal.empty():
        return []

    gray = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2GRAY)
    rects = frontal.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(max(24, int(min_face)), max(24, int(min_face))),
    )
    locations: list[tuple[int, int, int, int]] = []
    for x, y, w, h in rects:
        locations.append((int(y), int(x + w), int(y + h), int(x)))
    return locations


def _best_location(locations: Sequence[tuple[int, int, int, int]]) -> tuple[int, int, int, int]:
    return max(locations, key=lambda loc: max(0, loc[2] - loc[0]) * max(0, loc[1] - loc[3]))


def _image_variants(rgb_image: np.ndarray, config: EvaluationConfig) -> list[np.ndarray]:
    variants = [rgb_image]
    if config.contrast_fallback:
        try:
            variants.append(_enhance_contrast_clahe(rgb_image))
        except Exception:
            pass
    if config.rotation_fallback:
        for angle in config.rotation_angles:
            try:
                variants.append(_rotate_rgb_image(rgb_image, angle))
            except Exception:
                continue
    return variants


def extract_first_encoding(image_path: Path, config: EvaluationConfig) -> tuple[np.ndarray | None, bool, float]:
    started = time.perf_counter()
    image = face_recognition.load_image_file(str(image_path))
    image = _downscale_image(image, config.max_image_dim)
    variants = _image_variants(image, config)

    for variant in variants:
        locations = _face_locations_safe(variant, config.model, config.detect_upsample)
        if not locations and config.detect_retry_upsample > config.detect_upsample:
            locations = _face_locations_safe(variant, config.model, config.detect_retry_upsample)
        if not locations and config.model_fallback and config.model_fallback != config.model:
            locations = _face_locations_safe(variant, config.model_fallback, config.detect_upsample)
            if not locations and config.detect_retry_upsample > config.detect_upsample:
                locations = _face_locations_safe(variant, config.model_fallback, config.detect_retry_upsample)
        if not locations and config.haar_fallback:
            locations = _haar_locations(variant, config.haar_min_face)
        if not locations:
            continue

        best = _best_location(locations)
        encodings = face_recognition.face_encodings(
            variant,
            known_face_locations=[best],
            num_jitters=config.encoding_jitters,
            model=config.encoding_model,
        )
        if encodings:
            elapsed_ms = (time.perf_counter() - started) * 1000.0
            return np.array(encodings[0], dtype=np.float64), True, elapsed_ms

    elapsed_ms = (time.perf_counter() - started) * 1000.0
    return None, False, elapsed_ms


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


def build_known_embeddings(known_dir: Path, config: EvaluationConfig) -> tuple[list[str], np.ndarray, dict]:
    employee_vectors: dict[str, list[np.ndarray]] = {}
    parse_stats = {"images_total": 0, "images_with_face": 0, "images_without_face": 0}

    for image_path in list_images(known_dir):
        employee_id = employee_from_path(image_path, known_dir)
        if not employee_id:
            continue
        parse_stats["images_total"] += 1
        encoding, has_face, _ = extract_first_encoding(image_path, config)
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
    config: EvaluationConfig,
    known_ids: list[str],
    known_matrix: np.ndarray,
    threshold: float,
    expect_known: bool,
    group_root: Path,
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

        encoding, has_face, elapsed_ms = extract_first_encoding(image_path, config)
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
        config,
        known_ids,
        known_matrix,
        threshold,
        expect_known=True,
        group_root=genuine_dir,
    )
    impostor = evaluate_group(
        impostor_images,
        config,
        known_ids,
        known_matrix,
        threshold,
        expect_known=False,
        group_root=impostor_dir,
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
        return "AMARILLO", "Apto para piloto con mitigaciones y recalibracion."

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
        "# Evaluacion IA empresarial",
        "",
        f"- Fecha: {payload['generated_at']}",
        f"- Dataset: {payload['dataset']}",
        f"- Modelo de deteccion: {payload['model']}",
        f"- Modelo fallback: {payload['model_fallback'] or 'none'}",
        f"- Semaforo: **{light}**",
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
            "Dataset no representativo para decision empresarial. Corrige:\n"
            f"{joined}\n"
            "Si deseas ejecutar solo prueba tecnica, usa --allow-insufficient-dataset"
        )


def main() -> int:
    config = parse_args()

    known_dir = config.dataset_dir / "known"
    genuine_dir = config.dataset_dir / "genuine"
    impostor_dir = config.dataset_dir / "impostor"

    if not known_dir.exists() or not genuine_dir.exists() or not impostor_dir.exists():
        raise SystemExit("Dataset invalido: se requieren carpetas known/, genuine/, impostor/")

    known_ids, known_matrix, known_stats = build_known_embeddings(known_dir, config)
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
        raise SystemExit("Dataset insuficiente: genuine/ e impostor/ deben contener imagenes")

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
        "model_fallback": config.model_fallback,
        "known": {
            "employees": len(known_ids),
            "parse": known_stats,
        },
        "counts": {
            "genuine_images": len(genuine_images),
            "impostor_images": len(impostor_images),
        },
        "settings": {
            "detect_upsample": config.detect_upsample,
            "detect_retry_upsample": config.detect_retry_upsample,
            "haar_fallback": config.haar_fallback,
            "contrast_fallback": config.contrast_fallback,
            "rotation_fallback": config.rotation_fallback,
            "rotation_angles": config.rotation_angles,
            "encoding_model": config.encoding_model,
            "encoding_jitters": config.encoding_jitters,
            "max_image_dim": config.max_image_dim,
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
    print(f"Semaforo: {light}")
    print(f"Umbral recomendado: {recommended['threshold']}")
    print(f"Reporte JSON: {json_path}")
    print(f"Reporte MD: {md_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
