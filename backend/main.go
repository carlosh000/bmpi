package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"time"
	"github.com/example/face-attendance/backend/pb"
	_ "github.com/lib/pq"
	"google.golang.org/grpc"
)

// Servidor gRPC que implementa FaceRecognitionServiceServer
type faceRecognitionServer struct {
	pb.UnimplementedFaceRecognitionServiceServer
	db *sql.DB
}

// PostgreSQL connection
var db *sql.DB

func init() {
	   log.Println("[INIT] Iniciando...")
	   // Conectar a PostgreSQL
	   psqlInfo := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable",
		   "localhost", "5432", "postgres", "password", "face_attendance")
	   log.Printf("[INIT] Intentando conectar a: %s", psqlInfo)
	   var err error
	   db, err = sql.Open("postgres", psqlInfo)
	   if err != nil {
		   log.Printf("[INIT] ❌ Error conectando BD: %v", err)
		   // Continuamos sin BD para demo
	   } else {
		   log.Println("[INIT] ✅ Conectado a PostgreSQL")
		   // Crear tabla si no existe
		   createTables()
	   }
	   // log.Println("[INIT] ✅ Inicialización completada (sin BD)")
}

func createTables() {
	// Tabla de empleados
	sql1 := `
	CREATE TABLE IF NOT EXISTS employees (
		id SERIAL PRIMARY KEY,
		name VARCHAR(100) NOT NULL,
		email VARCHAR(100) UNIQUE NOT NULL,
		face_embedding BYTEA NOT NULL,
		created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
	);
	`
	
	// Tabla de asistencia
	sql2 := `
	CREATE TABLE IF NOT EXISTS attendance (
		id SERIAL PRIMARY KEY,
		employee_id INTEGER REFERENCES employees(id),
		check_in TIMESTAMP,
		check_out TIMESTAMP,
		location VARCHAR(100),
		date DATE DEFAULT CURRENT_DATE
	);
	`
	
	db.Exec(sql1)
	db.Exec(sql2)
	log.Println("✅ Tablas creadas/verificadas")
}

// RegisterEmployee - Registrar nuevo empleado
func (s *faceRecognitionServer) RegisterEmployee(ctx context.Context, req *pb.RegisterEmployeeRequest) (*pb.RegisterEmployeeResponse, error) {
	log.Printf("📝 Registrando empleado: %s", req.Name)
	
	// Llamar a Python para extraer embedding facial
	embedding, err := extractFaceEmbedding(req.FaceImage)
	if err != nil {
		return &pb.RegisterEmployeeResponse{
			Success:    false,
			Message:    fmt.Sprintf("Error extrayendo rostro: %v", err),
		}, nil
	}
	
	// Guardar en BD
	if s.db != nil {
		var id int32
		err := s.db.QueryRowContext(ctx,
			"INSERT INTO employees (name, email, face_embedding) VALUES ($1, $2, $3) RETURNING id",
			req.Name, req.Email, embedding).Scan(&id)
		
		if err != nil {
			return &pb.RegisterEmployeeResponse{
				Success: false,
				Message: fmt.Sprintf("Error guardando: %v", err),
			}, nil
		}
		
		return &pb.RegisterEmployeeResponse{
			Success:    true,
			Message:    "Empleado registrado exitosamente",
			EmployeeId: id,
		}, nil
	}
	
	return &pb.RegisterEmployeeResponse{
		Success:    true,
		Message:    "Empleado registrado (sin BD)",
		EmployeeId: req.EmployeeId,
	}, nil
}

// RecognizeFace - Reconocer rostro
func (s *faceRecognitionServer) RecognizeFace(ctx context.Context, req *pb.RecognizeFaceRequest) (*pb.RecognizeFaceResponse, error) {
	log.Println("🔍 Reconociendo rostro...")
	
	// Llamar a Python para comparar rostros
	result, confidence, err := recognizeFaceWithPython(req.Image, req.ConfidenceThreshold)
	if err != nil {
		return &pb.RecognizeFaceResponse{
			Found:   false,
			Message: fmt.Sprintf("Error: %v", err),
		}, nil
	}
	
	if result == nil {
		return &pb.RecognizeFaceResponse{
			Found:      false,
			Message:    "No se detectó rostro",
			Confidence: 0,
		}, nil
	}
	
	return &pb.RecognizeFaceResponse{
		Found:      true,
		EmployeeId: result.EmployeeId,
		Name:       result.Name,
		Confidence: confidence,
		Message:    fmt.Sprintf("Bienvenido, %s", result.Name),
	}, nil
}

