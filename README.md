# BMPI - Sistema de Asistencia con Reconocimiento Facial

Sistema para registrar automáticamente entradas y salidas de empleados mediante reconocimiento facial.

## Stack objetivo (versión actual)

- **Frontend:** Angular (app web).
- **Backend:** API/servicio de asistencia y reconocimiento facial.
- **IA:** extracción y comparación de vectores faciales.
- **Base de datos:** PostgreSQL.

> Nota: el frontend objetivo ya **no** contempla C# / Windows Forms.

## ¿Cómo funciona?

El sistema conecta tres componentes principales:

1. **Frontend Angular** (interfaz de operación y administración)
2. **Cámara + motor de reconocimiento facial** (captura, detección, extracción y comparación biométrica)
3. **PostgreSQL** (almacenamiento de empleados y asistencias)

## Flujo operativo completo

1. **Captura del empleado frente a cámara**
   - Se toma imagen/video en tiempo real.

2. **Detección de rostro**
   - El sistema verifica si hay una cara visible.
   - En esta fase no se guarda ningún registro de asistencia.

3. **Extracción biométrica**
   - El rostro se convierte en un **vector biométrico** (embedding facial).
   - Este vector es la representación matemática del rostro.

4. **Comparación contra empleados registrados**
   - Se compara el vector capturado contra vectores almacenados.
   - Resultado:
     - ✅ Coincide: empleado identificado.
     - ❌ No coincide: persona no registrada.

5. **Registro automático de asistencia**
   - Si hay coincidencia, se guarda en PostgreSQL:
     - ID de empleado
     - fecha
     - hora exacta
     - tipo de marca (entrada/salida según reglas de horario)

6. **Control de duplicados**
   - Se aplica una ventana de tiempo para evitar múltiples marcas consecutivas del mismo empleado.

## Alta inicial de empleados

Antes de operar en automático, cada empleado debe registrarse:

1. Captura de múltiples imágenes del rostro.
2. Generación del vector facial.
3. Guardado del vector junto con datos administrativos:
   - nombre
   - número de empleado
   - área/departamento
   - estatus (activo/inactivo)

## Modelo de datos (PostgreSQL)

### Empleados
- Datos personales y administrativos.
- Vector biométrico facial.

### Asistencias
- Empleado identificado.
- Fecha.
- Hora.
- Tipo de marca (entrada/salida).

### Registros de sistema (opcional)
- Intentos fallidos.
- Rostros no reconocidos.

## Entorno de ejecución actual

Actualmente el sistema está planteado para ejecutarse en una **PC local dentro de BMPI**:

- Frontend Angular para operación del sistema.
- Cámara conectada directamente al equipo.
- PostgreSQL en la misma máquina.
- Procesamiento y registro en entorno local.

La arquitectura permite migrar después a un servidor interno, cambiando configuración de conexión sin alterar el flujo principal.

## Resumen rápido

📷 La cámara detecta un rostro.

🧠 El sistema lo convierte en vector biométrico.

🔍 Se compara contra empleados registrados.

✅ Si coincide, se registra la asistencia automáticamente.

🗄️ Todo queda almacenado en PostgreSQL.

## Limpieza del repositorio

Se retiraron componentes legacy de C#/.NET (proyectos de prueba y artefactos compilados) para mantener el repositorio enfocado en la arquitectura actual:

- Frontend Angular
- Backend Go
- IA en Python
- PostgreSQL


## Verificación rápida de IA y Backend

Puedes validar el estado técnico con:

```bash
scripts/verificar_ia_backend.sh
```

Este script comprueba:
- compilación y pruebas del backend Go,
- consistencia del contrato protobuf generado en Go,
- dependencias mínimas de IA en Python (`cv2`, `face_recognition`, `grpc`, `numpy`, `psycopg2`).

Para validar específicamente que no haya drift entre `proto`, `backend/pb` y `backend/vendor/.../pb`:

```bash
scripts/verificar_proto_sync.sh
```
