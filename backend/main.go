package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	pb "github.com/example/face-attendance/backend/pb"
	_ "github.com/lib/pq"
	"google.golang.org/grpc"
)

type server struct {
	pb.UnimplementedFaceRecognitionServiceServer
	faceClient pb.FaceRecognitionServiceClient
}

type attendanceRecord struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Timestamp string `json:"timestamp"`
}

type embeddingRequestFile struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

type embeddingExtractRequest struct {
	Files []embeddingRequestFile `json:"files"`
}

type embeddingResult struct {
	FileName   string    `json:"fileName"`
	Embedding  []float64 `json:"embedding"`
	Dimensions int       `json:"dimensions"`
}

type embeddingExtractResponse struct {
	Results []embeddingResult `json:"results"`
	Errors  []string          `json:"errors"`
}

func (s *server) RecognizeFace(ctx context.Context, req *pb.RecognizeFaceRequest) (*pb.RecognizeFaceResponse, error) {
	return s.faceClient.RecognizeFace(ctx, req)
}

func (s *server) RegisterEmployee(ctx context.Context, req *pb.RegisterEmployeeRequest) (*pb.RegisterEmployeeResponse, error) {
	return s.faceClient.RegisterEmployee(ctx, req)
}

func (s *server) LogAttendance(ctx context.Context, req *pb.AttendanceRequest) (*pb.AttendanceResponse, error) {
	return s.faceClient.LogAttendance(ctx, req)
}

func (s *server) ListEmployees(ctx context.Context, req *pb.Empty) (*pb.EmployeeList, error) {
	return s.faceClient.ListEmployees(ctx, req)
}

func main() {
	conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
	if err != nil {
		log.Fatal(err)
	}
	defer conn.Close()

	faceClient := pb.NewFaceRecognitionServiceClient(conn)
	grpcSrv := &server{faceClient: faceClient}

	lis, err := net.Listen("tcp", ":50052")
	if err != nil {
		log.Fatal(err)
	}

	grpcServer := grpc.NewServer()
	pb.RegisterFaceRecognitionServiceServer(grpcServer, grpcSrv)

	go func() {
		log.Println(`{"component":"grpc","message":"BMPI Main Server running","port":50052}`)
		if err := grpcServer.Serve(lis); err != nil {
			log.Fatal(err)
		}
	}()

	httpMux := http.NewServeMux()
	httpMux.HandleFunc("/api/attendance", attendanceHandler)
	httpMux.HandleFunc("/api/embeddings/extract", extractEmbeddingsHandler)
	httpMux.HandleFunc("/health", healthHandler)

	httpServer := &http.Server{
		Addr:              ":8080",
		Handler:           withLogging(withCORS(httpMux)),
		ReadHeaderTimeout: 10 * time.Second,
	}

	log.Println(`{"component":"http","message":"BMPI HTTP API running","port":8080}`)
	if err := httpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
		log.Fatal(err)
	}
}

func attendanceHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	db, err := openDB()
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "database unavailable"})
		return
	}
	defer db.Close()

	query := `
		SELECT COALESCE(e.name, a.employee_id) AS name, a.timestamp
		FROM attendance a
		LEFT JOIN employees e ON e.employee_id::text = a.employee_id::text
		ORDER BY a.timestamp DESC
		LIMIT 200
	`

	rows, err := db.Query(query)
	if err != nil {
		writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to read attendance"})
		return
	}
	defer rows.Close()

	records := []attendanceRecord{}
	id := 1
	for rows.Next() {
		var name string
		var timestamp time.Time
		if err := rows.Scan(&name, &timestamp); err != nil {
			writeJSON(w, http.StatusInternalServerError, map[string]string{"error": "failed to parse attendance"})
			return
		}
		records = append(records, attendanceRecord{
			ID:        id,
			Name:      name,
			Timestamp: timestamp.Format(time.RFC3339),
		})
		id++
	}

	writeJSON(w, http.StatusOK, records)
}

func extractEmbeddingsHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodPost {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}

	var req embeddingExtractRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "invalid json payload"})
		return
	}

	if len(req.Files) == 0 {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "files are required"})
		return
	}

	resp := embeddingExtractResponse{Results: []embeddingResult{}, Errors: []string{}}
	for _, f := range req.Files {
		result, err := extractEmbeddingFromBase64(f)
		if err != nil {
			resp.Errors = append(resp.Errors, err.Error())
			continue
		}
		resp.Results = append(resp.Results, result)
	}

	status := http.StatusOK
	if len(resp.Results) == 0 {
		status = http.StatusBadRequest
	}
	writeJSON(w, status, resp)
}

func extractEmbeddingFromBase64(file embeddingRequestFile) (embeddingResult, error) {
	if file.Name == "" || file.Data == "" {
		return embeddingResult{}, fmt.Errorf("archivo inválido: nombre y data son requeridos")
	}

	parts := strings.SplitN(file.Data, ",", 2)
	encoded := file.Data
	if len(parts) == 2 {
		encoded = parts[1]
	}

	binary, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return embeddingResult{}, fmt.Errorf("%s: base64 inválido", file.Name)
	}

	tmpFile, err := writeTempImage(file.Name, binary)
	if err != nil {
		return embeddingResult{}, fmt.Errorf("%s: no se pudo escribir temporal", file.Name)
	}
	defer os.Remove(tmpFile)

	scriptPath := filepath.Join("..", "ml-model", "face_recognition_service.py")
	cmd := exec.Command("python3", scriptPath, "extract", tmpFile)
	output, err := cmd.CombinedOutput()
	if err != nil {
		return embeddingResult{}, fmt.Errorf("%s: error ejecutando extractor: %s", file.Name, strings.TrimSpace(string(output)))
	}

	var scriptResponse struct {
		Success   bool      `json:"success"`
		Embedding []float64 `json:"embedding"`
		Error     string    `json:"error"`
	}
	if err := json.Unmarshal(output, &scriptResponse); err != nil {
		return embeddingResult{}, fmt.Errorf("%s: respuesta inválida del extractor", file.Name)
	}
	if !scriptResponse.Success || len(scriptResponse.Embedding) == 0 {
		if scriptResponse.Error == "" {
			scriptResponse.Error = "no se detectó rostro"
		}
		return embeddingResult{}, fmt.Errorf("%s: %s", file.Name, scriptResponse.Error)
	}

	return embeddingResult{FileName: file.Name, Embedding: scriptResponse.Embedding, Dimensions: len(scriptResponse.Embedding)}, nil
}

func writeTempImage(name string, content []byte) (string, error) {
	tmp, err := os.CreateTemp("", "face-*."+sanitizeExtension(name))
	if err != nil {
		return "", err
	}
	defer tmp.Close()
	if _, err := io.Copy(tmp, bytes.NewReader(content)); err != nil {
		return "", err
	}
	return tmp.Name(), nil
}

func sanitizeExtension(name string) string {
	ext := strings.TrimPrefix(strings.ToLower(filepath.Ext(name)), ".")
	if ext == "" {
		return "jpg"
	}
	switch ext {
	case "jpg", "jpeg", "png", "bmp", "webp":
		return ext
	default:
		return "jpg"
	}
}

func healthHandler(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodOptions {
		w.WriteHeader(http.StatusNoContent)
		return
	}
	if r.Method != http.MethodGet {
		writeJSON(w, http.StatusMethodNotAllowed, map[string]string{"error": "method not allowed"})
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
}

func openDB() (*sql.DB, error) {
	host := envOrDefault("DB_HOST", "localhost")
	port := envOrDefault("DB_PORT", "5432")
	user := envOrDefault("DB_USER", "postgres")
	password := envOrDefault("DB_PASSWORD", "1234")
	database := envOrDefault("DB_NAME", "bmpi")

	dsn := fmt.Sprintf("host=%s port=%s user=%s password=%s dbname=%s sslmode=disable", host, port, user, password, database)
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		return nil, err
	}
	if err := db.Ping(); err != nil {
		return nil, err
	}
	return db, nil
}

func envOrDefault(key, fallback string) string {
	value := os.Getenv(key)
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(payload)
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
		next.ServeHTTP(w, r)
	})
}

func withLogging(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		log.Printf("{\"component\":\"http\",\"method\":\"%s\",\"path\":\"%s\",\"duration_ms\":%d}", r.Method, r.URL.Path, time.Since(start).Milliseconds())
	})
}