// LogAttendance - Registrar asistencia
func (s *faceRecognitionServer) LogAttendance(ctx context.Context, req *pb.AttendanceRequest) (*pb.AttendanceResponse, error) {
	log.Printf("✅ Registrando asistencia para empleado %d", req.EmployeeId)
	
	if s.db == nil {
		return &pb.AttendanceResponse{
			Success: false,
			Message: "BD no disponible",
		}, nil
	}
	
	var id int64
	err := s.db.QueryRowContext(ctx,
		"INSERT INTO attendance (employee_id, check_in, location) VALUES ($1, NOW(), $2) RETURNING id",
		req.EmployeeId, req.Location).Scan(&id)
	
	if err != nil {
		return &pb.AttendanceResponse{
			Success: false,
			Message: fmt.Sprintf("Error: %v", err),
		}, nil
	}
	
	return &pb.AttendanceResponse{
		Success:      true,
		Message:      "Asistencia registrada",
		AttendanceId: id,
	}, nil
}

// ListEmployees - Listar empleados
func (s *faceRecognitionServer) ListEmployees(ctx context.Context, req *pb.Empty) (*pb.EmployeeList, error) {
	log.Println("=== 📋 ListEmployees RPC llamado ===")
	
	var employees []*pb.Employee
	
	if s.db == nil {
		log.Println("⚠️  Base de datos NULL")
		return &pb.EmployeeList{Employees: employees}, nil
	}
	
	log.Println("🔍 Consultando empleados en BD...")
	rows, err := s.db.QueryContext(ctx, "SELECT id, name, email FROM employees")
	if err != nil {
		log.Printf("❌ Error en query: %v", err)
		return &pb.EmployeeList{Employees: employees}, nil
	}
	defer rows.Close()
	
	for rows.Next() {
		var id int32
		var name, email string
		rows.Scan(&id, &name, &email)
		employees = append(employees, &pb.Employee{
			Id:    id,
			Name:  name,
			Email: email,
		})
	}
	
	log.Printf("✅ Retornando %d empleados", len(employees))
	return &pb.EmployeeList{Employees: employees}, nil
}

// extractFaceEmbedding - Llama a Python para extraer embedding
func extractFaceEmbedding(imageBytes []byte) ([]byte, error) {
    log.Printf("{\"event\":\"extractFaceEmbedding\",\"step\":\"start\"}")
    // Validar imagen
    if len(imageBytes) == 0 {
        log.Printf("{\"event\":\"extractFaceEmbedding\",\"error\":\"imagen vacía\"}")
        return nil, fmt.Errorf("imagen vacía")
    }
    tmpFile := "face_temp.jpg"
    err := os.WriteFile(tmpFile, imageBytes, 0644)
    if err != nil {
        log.Printf("{\"event\":\"extractFaceEmbedding\",\"error\":\"escritura temporal\",\"detail\":%q}", err.Error())
        return nil, err
    }
    defer os.Remove(tmpFile)
    pythonScript, err := filepath.Abs("../ml-model/face_recognition_service.py")
    if err != nil {
        log.Printf("{\"event\":\"extractFaceEmbedding\",\"error\":\"ruta script\",\"detail\":%q}", err.Error())
        return nil, err
    }
    cmd := exec.Command("python", pythonScript, "extract", tmpFile)
    // Timeout de 20 segundos
    done := make(chan error, 1)
    var output []byte
    var stderr []byte
    go func() {
        output, err = cmd.Output()
        if err != nil {
            if exitErr, ok := err.(*exec.ExitError); ok {
                stderr = exitErr.Stderr
            }
        }
        done <- err
    }()
    select {
    case err := <-done:
        if err != nil {
            log.Printf("{\"event\":\"extractFaceEmbedding\",\"error\":\"python error\",\"detail\":%q,\"stderr\":%q}", err.Error(), string(stderr))
            return nil, fmt.Errorf("python error: %v, stderr: %s", err, string(stderr))
        }
    case <-time.After(20 * time.Second):
        cmd.Process.Kill()
        log.Printf("{\"event\":\"extractFaceEmbedding\",\"error\":\"timeout\"}")
        return nil, fmt.Errorf("timeout ejecutando python")
    }
    log.Printf("{\"event\":\"extractFaceEmbedding\",\"step\":\"success\",\"bytes\":%d}", len(output))
    return output, nil
}

