# 🎯 Face Attendance System

Sistema de reconocimiento facial para control de asistencia de empleados. Arquitectura de 3 capas: C# (Frontend), Go (Backend gRPC), Python (IA).

## 📁 Estructura del Proyecto

```
ProyectoCSharp/
├── frontend/                 # C# Windows Forms UI
│   ├── FaceAttendance.csproj
│   ├── MainForm.cs          # Interfaz principal
│   ├── Program.cs           # Entry point
│   ├── FaceRecognitionClient.cs
│   ├── FaceRecognitionMessages.cs  # Tipos Protobuf
│   └── bin/Debug/net8.0-windows/FaceAttendance.exe
│
├── backend/                  # Go gRPC Server
│   ├── main.go              # Servidor principal
│   ├── pb_wrapper.go        # Definiciones de tipos
│   ├── go.mod
│   ├── go.sum
│   └── face-attendance.exe  # Ejecutable compilado
│
├── ml-model/                # Python IA
│   ├── face_recognition_service.py
│   ├── requirements.txt
│   └── models/
│
└── README.md (este archivo)
```

## 🚀 Cómo Ejecutar

### 1. Iniciar el Servidor Go (Backend)

```bash
cd backend
.\face-attendance.exe
```

El servidor escuchará en: `http://localhost:50051`

### 2. Iniciar la Aplicación C# (Frontend)

```bash
cd frontend
dotnet run
# O ejecutar directamente:
.\bin\Debug\net8.0-windows\FaceAttendance.exe
```

### 3. Configurar Python (Opcional - IA)

```bash
cd ml-model
pip install -r requirements.txt
```

## 🔧 Componentes

### Frontend (C#)
- **Framework**: .NET 8.0 Windows Forms
- **Cliente gRPC**: `Grpc.Net.Client`
- **Dependencias**: 
  - Google.Protobuf v3.25.1
  - Npgsql (PostgreSQL driver)
  - OpenCvSharp4 (procesamiento de imágenes)

**Estado**: ✅ Compilado sin errores

### Backend (Go)
- **gRPC Server**: `google.golang.org/grpc`
- **Base de Datos**: PostgreSQL con `github.com/lib/pq`
- **Puerto**: 50051

**Estado**: ✅ Compilado correctamente

### Servicios gRPC Disponibles
- `RegisterEmployee` - Registrar empleado con foto
- `RecognizeFace` - Reconocer rostro en imagen
- `LogAttendance` - Registrar asistencia
- `ListEmployees` - Listar todos los empleados

### Python (IA)
- **Librería**: face_recognition (dlib-based)
- **Función**: Extraer embeddings faciales y comparar rostros
- **Entrada**: Imagen (JPEG/PNG)
- **Salida**: JSON con resultado de reconocimiento

**Estado**: ⏳ Implementación en progreso

## 💾 Base de Datos (PostgreSQL)

### Tablas

```sql
-- Empleados
CREATE TABLE employees (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    face_embedding BYTEA NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Asistencia
CREATE TABLE attendance (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER REFERENCES employees(id),
    check_in TIMESTAMP,
    check_out TIMESTAMP,
    location VARCHAR(100),
    date DATE DEFAULT CURRENT_DATE
);
```

### Configuración Conexión
```
Host: localhost
Port: 5432
User: postgres
Password: password
Database: face_attendance
```

## 📊 Flujo de Ejecución

1. **C# Frontend** captura imagen de cámara
2. **C# Frontend** envía a **Go Backend** vía gRPC
3. **Go Backend** llama a **Python** para procesamiento
4. **Python** extrae embedding facial y compara
5. **Go Backend** registra resultado en **PostgreSQL**
6. **Go Backend** retorna resultado al **C# Frontend**
7. **C# Frontend** muestra resultado y registra asistencia

## 🔐 Seguridad

⚠️ **DESARROLLO ONLY** - No usar en producción:
- Credenciales PostgreSQL hardcodeadas
- SSL deshabilitado
- Sin autenticación gRPC

Para producción:
- Usar variables de entorno para credenciales
- Habilitar SSL/TLS
- Implementar autenticación
- Usar secrets management

## 📝 Notas Técnicas

- **Protobuf**: Versión simplificada sin generación completa de protoc
- **gRPC**: Servidor básico sin descriptor completo
- **Base de Datos**: Conexión sin pool de conexiones
- **Python**: Se ejecuta como subprocess desde Go

## 🐛 Troubleshooting

### El servidor Go se cierra inmediatamente
- Verificar que PostgreSQL esté corriendo (si se quiere BD)
- Verificar que el puerto 50051 no esté ocupado

### C# no conecta a Go
- Verificar que Go está escuchando en `localhost:50051`
- Verificar firewall

### Python no funciona
- Verificar que `python` está en PATH
- Instalar dependencias: `pip install -r requirements.txt`

## 🎯 Próximos Pasos

- [ ] Implementar generación completa de código Protobuf
- [ ] Agregar pool de conexiones PostgreSQL
- [ ] Implementar autenticación gRPC
- [ ] Agregar logging centralizado
- [ ] Implementar caché de embeddings
- [ ] Agregar UI mejorada con imágenes en tiempo real
- [ ] Dockerizar componentes

---

**Última actualización**: 23/01/2026
**Estado**: 🟡 En desarrollo - Backend básico funcionando
