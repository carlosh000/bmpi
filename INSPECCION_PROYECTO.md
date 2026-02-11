# 📊 INSPECCIÓN DEL PROYECTO BMPI (VERSIÓN ACTUAL)

## ✅ Enfoque vigente

Este documento resume el estado esperado del sistema con la arquitectura actualizada:

- **Frontend web en Angular** (sin C# / Windows Forms).
- **Backend de servicios** para reconocimiento y registro de asistencia.
- **Módulo de IA** para embeddings faciales y comparación.
- **PostgreSQL** como almacenamiento principal.

---

## 🧱 Componentes

### 1) Frontend (Angular)
- Interfaz para operación de asistencia.
- Pantallas de alta/consulta de empleados y asistencias.
- Comunicación con backend vía API.

### 2) Backend
- Expone endpoints/servicios para:
  - alta de empleados,
  - reconocimiento facial,
  - registro de entrada/salida,
  - consulta de historial.
- Aplica reglas de negocio para evitar duplicados seguidos.

### 3) IA de reconocimiento facial
- Detección de rostro.
- Extracción de vector biométrico (embedding).
- Comparación contra vectores registrados.

### 4) Base de datos (PostgreSQL)
- Empleados:
  - datos administrativos,
  - vector biométrico,
  - estatus.
- Asistencias:
  - empleado,
  - fecha/hora,
  - tipo (entrada/salida).
- Bitácora opcional:
  - intentos fallidos,
  - rostros no reconocidos.

---

## 🔁 Flujo funcional esperado

1. Captura de imagen desde cámara.
2. Detección de rostro válido.
3. Generación de embedding facial.
4. Comparación con base de empleados.
5. Registro automático de asistencia si hay coincidencia.
6. Aplicación de ventana anti-duplicado.

---

## 🖥️ Entorno actual

- Ejecución local en infraestructura BMPI.
- Cámara conectada al equipo operativo.
- PostgreSQL local (con opción de migrar a servidor interno).

---

## 🧭 Nota de actualización

La documentación anterior que describía frontend en C# quedó obsoleta.
La dirección oficial del proyecto es **frontend Angular**.