// RecognitionResult - Estructura para parsear respuesta de Python
type RecognitionResult struct {
	Found      bool    `json:"found"`
	EmployeeID int32   `json:"employee_id"`
	Name       string  `json:"name"`
	Confidence float32 `json:"confidence"`
	Message    string  `json:"message"`
}

// recognizeFaceWithPython - Llama a Python para reconocer rostro
func recognizeFaceWithPython(imageBytes []byte, threshold float32) (*pb.RecognizeFaceResponse, float32, error) {
    log.Printf("{\"event\":\"recognizeFaceWithPython\",\"step\":\"start\",\"threshold\":%.2f}", threshold)
    if len(imageBytes) == 0 {
        log.Printf("{\"event\":\"recognizeFaceWithPython\",\"error\":\"imagen vacía\"}")
        return nil, 0, fmt.Errorf("imagen vacía")
    }
    tmpFile := "face_input.jpg"
    err := os.WriteFile(tmpFile, imageBytes, 0644)
    if err != nil {
        log.Printf("{\"event\":\"recognizeFaceWithPython\",\"error\":\"escritura temporal\",\"detail\":%q}", err.Error())
        return nil, 0, err
    }
    defer os.Remove(tmpFile)
    pythonScript, err := filepath.Abs("../ml-model/face_recognition_service.py")
    if err != nil {
        log.Printf("{\"event\":\"recognizeFaceWithPython\",\"error\":\"ruta script\",\"detail\":%q}", err.Error())
        return nil, 0, err
    }
    cmd := exec.Command("python", pythonScript, "recognize", tmpFile)
    // Timeout de 20 segundos
    done := make(chan error, 1)
    var output []byte
    var stderr []byte
    go func() {
        output, err = cmd.Output()
        if err != nil {
            if exitErr, ok := err.(*exec.ExitError); ok {
                stderr = exitErr.Stderr
            }
        }
        done <- err
    }()
    select {
    case err := <-done:
        if err != nil {
            log.Printf("{\"event\":\"recognizeFaceWithPython\",\"error\":\"python error\",\"detail\":%q,\"stderr\":%q}", err.Error(), string(stderr))
            return nil, 0, fmt.Errorf("python error: %v, stderr: %s", err, string(stderr))
        }
    case <-time.After(20 * time.Second):
        cmd.Process.Kill()
        log.Printf("{\"event\":\"recognizeFaceWithPython\",\"error\":\"timeout\"}")
        return nil, 0, fmt.Errorf("timeout ejecutando python")
    }
    log.Printf("{\"event\":\"recognizeFaceWithPython\",\"step\":\"output\",\"output\":%q}", string(output))
    var result RecognitionResult
    err = json.Unmarshal(output, &result)
    if err != nil {
        log.Printf("{\"event\":\"recognizeFaceWithPython\",\"error\":\"parse json\",\"detail\":%q}", err.Error())
        return nil, 0, err
    }
    log.Printf("{\"event\":\"recognizeFaceWithPython\",\"step\":\"resultado\",\"found\":%v,\"name\":%q,\"confidence\":%.2f}", result.Found, result.Name, result.Confidence)
    if result.Found && result.Confidence >= threshold {
        log.Printf("{\"event\":\"recognizeFaceWithPython\",\"step\":\"aceptado\",\"confidence\":%.2f,\"threshold\":%.2f}", result.Confidence, threshold)
        return &pb.RecognizeFaceResponse{
            Found:      true,
            EmployeeId: result.EmployeeID,
            Name:       result.Name,
            Confidence: result.Confidence,
            Message:    fmt.Sprintf("Bienvenido, %s (%.1f%% confianza)", result.Name, result.Confidence*100),
        }, result.Confidence, nil
    }
    if result.Found && result.Confidence < threshold {
        log.Printf("{\"event\":\"recognizeFaceWithPython\",\"step\":\"rechazado\",\"confidence\":%.2f,\"threshold\":%.2f}", result.Confidence, threshold)
        return &pb.RecognizeFaceResponse{
            Found:      false,
            Confidence: result.Confidence,
            Message:    fmt.Sprintf("Confianza insuficiente (%.1f%% < %.1f%%)", result.Confidence*100, threshold*100),
        }, result.Confidence, nil
    }
    log.Printf("{\"event\":\"recognizeFaceWithPython\",\"step\":\"no rostro\"}")
    return &pb.RecognizeFaceResponse{
        Found:   false,
        Message: "No se detectó rostro en la imagen",
    }, 0, nil
}

