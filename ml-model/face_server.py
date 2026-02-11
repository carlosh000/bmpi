#!/usr/bin/env python3
"""gRPC server para reconocimiento facial y registro de asistencia."""

from concurrent import futures
from datetime import datetime, timedelta
import pickle

import cv2
import face_recognition
import grpc
import numpy as np
import psycopg2

import pb.face_recognition_pb2 as pb2
import pb.face_recognition_pb2_grpc as pb2_grpc

DB = psycopg2.connect(
    host="localhost",
    database="bmpi",
    user="postgres",
    password="1234",
)


class FaceService(pb2_grpc.FaceRecognitionServiceServicer):
    def get_db_embeddings(self):
        cur = DB.cursor()
        cur.execute("SELECT employee_id, embedding FROM employees")
        data = cur.fetchall()
        cur.close()
        return [(emp_id, pickle.loads(embed)) for emp_id, embed in data]

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

        cur = DB.cursor()
        cur.execute(
            "INSERT INTO employees (name, employee_id, embedding) VALUES (%s,%s,%s)",
            (request.name, request.employee_id, embedding),
        )
        DB.commit()
        cur.close()

        return pb2.RegisterEmployeeResponse(success=True, message="Employee registered")

    def RecognizeFace(self, request, context):
        image = np.frombuffer(request.image, np.uint8)
        frame = cv2.imdecode(image, cv2.IMREAD_COLOR)
        if frame is None:
            return pb2.RecognizeFaceResponse(recognized=False)

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        encodings = face_recognition.face_encodings(rgb_frame)
        if not encodings:
            return pb2.RecognizeFaceResponse(recognized=False)

        unknown = encodings[0]
        employees = self.get_db_embeddings()

        best_match = None
        best_distance = 1.0

        for emp_id, db_embed in employees:
            dist = np.linalg.norm(db_embed - unknown)
            if dist < best_distance:
                best_distance = dist
                best_match = emp_id

        if best_match is not None and best_distance < 0.5:
            return pb2.RecognizeFaceResponse(
                recognized=True,
                employee_id=str(best_match),
                confidence=float(1 - best_distance),
            )

        return pb2.RecognizeFaceResponse(recognized=False)

    def LogAttendance(self, request, context):
        cur = DB.cursor()

        # ⛔ ANTIDUPLICADO (5 minutos)
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
            return pb2.AttendanceResponse(success=False, message="Duplicate prevented")

        cur.execute(
            "INSERT INTO attendance (employee_id, timestamp) VALUES (%s, NOW())",
            (request.employee_id,),
        )
        DB.commit()
        cur.close()

        return pb2.AttendanceResponse(success=True, message="Attendance logged")

    def ListEmployees(self, request, context):
        cur = DB.cursor()
        cur.execute("SELECT name, employee_id FROM employees")
        rows = cur.fetchall()
        cur.close()

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
