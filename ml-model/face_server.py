#!/usr/bin/env python3
"""gRPC server optimizado para reconocimiento facial y registro de asistencia."""

from concurrent import futures
from datetime import datetime, timedelta
import json
import os
import pickle
import sys
import threading
import time
import traceback

import cv2
import face_recognition
import grpc
import numpy as np
import psycopg2
from psycopg2 import pool

import pb.face_recognition_pb2 as pb2
import pb.face_recognition_pb2_grpc as pb2_grpc


connection_pool = None
schema_initialized = False

THRESHOLD = float(os.getenv("BMPI_FACE_THRESHOLD", "0.5"))
FACE_MODEL = os.getenv("BMPI_FACE_MODEL", "hog")
FACE_MODEL_FALLBACK = os.getenv("BMPI_FACE_MODEL_FALLBACK", "cnn").strip().lower()
FACE_HAAR_FALLBACK = os.getenv("BMPI_FACE_HAAR_FALLBACK", "true").strip().lower() in ("1", "true", "yes")
FACE_CONTRAST_FALLBACK = os.getenv("BMPI_FACE_CONTRAST_FALLBACK", "true").strip().lower() in ("1", "true", "yes")
FACE_ROTATION_FALLBACK = os.getenv("BMPI_FACE_ROTATION_FALLBACK", "true").strip().lower() in ("1", "true", "yes")
FACE_ROTATION_ANGLES_RAW = os.getenv("BMPI_FACE_ROTATION_ANGLES", "-12,12,-20,20")
FACE_ENCODING_MODEL = os.getenv("BMPI_FACE_ENCODING_MODEL", "small")
FACE_ENCODING_JITTERS_REGISTER = max(1, int(os.getenv("BMPI_FACE_ENCODING_JITTERS_REGISTER", "2")))
FACE_ENCODING_JITTERS_RECOGNIZE = max(1, int(os.getenv("BMPI_FACE_ENCODING_JITTERS_RECOGNIZE", "1")))
MAX_PROTOTYPES_PER_EMPLOYEE = max(1, int(os.getenv("BMPI_MAX_PROTOTYPES_PER_EMPLOYEE", "6")))
REFRESH_SECONDS = int(os.getenv("BMPI_EMBEDDINGS_REFRESH_SECONDS", "30"))
GRPC_WORKERS = int(os.getenv("BMPI_GRPC_WORKERS", "10"))
FACE_ENCODE_CONCURRENCY = max(1, int(os.getenv("BMPI_FACE_ENCODE_CONCURRENCY", "1")))
face_encode_semaphore = threading.BoundedSemaphore(FACE_ENCODE_CONCURRENCY)
GRPC_MAX_MSG_MB = max(1, int(os.getenv("BMPI_GRPC_MAX_MSG_MB", "20")))
GRPC_MAX_MSG_BYTES = GRPC_MAX_MSG_MB * 1024 * 1024
FACE_DETECT_UPSAMPLE = max(0, int(os.getenv("BMPI_FACE_DETECT_UPSAMPLE", "1")))
FACE_DETECT_RETRY_UPSAMPLE = max(FACE_DETECT_UPSAMPLE, int(os.getenv("BMPI_FACE_DETECT_RETRY_UPSAMPLE", "2")))
HAAR_MIN_FACE = max(24, int(os.getenv("BMPI_HAAR_MIN_FACE", "64")))

haar_frontal = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
haar_profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")


def parse_rotation_angles(raw):
    values = []
    for token in (raw or "").split(","):
        candidate = token.strip()
        if not candidate:
            continue
        try:
            angle = float(candidate)
        except Exception:
            continue
        if abs(angle) < 0.1:
            continue
        values.append(angle)

    if not values:
        values = [-12.0, 12.0, -20.0, 20.0]

    return values


FACE_ROTATION_ANGLES = parse_rotation_angles(FACE_ROTATION_ANGLES_RAW)


def enhance_contrast_clahe(rgb_image):
    lab = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2LAB)
    l_channel, a_channel, b_channel = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    l_enhanced = clahe.apply(l_channel)
    merged = cv2.merge((l_enhanced, a_channel, b_channel))
    return cv2.cvtColor(merged, cv2.COLOR_LAB2RGB)


