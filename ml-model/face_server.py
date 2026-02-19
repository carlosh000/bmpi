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

THRESHOLD = 0.5
FACE_MODEL = os.getenv("BMPI_FACE_MODEL", "hog")
REFRESH_SECONDS = int(os.getenv("BMPI_EMBEDDINGS_REFRESH_SECONDS", "30"))
GRPC_WORKERS = int(os.getenv("BMPI_GRPC_WORKERS", "10"))


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
        finally:
            cur.close()
    finally:
        pool_conn.putconn(conn)


def extract_face_embedding_from_path(image_path):
    try:
        image = face_recognition.load_image_file(image_path)
        encodings = face_recognition.face_encodings(image)
        if len(encodings) == 0:
            return None
        return encodings[0].tolist()
    except Exception:
        return None


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
            ids.append(emp_id)
            embeddings.append(pickle.loads(embed))

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

    def _upsert_cache_entry(self, employee_id, embedding):
        vector = np.array(embedding, dtype=np.float64)
        with self._cache_lock:
            if len(self.known_embeddings) == 0:
                self.known_embeddings = np.array([vector], dtype=np.float64)
                self.known_ids = [employee_id]
            else:
                try:
                    index = self.known_ids.index(employee_id)
                except ValueError:
                    index = -1

                if index >= 0:
                    self.known_embeddings[index] = vector
                else:
                    self.known_embeddings = np.vstack([self.known_embeddings, vector])
                    self.known_ids.append(employee_id)
            self._last_refresh_ts = time.time()

    def RegisterEmployee(self, request, context):
        image = np.frombuffer(request.image, np.uint8)
        frame = cv2.imdecode(image, cv2.IMREAD_COLOR)

        if frame is None:
            return pb2.RegisterEmployeeResponse(success=False, message="Invalid image")

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb_frame)
        if not encodings:
            return pb2.RegisterEmployeeResponse(success=False, message="No face detected")

        new_embedding = encodings[0]

        pool_conn = get_connection_pool()
        conn = pool_conn.getconn()
        cache_embedding = new_embedding
        try:
            cur = conn.cursor()
            try:
                cur.execute(
                    "SELECT embedding, samples_count FROM employees WHERE employee_id = %s",
                    (request.employee_id,),
                )
                existing = cur.fetchone()

                if existing:
                    old_embedding = np.array(pickle.loads(existing[0]))
                    samples_count = int(existing[1] or 1)
                    averaged = ((old_embedding * samples_count) + new_embedding) / (samples_count + 1)
                    cache_embedding = averaged

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
                            pickle.dumps(averaged),
                            request.image,
                            samples_count + 1,
                            request.employee_id,
                        ),
                    )
                    message = f"Employee embedding updated ({samples_count + 1} samples)"
                else:
                    cur.execute(
                        "INSERT INTO employees (name, employee_id, embedding, photo, samples_count) VALUES (%s,%s,%s,%s,%s)",
                        (request.name, request.employee_id, pickle.dumps(new_embedding), request.image, 1),
                    )
                    message = "Employee registered"

                conn.commit()
            finally:
                cur.close()
        finally:
            pool_conn.putconn(conn)

        self._upsert_cache_entry(request.employee_id, cache_embedding)
        return pb2.RegisterEmployeeResponse(success=True, message=message)

    def RecognizeFace(self, request, context):
        self._maybe_refresh_embeddings()
        known_embeddings, known_ids = self._cache_snapshot()
        if len(known_embeddings) == 0:
            return pb2.RecognizeFaceResponse(recognized=False)

        image = np.frombuffer(request.image, np.uint8)
        frame = cv2.imdecode(image, cv2.IMREAD_COLOR)
        if frame is None:
            return pb2.RecognizeFaceResponse(recognized=False)

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        locations = face_recognition.face_locations(rgb_frame, model=FACE_MODEL)
        if not locations:
            return pb2.RecognizeFaceResponse(recognized=False)

        encodings = face_recognition.face_encodings(rgb_frame, locations)
        if not encodings:
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
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=GRPC_WORKERS))
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

    serve()
