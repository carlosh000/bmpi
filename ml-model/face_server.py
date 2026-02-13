#!/usr/bin/env python3
"""gRPC server optimizado para reconocimiento facial y registro de asistencia."""

from concurrent import futures
from datetime import datetime, timedelta
import os
import pickle

import cv2
import face_recognition
import grpc
import numpy as np
import psycopg2
from psycopg2 import pool

import pb.face_recognition_pb2 as pb2
import pb.face_recognition_pb2_grpc as pb2_grpc


# ===============================
# CONFIGURACIÓN SEGURA BD
# ===============================

connection_pool = psycopg2.pool.SimpleConnectionPool(
    1,
    10,
    host=os.getenv("DB_HOST", "localhost"),
    database=os.getenv("DB_NAME", "bmpi"),
    user=os.getenv("DB_USER", "postgres"),
    password=os.getenv("DB_PASSWORD", "1234"),
)


THRESHOLD = 0.5


class FaceService(pb2_grpc.FaceRecognitionServiceServicer):

    def __init__(self):
        self.known_ids = []
        self.known_embeddings = np.array([])
        self.load_embeddings()

    # ===============================
    # CARGAR EMBEDDINGS EN MEMORIA
    # ===============================
    def load_embeddings(self):
        conn = connection_pool.getconn()
        cur = conn.cursor()
        cur.execute("SELECT employee_id, embedding FROM employees")
        data = cur.fetchall()
        cur.close()
        connection_pool.putconn(conn)

        ids = []
        embeddings = []

        for emp_id, embed in data:
            ids.append(emp_id)
            embeddings.append(pickle.loads(embed))

        if embeddings:
            self.known_embeddings = np.array(embeddings)
            self.known_ids = ids
        else:
            self.known_embeddings = np.array([])
            self.known_ids = []

        print(f"Loaded {len(self.known_ids)} embeddings into memory.")

    # ===============================
    # REGISTRO DE EMPLEADO
    # ===============================
    def RegisterEmployee(self, request, context):

        image = np.frombuffer(request.image, np.uint8)
        frame = cv2.imdecode(image, cv2.IMREAD_COLOR)

        if frame is None:
            return pb2.RegisterEmployeeResponse(success=False, message="Invalid image")

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        encodings = face_recognition.face_encodings(rgb_frame)

        if not encodings:
            return pb2.RegisterEmployeeResponse(success=False, message="No face detected")

        embedding = pickle.dumps(encodings[0])

        conn = connection_pool.getconn()
        cur = conn.cursor()

        cur.execute(
            "INSERT INTO employees (name, employee_id, embedding) VALUES (%s,%s,%s)",
            (request.name, request.employee_id, embedding),
        )

        conn.commit()
        cur.close()
        connection_pool.putconn(conn)

        # 🔥 Actualizar cache en memoria
        self.load_embeddings()

        return pb2.RegisterEmployeeResponse(success=True, message="Employee registered")

    # ===============================
    # RECONOCIMIENTO OPTIMIZADO
    # ===============================
    def RecognizeFace(self, request, context):

        if len(self.known_embeddings) == 0:
            return pb2.RecognizeFaceResponse(recognized=False)

        image = np.frombuffer(request.image, np.uint8)
        frame = cv2.imdecode(image, cv2.IMREAD_COLOR)

        if frame is None:
            return pb2.RecognizeFaceResponse(recognized=False)

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        encodings = face_recognition.face_encodings(rgb_frame)

        if not encodings:
            return pb2.RecognizeFaceResponse(recognized=False)

        unknown = encodings[0]

        # 🔥 Comparación vectorizada (MUCHO más rápida)
        distances = face_recognition.face_distance(
            self.known_embeddings,
            unknown
        )

        best_index = np.argmin(distances)
        best_distance = distances[best_index]

        if best_distance < THRESHOLD:
            employee_id = str(self.known_ids[best_index])

            # Normalizar confianza
            confidence = max(0, 1 - (best_distance / THRESHOLD))

            return pb2.RecognizeFaceResponse(
                recognized=True,
                employee_id=employee_id,
                confidence=float(confidence),
            )

        return pb2.RecognizeFaceResponse(recognized=False)

    # ===============================
    # LOG DE ASISTENCIA
    # ===============================
    def LogAttendance(self, request, context):

        conn = connection_pool.getconn()
        cur = conn.cursor()

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
            cur.close()
            connection_pool.putconn(conn)
            return pb2.AttendanceResponse(success=False, message="Duplicate prevented")

        cur.execute(
            "INSERT INTO attendance (employee_id, timestamp) VALUES (%s, NOW())",
            (request.employee_id,),
        )

        conn.commit()
        cur.close()
        connection_pool.putconn(conn)

        return pb2.AttendanceResponse(success=True, message="Attendance logged")

    # ===============================
    # LISTAR EMPLEADOS
    # ===============================
    def ListEmployees(self, request, context):

        conn = connection_pool.getconn()
        cur = conn.cursor()

        cur.execute("SELECT name, employee_id FROM employees")
        rows = cur.fetchall()

        cur.close()
        connection_pool.putconn(conn)

        employees = [pb2.Employee(name=r[0], employee_id=str(r[1])) for r in rows]

        return pb2.EmployeeList(employees=employees)


def serve():
    server = grpc.server(futures.ThreadPoolExecutor(max_workers=5))
    pb2_grpc.add_FaceRecognitionServiceServicer_to_server(FaceService(), server)
    server.add_insecure_port("[::]:50051")
    server.start()
    print("Face Recognition Service running on port 50051...")
    server.wait_for_termination()


if __name__ == "__main__":
    serve()
