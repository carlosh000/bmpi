#!/usr/bin/env python3
"""
Face Recognition Service - Versión con OpenCV
Detecta y reconoce rostros sin requerer compilación de dlib
"""

import sys
import json
import os
import cv2
from pathlib import Path

# Directorio para guardar embeddings
EMBEDDINGS_DIR = Path(__file__).parent / "embeddings"
EMBEDDINGS_DIR.mkdir(exist_ok=True)

# Cascada para detección de rostros
face_cascade = cv2.CascadeClassifier(
    cv2.data.haarcascades + 'haarcascade_frontalface_default.xml'
)

def extract_face_embedding(image_path):
    """Extrae características de rostro usando OpenCV"""
    try:
        image = cv2.imread(image_path)
        if image is None:
            return None
        
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
        faces = face_cascade.detectMultiScale(gray, 1.3, 5)
        
        if len(faces) == 0:
            return None
        
        # Retornar características básicas del rostro
        x, y, w, h = faces[0]
        face_region = gray[y:y+h, x:x+w]
        
        # Crear embedding simple
        histogram = cv2.calcHist([face_region], [0], None, [256], [0, 256])
        embedding = histogram.flatten().tobytes().hex()[:50]  # Primeros 50 caracteres
        
        return embedding
    except Exception as e:
        return None

def recognize_face(image_path, threshold=0.6):
    """Reconoce un rostro comparándolo con los registrados"""
    try:
        current_embedding = extract_face_embedding(image_path)
        if current_embedding is None:
            return {
                "found": False,
                "message": "No se detectó rostro",
                "confidence": 0
            }
        
        # Buscar en embeddings guardados
        best_match = None
        best_similarity = 0
        
        for embedding_file in EMBEDDINGS_DIR.glob("*.json"):
            try:
                with open(embedding_file, 'r') as f:
                    stored_data = json.load(f)
                
                stored_embedding = stored_data["embedding"]
                # Similitud simple: comparar primeros caracteres
                similarity = 0.95 if stored_embedding == current_embedding else 0.3
                
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_match = stored_data
            except:
                continue
        
        if best_similarity >= threshold and best_match:
            return {
                "found": True,
                "employee_id": best_match["employee_id"],
                "name": best_match["name"],
                "confidence": best_similarity,
                "message": f"Reconocido: {best_match['name']}"
            }
        else:
            return {
                "found": False,
                "message": "Rostro no reconocido",
                "confidence": best_similarity
            }
    except Exception as e:
        return {
            "found": False,
            "message": f"Error: {str(e)}",
            "confidence": 0
        }

def register_face(image_path, employee_id, name):
    """Registra un nuevo empleado con su rostro"""
    try:
        embedding = extract_face_embedding(image_path)
        
        if embedding is None:
            return {
                "success": False,
                "message": "No se pudo extraer rostro"
            }
        
        # Guardar en JSON
        embedding_file = EMBEDDINGS_DIR / f"{employee_id}_{name}.json"
        with open(embedding_file, 'w') as f:
            json.dump({
                "employee_id": employee_id,
                "name": name,
                "embedding": embedding,
                "image_path": image_path
            }, f)
        
        return {
            "success": True,
            "message": f"Empleado {name} registrado",
            "employee_id": employee_id
        }
    except Exception as e:
        return {
            "success": False,
            "message": f"Error: {str(e)}"
        }

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({"error": "Uso: python script.py <command> <image_path> [params]"}))
        sys.exit(1)
    
    command = sys.argv[1]
    
    if command == "extract":
        # Comando: extract <image_path>
        image_path = sys.argv[2] if len(sys.argv) > 2 else None
        if not image_path:
            print(json.dumps({"error": "image_path requerido"}))
            sys.exit(1)
        
        embedding = extract_face_embedding(image_path)
        if embedding:
            print(embedding)  # Retorna solo el embedding en bytes
        else:
            print("ERROR: No se detectó rostro")
            sys.exit(1)
    
    elif command == "recognize":
        # Comando: recognize <image_path> [threshold]
        image_path = sys.argv[2] if len(sys.argv) > 2 else None
        threshold = float(sys.argv[3]) if len(sys.argv) > 3 else 0.6
        
        if not image_path:
            print(json.dumps({"error": "image_path requerido"}))
            sys.exit(1)
        
        result = recognize_face(image_path, threshold)
        print(json.dumps(result))
    
    elif command == "register":
        # Comando: register <image_path> <employee_id> <name>
        image_path = sys.argv[2] if len(sys.argv) > 2 else None
        employee_id = sys.argv[3] if len(sys.argv) > 3 else None
        name = sys.argv[4] if len(sys.argv) > 4 else None
        
        if not all([image_path, employee_id, name]):
            print(json.dumps({"error": "image_path, employee_id y name requeridos"}))
            sys.exit(1)
        
        result = register_face(image_path, employee_id, name)
        print(json.dumps(result))
    
    else:
        print(json.dumps({"error": f"Comando desconocido: {command}"}))
        sys.exit(1)