def rotate_rgb_image(rgb_image, angle_degrees):
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


def build_detection_variants(rgb_image):
    variants = [("base", rgb_image)]

    if FACE_CONTRAST_FALLBACK:
        try:
            enhanced = enhance_contrast_clahe(rgb_image)
            variants.append(("clahe", enhanced))
        except Exception:
            pass

    if FACE_ROTATION_FALLBACK:
        for angle in FACE_ROTATION_ANGLES:
            try:
                rotated = rotate_rgb_image(rgb_image, angle)
                variants.append((f"rot_{angle}", rotated))
            except Exception:
                continue

    return variants


def haar_rects_to_locations(rects):
    locations = []
    for x, y, w, h in rects:
        top = int(y)
        right = int(x + w)
        bottom = int(y + h)
        left = int(x)
        locations.append((top, right, bottom, left))
    return locations


def detect_face_locations_haar(rgb_image):
    if haar_frontal.empty() and haar_profile.empty():
        return []

    gray = cv2.cvtColor(rgb_image, cv2.COLOR_RGB2GRAY)
    candidates = []

    if not haar_frontal.empty():
        frontal = haar_frontal.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(HAAR_MIN_FACE, HAAR_MIN_FACE),
        )
        candidates.extend(haar_rects_to_locations(frontal))

    if not haar_profile.empty():
        profile_right = haar_profile.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(HAAR_MIN_FACE, HAAR_MIN_FACE),
        )
        candidates.extend(haar_rects_to_locations(profile_right))

        flipped = cv2.flip(gray, 1)
        profile_left = haar_profile.detectMultiScale(
            flipped,
            scaleFactor=1.1,
            minNeighbors=4,
            minSize=(HAAR_MIN_FACE, HAAR_MIN_FACE),
        )
        width = gray.shape[1]
        for x, y, w, h in profile_left:
            mirrored_x = width - (x + w)
            candidates.append((int(y), int(mirrored_x + w), int(y + h), int(mirrored_x)))

    if not candidates:
        return []

    unique = []
    seen = set()
    for item in candidates:
        key = tuple(int(v) for v in item)
        if key in seen:
            continue
        seen.add(key)
        unique.append(key)

    return unique


def detect_face_locations(rgb_image, model):
    locations = face_recognition.face_locations(
        rgb_image,
        number_of_times_to_upsample=FACE_DETECT_UPSAMPLE,
        model=model,
    )

    if not locations and FACE_DETECT_RETRY_UPSAMPLE > FACE_DETECT_UPSAMPLE:
        locations = face_recognition.face_locations(
            rgb_image,
            number_of_times_to_upsample=FACE_DETECT_RETRY_UPSAMPLE,
            model=model,
        )

    if not locations and FACE_HAAR_FALLBACK:
        locations = detect_face_locations_haar(rgb_image)

    return locations


def extract_primary_face_encoding(rgb_image, num_jitters=1):
    variants = build_detection_variants(rgb_image)

    for _, variant_rgb in variants:
        locations = detect_face_locations(variant_rgb, FACE_MODEL)

        if not locations and FACE_MODEL_FALLBACK and FACE_MODEL_FALLBACK != FACE_MODEL:
            locations = detect_face_locations(variant_rgb, FACE_MODEL_FALLBACK)

        if not locations:
            continue

        best_location = max(locations, key=lambda loc: max(0, loc[2] - loc[0]) * max(0, loc[1] - loc[3]))
        encodings = face_recognition.face_encodings(
            variant_rgb,
            [best_location],
            num_jitters=max(1, int(num_jitters)),
            model=FACE_ENCODING_MODEL,
        )
        if encodings:
            return encodings[0]

    return None


