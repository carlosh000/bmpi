package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"path/filepath"
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
	log.Println("[INIT] ✅ Inicialización completada")
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
	log.Println("🐍 Llamando a Python para extraer embedding...")
	
	// Guardar imagen temporalmente
	tmpFile := "face_temp.jpg"
	err := os.WriteFile(tmpFile, imageBytes, 0644)
	if err != nil {
		log.Printf("❌ Error escribiendo imagen temporal: %v", err)
		return nil, err
	}
	defer os.Remove(tmpFile)
	
	// Obtener ruta absoluta al script Python
	pythonScript, err := filepath.Abs("../ml-model/face_recognition_service.py")
	if err != nil {
		log.Printf("❌ Error obteniendo ruta script: %v", err)
		return nil, err
	}
	
	// Llamar script Python para extraer embedding
	cmd := exec.Command("python", pythonScript, "extract", tmpFile)
	output, err := cmd.Output()
	if err != nil {
		log.Printf("❌ Error ejecutando Python (extract): %v", err)
		return nil, err
	}
	
	log.Printf("✅ Embedding extraído: %d bytes", len(output))
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
	log.Printf("🐍 Llamando a Python para reconocer rostro (threshold: %.2f)...", threshold)
	
	// Guardar imagen temporalmente
	tmpFile := "face_input.jpg"
	err := os.WriteFile(tmpFile, imageBytes, 0644)
	if err != nil {
		log.Printf("❌ Error escribiendo imagen: %v", err)
		return nil, 0, err
	}
	defer os.Remove(tmpFile)
	
	// Obtener ruta absoluta al script Python
	pythonScript, err := filepath.Abs("../ml-model/face_recognition_service.py")
	if err != nil {
		log.Printf("❌ Error obteniendo ruta script: %v", err)
		return nil, 0, err
	}
	
	// Llamar script Python para reconocer
	cmd := exec.Command("python", pythonScript, "recognize", tmpFile)
	output, err := cmd.Output()
	if err != nil {
		log.Printf("❌ Error ejecutando Python (recognize): %v", err)
		return nil, 0, err
	}
	
	log.Printf("📝 Output Python: %s", string(output))
	
	// Parsear JSON del output
	var result RecognitionResult
	err = json.Unmarshal(output, &result)
	if err != nil {
		log.Printf("❌ Error parseando JSON: %v", err)
		return nil, 0, err
	}
	
	log.Printf("✅ Resultado: Found=%v, Employee=%s, Confidence=%.2f", result.Found, result.Name, result.Confidence)
	
	// Validar threshold
	if result.Found && result.Confidence >= threshold {
		log.Printf("✅ Confianza %.2f >= threshold %.2f - ACEPTADO", result.Confidence, threshold)
		return &pb.RecognizeFaceResponse{
			Found:      true,
			EmployeeId: result.EmployeeID,
			Name:       result.Name,
			Confidence: result.Confidence,
			Message:    fmt.Sprintf("Bienvenido, %s (%.1f%% confianza)", result.Name, result.Confidence*100),
		}, result.Confidence, nil
	}
	
	if result.Found && result.Confidence < threshold {
		log.Printf("⚠️  Confianza %.2f < threshold %.2f - RECHAZADO", result.Confidence, threshold)
		return &pb.RecognizeFaceResponse{
			Found:      false,
			Confidence: result.Confidence,
			Message:    fmt.Sprintf("Confianza insuficiente (%.1f%% < %.1f%%)", result.Confidence*100, threshold*100),
		}, result.Confidence, nil
	}
	
	log.Println("❌ No se detectó rostro")
	return &pb.RecognizeFaceResponse{
		Found:   false,
		Message: "No se detectó rostro en la imagen",
	}, 0, nil
}

func main() {
	log.Println("📋 Inicializando servidor Face Attendance...")
	
	// Crear listener en puerto 50051
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
