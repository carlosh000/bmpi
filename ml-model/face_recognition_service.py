
#!/usr/bin/env python3
"""
Face Recognition Service - Precisión profesional usando face_recognition (dlib)
"""
import sys
import json
import os
from pathlib import Path
import face_recognition
from PIL import Image
import numpy as np

EMBEDDINGS_DIR = Path(__file__).parent / "embeddings"
EMBEDDINGS_DIR.mkdir(exist_ok=True)

def extract_face_embedding(image_path):
    try:
        image = face_recognition.load_image_file(image_path)
        encodings = face_recognition.face_encodings(image)
        if len(encodings) == 0:
            return None
        return encodings[0].tolist()  # 128-dim float list
    except Exception:
        return None

def register_face(image_path, employee_id, name):
    embedding = extract_face_embedding(image_path)
    if embedding is None:
        return {"success": False, "message": "No se detectó rostro"}
    embedding_file = EMBEDDINGS_DIR / f"{employee_id}_{name}.json"
    with open(embedding_file, 'w') as f:
        json.dump({
            "employee_id": employee_id,
            "name": name,
            "embedding": embedding,
            "image_path": image_path
        }, f)
    return {"success": True, "message": f"Empleado {name} registrado", "employee_id": employee_id}

def recognize_face(image_path, threshold=0.6):
    current_embedding = extract_face_embedding(image_path)
    if current_embedding is None:
        return {"found": False, "message": "No se detectó rostro", "confidence": 0}
    best_match = None
    best_distance = float('inf')
    for embedding_file in EMBEDDINGS_DIR.glob("*.json"):
        try:
            with open(embedding_file, 'r') as f:
                stored_data = json.load(f)
            stored_embedding = np.array(stored_data["embedding"])
            distance = np.linalg.norm(np.array(current_embedding) - stored_embedding)
            if distance < best_distance:
                best_distance = distance
                best_match = stored_data
        except:
            continue
    # face_recognition recomienda threshold ~0.6 para match
    if best_match and best_distance <= threshold:
        confidence = max(0, 1 - best_distance / threshold)
        return {
            "found": True,
            "employee_id": best_match["employee_id"],
            "name": best_match["name"],
            "confidence": confidence,
            "message": f"Reconocido: {best_match['name']}"
        }
    else:
        return {"found": False, "message": "Rostro no reconocido", "confidence": 1 - best_distance / threshold}

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"success": False, "error": "Uso: python script.py <command> <image_path> [params]"}))
        sys.exit(0)
    command = sys.argv[1]
    if command == "extract":
        image_path = sys.argv[2] if len(sys.argv) > 2 else None
        if not image_path:
            print(json.dumps({"success": False, "error": "image_path requerido"}))
            sys.exit(0)
        embedding = extract_face_embedding(image_path)
        if embedding:
            print(json.dumps({"success": True, "embedding": embedding}))
        else:
            print(json.dumps({"success": False, "error": "No se detectó rostro"}))
        sys.exit(0)
    elif command == "recognize":
        image_path = sys.argv[2] if len(sys.argv) > 2 else None
        threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.6
        if not image_path:
            print(json.dumps({"success": False, "error": "image_path requerido"}))
            sys.exit(0)
        result = recognize_face(image_path, threshold)
        result["success"] = True if result.get("found") else False
        print(json.dumps(result))
        sys.exit(0)
    elif command == "register":
        image_path = sys.argv[2] if len(sys.argv) > 2 else None
        employee_id = sys.argv[3] if len(sys.argv) > 3 else None
        name = sys.argv[4] if len(sys.argv) > 4 else None
        if not all([image_path, employee_id, name]):
            print(json.dumps({"success": False, "error": "image_path, employee_id y name requeridos"}))
            sys.exit(0)
        result = register_face(image_path, employee_id, name)
        print(json.dumps(result))
        sys.exit(0)
    else:
        print(json.dumps({"success": False, "error": f"Comando desconocido: {command}"}))
        sys.exit(0)