def extract_candidate_encodings(rgb_image, num_jitters=1, max_candidates=3):
    candidates = []
    variants = build_detection_variants(rgb_image)

    for _, variant_rgb in variants:
        locations = detect_face_locations(variant_rgb, FACE_MODEL)
        if not locations and FACE_MODEL_FALLBACK and FACE_MODEL_FALLBACK != FACE_MODEL:
            locations = detect_face_locations(variant_rgb, FACE_MODEL_FALLBACK)
        if not locations:
            continue

        ordered_locations = sorted(
            locations,
            key=lambda loc: max(0, loc[2] - loc[0]) * max(0, loc[1] - loc[3]),
            reverse=True,
        )

        for location in ordered_locations[:2]:
            encodings = face_recognition.face_encodings(
                variant_rgb,
                [location],
                num_jitters=max(1, int(num_jitters)),
                model=FACE_ENCODING_MODEL,
            )
            if not encodings:
                continue
            candidates.append(encodings[0])
            if len(candidates) >= max_candidates:
                return candidates

    return candidates


def decode_embedding_payload(raw_embedding):
    loaded = pickle.loads(raw_embedding)

    if isinstance(loaded, dict):
        raw_prototypes = loaded.get("prototypes") or []
        prototypes = []
        for item in raw_prototypes:
            try:
                vec = np.array(item, dtype=np.float64)
                if vec.ndim == 1 and vec.size > 0:
                    prototypes.append(vec)
            except Exception:
                continue
        if prototypes:
            return prototypes

        centroid = loaded.get("centroid")
        if centroid is not None:
            vec = np.array(centroid, dtype=np.float64)
            if vec.ndim == 1 and vec.size > 0:
                return [vec]

    vec = np.array(loaded, dtype=np.float64)
    if vec.ndim == 1 and vec.size > 0:
        return [vec]
    return []


def build_embedding_payload(prototypes):
    valid = []
    for item in prototypes:
        vec = np.array(item, dtype=np.float64)
        if vec.ndim == 1 and vec.size > 0:
            valid.append(vec)

    if not valid:
        raise ValueError("No hay prototipos válidos para guardar")

    centroid = np.mean(np.vstack(valid), axis=0)
    return {
        "version": 2,
        "prototypes": [v.tolist() for v in valid],
        "centroid": centroid.tolist(),
    }


def select_prototypes(prototypes, max_count):
    if len(prototypes) <= max_count:
        return prototypes

    selected = [prototypes[-1]]
    remaining = prototypes[:-1]

    while remaining and len(selected) < max_count:
        best_index = 0
        best_score = -1.0

        for idx, candidate in enumerate(remaining):
            distances = [float(np.linalg.norm(candidate - chosen)) for chosen in selected]
            score = min(distances) if distances else 0.0
            if score > best_score:
                best_score = score
                best_index = idx

        selected.append(remaining.pop(best_index))

    return selected


def is_production():
    return os.getenv("BMPI_ENV", "").strip().lower() == "production"


def bool_from_env(name):
    value = os.getenv(name, "").strip().lower()
    return value in ("1", "true", "yes")


def resolve_db_config():
    host = os.getenv("DB_HOST", "localhost").strip()
    db_name = os.getenv("DB_NAME", "bmpi").strip()
    db_user = os.getenv("DB_USER", "postgres").strip()
    db_password = os.getenv("DB_PASSWORD", "").strip()
    db_sslmode = os.getenv("DB_SSLMODE", "").strip()

    if not db_sslmode:
        db_sslmode = "require" if is_production() else "disable"
    if not db_password and is_production():
        raise RuntimeError("DB_PASSWORD is required in production")

    return {
        "host": host or "localhost",
        "database": db_name or "bmpi",
        "user": db_user or "postgres",
        "password": db_password,
        "sslmode": db_sslmode,
    }


def get_connection_pool():
    global connection_pool
    global schema_initialized
    if connection_pool is None:
        cfg = resolve_db_config()
        connection_pool = psycopg2.pool.SimpleConnectionPool(
            1,
            10,
            host=cfg["host"],
            database=cfg["database"],
            user=cfg["user"],
            password=cfg["password"],
            sslmode=cfg["sslmode"],
        )
    if not schema_initialized:
        ensure_schema(connection_pool)
        schema_initialized = True
    return connection_pool