// AttendanceRecord para exponer datos en JSON
type AttendanceRecord struct {
	ID         int64  `json:"id"`
	EmployeeID int32  `json:"employee_id"`
	Name       string `json:"name"`
	Email      string `json:"email"`
	CheckIn    string `json:"check_in"`
	Location   string `json:"location"`
	Date       string `json:"date"`
}

func attendanceHandler(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	if db == nil {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`[{"id":0,"employee_id":0,"name":"SIN BD","email":"-","check_in":"-","location":"-","date":"-"}]`))
		return
	}
	query := `SELECT a.id, a.employee_id, e.name, e.email, a.check_in, a.location, a.date
			FROM attendance a
			JOIN employees e ON a.employee_id = e.id
			ORDER BY a.check_in DESC`
	rows, err := db.Query(query)
	if err != nil {
		w.WriteHeader(http.StatusInternalServerError)
		w.Write([]byte(`{"error": "Error en query"}`))
		return
	}
	defer rows.Close()
	var records []AttendanceRecord
	for rows.Next() {
		var rec AttendanceRecord
		var checkIn time.Time
		err := rows.Scan(&rec.ID, &rec.EmployeeID, &rec.Name, &rec.Email, &checkIn, &rec.Location, &rec.Date)
		if err != nil {
			continue
		}
		rec.CheckIn = checkIn.Format("2006-01-02 15:04:05")
		records = append(records, rec)
	}
	json.NewEncoder(w).Encode(records)
}

func main() {
	log.Println("📋 Inicializando servidor Face Attendance...")

	// Lanzar servidor HTTP REST en goroutine
	go func() {
		http.HandleFunc("/api/attendance", attendanceHandler)
		log.Println("🌐 Endpoint REST /api/attendance en puerto 8080")
		log.Fatal(http.ListenAndServe(":8080", nil))
	}()

	// Crear listener en puerto 50051 para gRPC
	lis, err := net.Listen("tcp", ":50051")
	if err != nil {
		log.Fatalf("❌ Error creando listener: %v", err)
	}
	log.Println("✅ Listener creado en puerto 50051")
	// Crear servidor gRPC
	s := grpc.NewServer()
	log.Println("✅ Servidor gRPC creado")
	// Registrar el servicio gRPC
	faceServer := &faceRecognitionServer{db: db}
	pb.RegisterFaceRecognitionServiceServer(s, faceServer)
	log.Println("✅ Servicio registrado")
	log.Println("🚀 Servidor gRPC escuchando en puerto 50051...")
	log.Println("   Direcciones:")
	log.Println("   - localhost:50051")
	log.Println("   - 127.0.0.1:50051")
	if err := s.Serve(lis); err != nil {
		log.Fatalf("❌ Error en servidor: %v", err)
	}
}