def ensure_schema(pool_conn):
    conn = pool_conn.getconn()
    try:
        cur = conn.cursor()
        try:
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS employees (
                    id SERIAL PRIMARY KEY,
                    name TEXT NOT NULL,
                    employee_id TEXT UNIQUE NOT NULL,
                    embedding BYTEA NOT NULL,
                    samples_count INTEGER NOT NULL DEFAULT 1
                );
                CREATE TABLE IF NOT EXISTS attendance (
                    id SERIAL PRIMARY KEY,
                    employee_id TEXT NOT NULL,
                    timestamp TIMESTAMP NOT NULL DEFAULT NOW()
                );
                ALTER TABLE employees ADD COLUMN IF NOT EXISTS photo BYTEA;
                ALTER TABLE employees ADD COLUMN IF NOT EXISTS samples_count INTEGER NOT NULL DEFAULT 1;
                """
            )
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            cur.close()
    finally:
        pool_conn.putconn(conn)


def extract_face_embedding_from_path(image_path):
    try:
        image = face_recognition.load_image_file(image_path)
        encoding = extract_primary_face_encoding(image, num_jitters=FACE_ENCODING_JITTERS_REGISTER)
        if encoding is None:
            return None
        return encoding.tolist()
    except Exception:
        return None


def extract_face_embeddings_from_paths(image_paths):
    results = []
    for image_path in image_paths:
        embedding = extract_face_embedding_from_path(image_path)
        if embedding is None:
            results.append(
                {
                    "path": image_path,
                    "success": False,
                    "error": "No se detecto rostro",
                }
            )
            continue

        results.append(
            {
                "path": image_path,
                "success": True,
                "embedding": embedding,
            }
        )

    return results


class FaceService(pb2_grpc.FaceRecognitionServiceServicer):
    def __init__(self):
        self.known_ids = []
        self.known_embeddings = np.array([])
        self._cache_lock = threading.RLock()
        self._last_refresh_ts = 0.0
        self.load_embeddings()

    def load_embeddings(self):
        pool_conn = get_connection_pool()
        conn = pool_conn.getconn()
        try:
            cur = conn.cursor()
            try:
                cur.execute("SELECT employee_id, embedding FROM employees")
                data = cur.fetchall()
            finally:
                cur.close()
        finally:
            pool_conn.putconn(conn)

        ids = []
        embeddings = []

        for emp_id, embed in data:
            prototype_vectors = decode_embedding_payload(embed)
            for vector in prototype_vectors:
                ids.append(emp_id)
                embeddings.append(vector)

        with self._cache_lock:
            if embeddings:
                self.known_embeddings = np.array(embeddings)
                self.known_ids = ids
            else:
                self.known_embeddings = np.array([])
                self.known_ids = []
            self._last_refresh_ts = time.time()

        print(f"Loaded {len(self.known_ids)} embeddings into memory.")

    def _maybe_refresh_embeddings(self):
        now = time.time()
        if REFRESH_SECONDS <= 0:
            return
        if now - self._last_refresh_ts >= REFRESH_SECONDS:
            self.load_embeddings()

    def _cache_snapshot(self):
        with self._cache_lock:
            if len(self.known_embeddings) == 0:
                return np.array([]), []
            return np.array(self.known_embeddings, copy=True), list(self.known_ids)

    def _upsert_cache_entry(self, employee_id, embeddings):
        vectors = []
        for emb in embeddings:
            vec = np.array(emb, dtype=np.float64)
            if vec.ndim == 1 and vec.size > 0:
                vectors.append(vec)

        if not vectors:
            return

        with self._cache_lock:
            keep_ids = []
            keep_embeddings = []
            for idx, known_id in enumerate(self.known_ids):
                if known_id != employee_id:
                    keep_ids.append(known_id)
                    keep_embeddings.append(self.known_embeddings[idx])

            for vector in vectors:
                keep_ids.append(employee_id)
                keep_embeddings.append(vector)

            if keep_embeddings:
                self.known_embeddings = np.array(keep_embeddings, dtype=np.float64)
                self.known_ids = keep_ids
            else:
                self.known_embeddings = np.array([])
                self.known_ids = []

            self._last_refresh_ts = time.time()

    def RegisterEmployee(self, request, context):
        try:
            image = np.frombuffer(request.image, np.uint8)
            frame = cv2.imdecode(image, cv2.IMREAD_COLOR)

            if frame is None:
                return pb2.RegisterEmployeeResponse(success=False, message="Invalid image")

            with face_encode_semaphore:
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                encoding = extract_primary_face_encoding(rgb_frame, num_jitters=FACE_ENCODING_JITTERS_REGISTER)

            if encoding is None:
                return pb2.RegisterEmployeeResponse(success=False, message="No face detected")

            new_embedding = np.array(encoding, dtype=np.float64)

            pool_conn = get_connection_pool()
            conn = pool_conn.getconn()
            cache_embeddings = [new_embedding]
            try:
                cur = conn.cursor()
                try:
                    cur.execute(
                        "SELECT embedding, samples_count FROM employees WHERE employee_id = %s",
                        (request.employee_id,),
                    )
                    existing = cur.fetchone()

                    if existing:
                        old_prototypes = decode_embedding_payload(existing[0])
                        samples_count = int(existing[1] or 1)
                        merged = old_prototypes + [new_embedding]
                        selected = select_prototypes(merged, MAX_PROTOTYPES_PER_EMPLOYEE)
                        payload = build_embedding_payload(selected)
                        cache_embeddings = selected

                        cur.execute(
                            """
                            UPDATE employees
                            SET name = %s,
                                embedding = %s,
                                photo = %s,
                                samples_count = %s
                            WHERE employee_id = %s
                            """,
                            (
                                request.name,
                                pickle.dumps(payload),
                                request.image,
                                samples_count + 1,
                                request.employee_id,
                            ),
                        )
                        message = f"Employee embedding updated ({samples_count + 1} samples, {len(selected)} prototipos)"
                    else:
                        payload = build_embedding_payload([new_embedding])
                        cur.execute(
                            "INSERT INTO employees (name, employee_id, embedding, photo, samples_count) VALUES (%s,%s,%s,%s,%s)",
                            (request.name, request.employee_id, pickle.dumps(payload), request.image, 1),
                        )
                        message = "Employee registered"

                    conn.commit()
                except Exception:
                    conn.rollback()
                    raise
                finally:
                    cur.close()
            finally:
                pool_conn.putconn(conn)

            self._upsert_cache_entry(request.employee_id, cache_embeddings)
            return pb2.RegisterEmployeeResponse(success=True, message=message)
        except Exception as exc:
            print(f"RegisterEmployee error: {exc}")
            traceback.print_exc()
            return pb2.RegisterEmployeeResponse(success=False, message="Error interno al registrar empleado")

    def RecognizeFace(self, request, context):
        try:
            self._maybe_refresh_embeddings()
            known_embeddings, known_ids = self._cache_snapshot()
            if len(known_embeddings) == 0:
                return pb2.RecognizeFaceResponse(recognized=False)

            image = np.frombuffer(request.image, np.uint8)
            frame = cv2.imdecode(image, cv2.IMREAD_COLOR)
            if frame is None:
                return pb2.RecognizeFaceResponse(recognized=False)

            with face_encode_semaphore:
                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                encodings = extract_candidate_encodings(
                    rgb_frame,
                    num_jitters=FACE_ENCODING_JITTERS_RECOGNIZE,
                    max_candidates=4,
                )
                if len(encodings) == 0:
                    return pb2.RecognizeFaceResponse(recognized=False)

            best_distance = None
            best_index = -1
            for unknown in encodings:
                distances = face_recognition.face_distance(known_embeddings, unknown)
                local_index = int(np.argmin(distances))
                local_distance = float(distances[local_index])
                if best_distance is None or local_distance < best_distance:
                    best_distance = local_distance
                    best_index = local_index

            if best_distance is not None and best_distance < THRESHOLD and best_index >= 0:
                employee_id = str(known_ids[best_index])
                confidence = max(0, 1 - (best_distance / THRESHOLD))
                return pb2.RecognizeFaceResponse(
                    recognized=True,
                    employee_id=employee_id,
                    confidence=float(confidence),
                )

            return pb2.RecognizeFaceResponse(recognized=False)
        except Exception as exc:
            print(f"RecognizeFace error: {exc}")
            traceback.print_exc()
            return pb2.RecognizeFaceResponse(recognized=False)

    def LogAttendance(self, request, context):
        pool_conn = get_connection_pool()
        conn = pool_conn.getconn()
        try:
            cur = conn.cursor()
            try:
                cur.execute(
                    """
                    SELECT timestamp FROM attendance
                    WHERE employee_id = %s
                    ORDER BY timestamp DESC LIMIT 1
                    """,
                    (request.employee_id,),
                )
                last = cur.fetchone()
                if last and datetime.now() - last[0] < timedelta(minutes=5):
                    return pb2.AttendanceResponse(success=False, message="Duplicate prevented")

                cur.execute(
                    "INSERT INTO attendance (employee_id, timestamp) VALUES (%s, NOW())",
                    (request.employee_id,),
                )
                conn.commit()
            finally:
                cur.close()
        finally:
            pool_conn.putconn(conn)

        return pb2.AttendanceResponse(success=True, message="Attendance logged")

    def ListEmployees(self, request, context):
        pool_conn = get_connection_pool()
        conn = pool_conn.getconn()
        try:
            cur = conn.cursor()
            try:
                cur.execute("SELECT name, employee_id FROM employees")
                rows = cur.fetchall()
            finally:
                cur.close()
        finally:
            pool_conn.putconn(conn)

        employees = [pb2.Employee(name=r[0], employee_id=str(r[1])) for r in rows]
        return pb2.EmployeeList(employees=employees)


def serve():
    server = grpc.server(
        futures.ThreadPoolExecutor(max_workers=GRPC_WORKERS),
        options=[
            ("grpc.max_receive_message_length", GRPC_MAX_MSG_BYTES),
            ("grpc.max_send_message_length", GRPC_MAX_MSG_BYTES),
        ],
    )
    pb2_grpc.add_FaceRecognitionServiceServicer_to_server(FaceService(), server)

    if bool_from_env("BMPI_GRPC_TLS"):
        cert_file = os.getenv("BMPI_GRPC_CERT_FILE", "").strip()
        key_file = os.getenv("BMPI_GRPC_KEY_FILE", "").strip()
        if not cert_file or not key_file:
            raise RuntimeError("BMPI_GRPC_CERT_FILE and BMPI_GRPC_KEY_FILE are required when BMPI_GRPC_TLS=true")

        with open(cert_file, "rb") as cert_handle:
            cert_chain = cert_handle.read()
        with open(key_file, "rb") as key_handle:
            private_key = key_handle.read()

        creds = grpc.ssl_server_credentials(((private_key, cert_chain),))
        server.add_secure_port("[::]:50051", creds)
        print("Face Recognition Service running on port 50051 (TLS enabled)...")
    else:
        server.add_insecure_port("[::]:50051")
        print("Face Recognition Service running on port 50051...")

    server.start()
    server.wait_for_termination()


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "extract":
        image_path = sys.argv[2] if len(sys.argv) > 2 else None
        if not image_path:
            print(json.dumps({"success": False, "error": "image_path requerido"}))
            sys.exit(0)

        embedding = extract_face_embedding_from_path(image_path)
        if embedding is None:
            print(json.dumps({"success": False, "error": "No se detecto rostro"}))
            sys.exit(0)

        print(json.dumps({"success": True, "embedding": embedding}))
        sys.exit(0)

    if len(sys.argv) > 1 and sys.argv[1] == "extract-batch":
        image_paths = sys.argv[2:]
        if not image_paths:
            print(json.dumps({"success": False, "error": "image_paths requeridos"}))
            sys.exit(0)

        batch_results = extract_face_embeddings_from_paths(image_paths)
        print(json.dumps({"success": True, "results": batch_results}))
        sys.exit(0)

    serve()
