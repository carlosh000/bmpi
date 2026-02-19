package main

import (
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	pb "github.com/example/face-attendance/backend/pb"
	_ "github.com/lib/pq"
	"google.golang.org/grpc"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
)

const (
	roleOperator = "operator"
	roleAdmin    = "admin"
)

type attendanceRecord struct {
	ID        int64  `json:"id"`
	Name      string `json:"name"`
	Timestamp string `json:"timestamp"`
}

type attendanceStore struct {
	mu      sync.RWMutex
	nextID  int64
	records []attendanceRecord
}

type dbConfig struct {
	host     string
	name     string
	user     string
	password string
	sslmode  string
}

func isProduction() bool {
	return strings.EqualFold(strings.TrimSpace(os.Getenv("BMPI_ENV")), "production")
}

func boolFromEnv(name string) bool {
	raw := strings.TrimSpace(os.Getenv(name))
	return strings.EqualFold(raw, "1") ||
		strings.EqualFold(raw, "true") ||
		strings.EqualFold(raw, "yes")
}

func newAttendanceStore() *attendanceStore {
	return &attendanceStore{nextID: 1, records: []attendanceRecord{}}
}

func (s *attendanceStore) list() []attendanceRecord {
	s.mu.RLock()
	defer s.mu.RUnlock()

	cp := make([]attendanceRecord, len(s.records))
	copy(cp, s.records)
	return cp
}

func (s *attendanceStore) add(_ string, name string) attendanceRecord {
	s.mu.Lock()
	defer s.mu.Unlock()

	record := attendanceRecord{
		ID:        s.nextID,
		Name:      name,
		Timestamp: time.Now().Format(time.RFC3339),
	}
	s.nextID++
	s.records = append(s.records, record)
	return record
}

type server struct {
	pb.UnimplementedFaceRecognitionServiceServer
	faceClient pb.FaceRecognitionServiceClient
	store      *attendanceStore
}

func (s *server) RecognizeFace(ctx context.Context, req *pb.RecognizeFaceRequest) (*pb.RecognizeFaceResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.faceClient.RecognizeFace(ctx, req)
}

func (s *server) RegisterEmployee(ctx context.Context, req *pb.RegisterEmployeeRequest) (*pb.RegisterEmployeeResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.faceClient.RegisterEmployee(ctx, req)
}

func (s *server) LogAttendance(ctx context.Context, req *pb.AttendanceRequest) (*pb.AttendanceResponse, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	res, err := s.faceClient.LogAttendance(ctx, req)
	if err != nil {
		return nil, err
	}
	if res.GetSuccess() {
		s.store.add(req.GetEmployeeId(), req.GetEmployeeId())
	}
	return res, nil
}

func (s *server) ListEmployees(ctx context.Context, req *pb.Empty) (*pb.EmployeeList, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.faceClient.ListEmployees(ctx, req)
}

func startHTTPServer(grpcClient pb.FaceRecognitionServiceClient, store *attendanceStore, db *sql.DB) {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/attendance", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !requireRole(w, r, roleOperator) {
			return
		}

		switch r.Method {
		case http.MethodGet:
			requestedDate, err := parseRequestedAttendanceDate(r)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			if db != nil {
				records, err := listAttendanceFromDB(r.Context(), db, requestedDate)
				if err == nil {
					_ = json.NewEncoder(w).Encode(records)
					return
				}
			}
			_ = json.NewEncoder(w).Encode(filterAttendanceRecordsByDate(store.list(), requestedDate))
		case http.MethodPost:
			var payload struct {
				EmployeeID string `json:"employee_id"`
				Name       string `json:"name"`
				Timestamp  string `json:"timestamp"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}

			if payload.EmployeeID == "" {
				http.Error(w, "employee_id is required", http.StatusBadRequest)
				return
			}

			manualTimestamp, err := parseManualAttendanceTimestamp(payload.Timestamp)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()

			loggedAt := time.Now()
			if manualTimestamp != nil {
				if db == nil {
					http.Error(w, "manual timestamp requires database connection", http.StatusBadGateway)
					return
				}

				insertedAt, success, message, fallbackErr := logAttendanceInDB(r.Context(), db, payload.EmployeeID, manualTimestamp)
				if fallbackErr != nil {
					http.Error(w, "could not log attendance", http.StatusBadGateway)
					return
				}
				if !success {
					http.Error(w, message, http.StatusBadRequest)
					return
				}
				loggedAt = insertedAt
			} else {
				resp, grpcErr := grpcClient.LogAttendance(ctx, &pb.AttendanceRequest{EmployeeId: payload.EmployeeID})
				if grpcErr != nil {
					if db == nil {
						http.Error(w, "could not log attendance in gRPC service", http.StatusBadGateway)
						return
					}

					insertedAt, success, message, fallbackErr := logAttendanceInDB(r.Context(), db, payload.EmployeeID, nil)
					if fallbackErr != nil {
						http.Error(w, "could not log attendance", http.StatusBadGateway)
						return
					}
					if !success {
						http.Error(w, message, http.StatusBadRequest)
						return
					}
					loggedAt = insertedAt
				} else if !resp.GetSuccess() {
					http.Error(w, resp.GetMessage(), http.StatusBadRequest)
					return
				}
			}

			name := payload.Name
			if name == "" {
				name = "Empleado " + payload.EmployeeID
			}
			record := attendanceRecord{
				ID:        store.add(payload.EmployeeID, name).ID,
				Name:      name,
				Timestamp: loggedAt.Format(time.RFC3339),
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(record)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/embeddings/extract", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload struct {
			Files []struct {
				Name string `json:"name"`
				Data string `json:"data"`
			} `json:"files"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}

		results := make([]map[string]any, 0, len(payload.Files))
		errors := make([]string, 0)

		type extractJob struct {
			index int
			name  string
			data  string
		}
		type extractResult struct {
			index     int
			name      string
			embedding []float64
			err       error
		}

		workerCount := 4
		if len(payload.Files) < workerCount {
			workerCount = len(payload.Files)
		}
		if workerCount < 1 {
			workerCount = 1
		}

		jobs := make(chan extractJob)
		out := make(chan extractResult, len(payload.Files))

		var wg sync.WaitGroup
		for worker := 0; worker < workerCount; worker++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for job := range jobs {
					embedding, err := extractEmbedding(job.name, job.data)
					out <- extractResult{
						index:     job.index,
						name:      job.name,
						embedding: embedding,
						err:       err,
					}
				}
			}()
		}

		for index, file := range payload.Files {
			jobs <- extractJob{index: index, name: file.Name, data: file.Data}
		}
		close(jobs)

		go func() {
			wg.Wait()
			close(out)
		}()

		tmpResults := make([]*extractResult, len(payload.Files))
		for item := range out {
			itemCopy := item
			tmpResults[item.index] = &itemCopy
		}

		for _, item := range tmpResults {
			if item == nil {
				continue
			}
			if item.err != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", item.name, item.err))
				continue
			}

			results = append(results, map[string]any{
				"fileName":   item.name,
				"embedding":  item.embedding,
				"dimensions": len(item.embedding),
			})
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": results,
			"errors":  errors,
		})
	})

	mux.HandleFunc("/api/employees", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		employees, err := grpcClient.ListEmployees(ctx, &pb.Empty{})
		if err != nil {
			http.Error(w, "could not list employees in gRPC service", http.StatusBadGateway)
			return
		}

		data := make([]map[string]string, 0, len(employees.GetEmployees()))
		for _, employee := range employees.GetEmployees() {
			data = append(data, map[string]string{
				"employee_id": employee.GetEmployeeId(),
				"name":        employee.GetName(),
			})
		}

		_ = json.NewEncoder(w).Encode(data)
	})

	mux.HandleFunc("/api/employees/storage", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodGet {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}
		if !requireRole(w, r, roleOperator) {
			return
		}

		includePhoto := strings.EqualFold(strings.TrimSpace(r.URL.Query().Get("include_photo")), "true")
		if includePhoto && !requireRole(w, r, roleAdmin) {
			return
		}

		if db == nil {
			_ = json.NewEncoder(w).Encode([]map[string]any{})
			return
		}

		data, err := listEmployeeStorage(r.Context(), db, includePhoto)
		if err != nil {
			http.Error(w, "could not read employee storage", http.StatusBadGateway)
			return
		}

		_ = json.NewEncoder(w).Encode(data)
	})

	mux.HandleFunc("/api/employees/register-photos", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !requireRole(w, r, roleOperator) {
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
			return
		}

		var payload struct {
			EmployeeName string `json:"employeeName"`
			EmployeeID   string `json:"employeeId"`
			Files        []struct {
				Name string `json:"name"`
				Data string `json:"data"`
			} `json:"files"`
		}

		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "invalid JSON payload", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(payload.EmployeeName) == "" {
			http.Error(w, "employeeName is required", http.StatusBadRequest)
			return
		}
		payload.EmployeeID = strings.TrimSpace(payload.EmployeeID)
		if payload.EmployeeID == "" {
			http.Error(w, "employeeId is required", http.StatusBadRequest)
			return
		}
		if len(payload.Files) == 0 {
			http.Error(w, "files are required", http.StatusBadRequest)
			return
		}
		if len(payload.Files) < 5 || len(payload.Files) > 10 {
			http.Error(w, "for precision, files must be between 5 and 10", http.StatusBadRequest)
			return
		}

		saved := make([]map[string]any, 0, 1)
		errors := make([]string, 0)
		processedCount := 0

		for _, file := range payload.Files {
			imageData, err := decodeBase64Image(file.Data)
			if err != nil {
				errors = append(errors, fmt.Sprintf("%s: invalid image payload", file.Name))
				continue
			}

			ctx, cancel := context.WithTimeout(r.Context(), 10*time.Second)
			resp, err := grpcClient.RegisterEmployee(ctx, &pb.RegisterEmployeeRequest{
				Name:       payload.EmployeeName,
				EmployeeId: payload.EmployeeID,
				Image:      imageData,
			})
			cancel()

			if err != nil {
				errors = append(errors, fmt.Sprintf("%s: grpc error registering employee %s", file.Name, payload.EmployeeID))
				continue
			}
			if !resp.GetSuccess() {
				errors = append(errors, fmt.Sprintf("%s: %s", file.Name, resp.GetMessage()))
				continue
			}
			processedCount++
		}

		if processedCount > 0 {
			saved = append(saved, map[string]any{
				"employeeId":      payload.EmployeeID,
				"employeeName":    payload.EmployeeName,
				"photosProcessed": processedCount,
				"failedPhotos":    len(payload.Files) - processedCount,
			})
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"saved":  saved,
			"errors": errors,
		})
	})

	httpAddr := strings.TrimSpace(os.Getenv("BMPI_HTTP_ADDR"))
	if httpAddr == "" {
		httpAddr = ":8080"
	}

	log.Printf("REST bridge running on %s", httpAddr)
	if err := http.ListenAndServe(httpAddr, mux); err != nil {
		log.Fatal(err)
	}
}

func requireRole(w http.ResponseWriter, r *http.Request, role string) bool {
	operatorKey := strings.TrimSpace(os.Getenv("BMPI_OPERATOR_API_KEY"))
	adminKey := strings.TrimSpace(os.Getenv("BMPI_ADMIN_API_KEY"))

	if isProduction() {
		if operatorKey == "" {
			http.Error(w, "server misconfigured: BMPI_OPERATOR_API_KEY is required in production", http.StatusInternalServerError)
			return false
		}
		if role == roleAdmin && adminKey == "" {
			http.Error(w, "server misconfigured: BMPI_ADMIN_API_KEY is required for admin endpoints", http.StatusInternalServerError)
			return false
		}
	}

	if operatorKey == "" && adminKey == "" && !isProduction() {
		return true
	}

	requestKey := strings.TrimSpace(r.Header.Get("X-API-Key"))
	if requestKey == "" {
		http.Error(w, "missing API key", http.StatusUnauthorized)
		return false
	}

	if role == roleAdmin {
		if adminKey == "" || requestKey != adminKey {
			http.Error(w, "forbidden: admin key required", http.StatusForbidden)
			return false
		}
		return true
	}

	if adminKey != "" && requestKey == adminKey {
		return true
	}
	if operatorKey != "" && requestKey == operatorKey {
		return true
	}

	http.Error(w, "forbidden", http.StatusForbidden)
	return false
}

func resolveAllowedOrigins() map[string]struct{} {
	value := strings.TrimSpace(os.Getenv("BMPI_ALLOWED_ORIGINS"))
	if value == "" && !isProduction() {
		value = "http://localhost:4200,http://127.0.0.1:4200,http://localhost:4000"
	}

	allowed := map[string]struct{}{}
	for _, item := range strings.Split(value, ",") {
		origin := strings.TrimSpace(item)
		if origin == "" {
			continue
		}
		allowed[origin] = struct{}{}
	}
	return allowed
}

func setJSONHeaders(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin != "" {
		if _, ok := resolveAllowedOrigins()[origin]; ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
		}
	}

	w.Header().Set("Access-Control-Allow-Headers", "Content-Type, X-API-Key")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
}

func extractEmbedding(fileName string, base64Data string) ([]float64, error) {
	imageData, err := decodeBase64Image(base64Data)
	if err != nil {
		return nil, err
	}

	tmpFile, err := os.CreateTemp("", "bmpi-embedding-*")
	if err != nil {
		return nil, fmt.Errorf("temp file: %w", err)
	}
	defer os.Remove(tmpFile.Name())

	if _, err := tmpFile.Write(imageData); err != nil {
		_ = tmpFile.Close()
		return nil, fmt.Errorf("write image: %w", err)
	}
	if err := tmpFile.Close(); err != nil {
		return nil, fmt.Errorf("close image file: %w", err)
	}

	pythonBin, err := resolvePythonBinary()
	if err != nil {
		return nil, err
	}

	scriptPath, err := resolveEmbeddingScriptPath()
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	cmd := exec.CommandContext(ctx, pythonBin, scriptPath, "extract", tmpFile.Name())
	cmd.Env = append(os.Environ(), "PYTHONWARNINGS=ignore")
	out, err := cmd.CombinedOutput()
	if err != nil {
		return nil, fmt.Errorf("python extract failed for %s: %v (%s)", fileName, err, strings.TrimSpace(string(out)))
	}

	var response struct {
		Success   bool      `json:"success"`
		Embedding []float64 `json:"embedding"`
		Error     string    `json:"error"`
	}

	raw := strings.TrimSpace(string(out))
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start >= 0 && end > start {
		raw = raw[start : end+1]
	}

	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return nil, fmt.Errorf("invalid python response for %s: %w", fileName, err)
	}
	if !response.Success || len(response.Embedding) == 0 {
		message := response.Error
		if message == "" {
			message = "no face embedding returned"
		}
		return nil, fmt.Errorf(message)
	}

	return response.Embedding, nil
}

func decodeBase64Image(data string) ([]byte, error) {
	trimmed := strings.TrimSpace(data)
	if trimmed == "" {
		return nil, fmt.Errorf("empty image data")
	}
	if comma := strings.Index(trimmed, ","); comma >= 0 {
		trimmed = trimmed[comma+1:]
	}

	decoded, err := base64.StdEncoding.DecodeString(trimmed)
	if err == nil {
		return decoded, nil
	}

	decoded, err = base64.RawStdEncoding.DecodeString(trimmed)
	if err == nil {
		return decoded, nil
	}

	decoded, err = base64.URLEncoding.DecodeString(trimmed)
	if err == nil {
		return decoded, nil
	}

	return nil, fmt.Errorf("invalid base64 image data")
}

func parseRequestedAttendanceDate(r *http.Request) (*time.Time, error) {
	rawDate := strings.TrimSpace(r.URL.Query().Get("date"))
	if rawDate == "" {
		return nil, nil
	}

	parsed, err := time.Parse("2006-01-02", rawDate)
	if err != nil {
		return nil, fmt.Errorf("invalid date format, expected YYYY-MM-DD")
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if parsed.After(today) {
		return nil, fmt.Errorf("date cannot be in the future")
	}

	return &parsed, nil
}

func filterAttendanceRecordsByDate(records []attendanceRecord, requestedDate *time.Time) []attendanceRecord {
	if requestedDate == nil {
		return records
	}

	filtered := make([]attendanceRecord, 0)
	for _, rec := range records {
		parsed, err := time.Parse(time.RFC3339, rec.Timestamp)
		if err != nil {
			continue
		}

		if parsed.Year() == requestedDate.Year() && parsed.Month() == requestedDate.Month() && parsed.Day() == requestedDate.Day() {
			filtered = append(filtered, rec)
		}
	}

	return filtered
}

func resolveEmbeddingScriptPath() (string, error) {
	if fromEnv := strings.TrimSpace(os.Getenv("BMPI_EMBEDDING_SCRIPT")); fromEnv != "" {
		if _, err := os.Stat(fromEnv); err == nil {
			return fromEnv, nil
		}
		return "", fmt.Errorf("BMPI_EMBEDDING_SCRIPT not found: %s", fromEnv)
	}

	cwd, _ := os.Getwd()
	candidates := []string{
		filepath.Join(cwd, "ml-model", "face_server.py"),
		filepath.Join(cwd, "..", "ml-model", "face_server.py"),
		filepath.Join("..", "ml-model", "face_server.py"),
	}

	for _, candidate := range candidates {
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("embedding script not found (face_server.py); set BMPI_EMBEDDING_SCRIPT")
}

func resolvePythonBinary() (string, error) {
	if fromEnv := strings.TrimSpace(os.Getenv("BMPI_PYTHON_BIN")); fromEnv != "" {
		if _, err := os.Stat(fromEnv); err == nil {
			return fromEnv, nil
		}
		return "", fmt.Errorf("BMPI_PYTHON_BIN not found: %s", fromEnv)
	}

	userProfile := strings.TrimSpace(os.Getenv("USERPROFILE"))
	candidates := []string{
		filepath.Join(userProfile, "AppData", "Local", "Programs", "Python", "Python310", "python.exe"),
		filepath.Join(userProfile, "AppData", "Local", "Programs", "Python", "Python311", "python.exe"),
		`C:\\Python310\\python.exe`,
		`C:\\Python311\\python.exe`,
		"python",
	}

	for _, candidate := range candidates {
		if candidate == "python" {
			if _, err := exec.LookPath(candidate); err == nil {
				return candidate, nil
			}
			continue
		}
		if _, err := os.Stat(candidate); err == nil {
			return candidate, nil
		}
	}

	return "", fmt.Errorf("python executable not found; set BMPI_PYTHON_BIN")
}

func listAttendanceFromDB(ctx context.Context, db *sql.DB, requestedDate *time.Time) ([]attendanceRecord, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	query := `
		SELECT a.id, COALESCE(e.name, 'Empleado ' || a.employee_id) AS name, a.timestamp
		FROM attendance a
		LEFT JOIN employees e ON e.employee_id = a.employee_id
	`

	args := []any{}
	if requestedDate != nil {
		query += ` WHERE DATE(a.timestamp) = $1`
		args = append(args, requestedDate.Format("2006-01-02"))
	}

	query += ` ORDER BY a.id DESC`

	rows, err := db.QueryContext(queryCtx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	records := make([]attendanceRecord, 0)
	for rows.Next() {
		var rec attendanceRecord
		var ts time.Time
		if err := rows.Scan(&rec.ID, &rec.Name, &ts); err != nil {
			return nil, err
		}
		rec.Timestamp = ts.Format(time.RFC3339)
		records = append(records, rec)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return records, nil
}

func parseManualAttendanceTimestamp(raw string) (*time.Time, error) {
	value := strings.TrimSpace(raw)
	if value == "" {
		return nil, nil
	}

	parsed, err := time.Parse(time.RFC3339, value)
	if err != nil {
		parsedLocal, localErr := time.ParseInLocation("2006-01-02T15:04", value, time.Local)
		if localErr != nil {
			return nil, fmt.Errorf("invalid timestamp format; use ISO or YYYY-MM-DDTHH:MM")
		}
		parsed = parsedLocal
	}

	if parsed.After(time.Now().Add(1 * time.Minute)) {
		return nil, fmt.Errorf("timestamp cannot be in the future")
	}

	return &parsed, nil
}

func logAttendanceInDB(ctx context.Context, db *sql.DB, employeeID string, attendanceAt *time.Time) (time.Time, bool, string, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var lastTimestamp time.Time
	err := db.QueryRowContext(
		queryCtx,
		`SELECT timestamp FROM attendance WHERE employee_id = $1 ORDER BY timestamp DESC LIMIT 1`,
		employeeID,
	).Scan(&lastTimestamp)
	if err != nil && err != sql.ErrNoRows {
		return time.Time{}, false, "", err
	}

	if err == nil {
		baseTime := time.Now()
		if attendanceAt != nil {
			baseTime = *attendanceAt
		}

		if baseTime.After(lastTimestamp) && baseTime.Sub(lastTimestamp) < 5*time.Minute {
			return time.Time{}, false, "Duplicate prevented", nil
		}
	}

	insertedAt := time.Now()
	if attendanceAt != nil {
		insertedAt = *attendanceAt
	}

	if attendanceAt != nil {
		_, err = db.ExecContext(
			queryCtx,
			`INSERT INTO attendance (employee_id, timestamp) VALUES ($1, $2)`,
			employeeID,
			insertedAt,
		)
	} else {
		_, err = db.ExecContext(
			queryCtx,
			`INSERT INTO attendance (employee_id, timestamp) VALUES ($1, NOW())`,
			employeeID,
		)
	}

	if err != nil {
		return time.Time{}, false, "", err
	}

	return insertedAt, true, "Attendance logged", nil
}

func resolveDBConfig() (dbConfig, error) {
	cfg := dbConfig{
		host: strings.TrimSpace(os.Getenv("DB_HOST")),
		name: strings.TrimSpace(os.Getenv("DB_NAME")),
		user: strings.TrimSpace(os.Getenv("DB_USER")),
	}
	if cfg.host == "" {
		cfg.host = "localhost"
	}
	if cfg.name == "" {
		cfg.name = "bmpi"
	}
	if cfg.user == "" {
		cfg.user = "postgres"
	}

	cfg.password = strings.TrimSpace(os.Getenv("DB_PASSWORD"))
	if cfg.password == "" && isProduction() {
		return dbConfig{}, fmt.Errorf("DB_PASSWORD is required in production")
	}

	cfg.sslmode = strings.TrimSpace(os.Getenv("DB_SSLMODE"))
	if cfg.sslmode == "" {
		if isProduction() {
			cfg.sslmode = "require"
		} else {
			cfg.sslmode = "disable"
		}
	}

	return cfg, nil
}

func openPostgres() *sql.DB {
	cfg, err := resolveDBConfig()
	if err != nil {
		log.Printf("PostgreSQL configuration error: %v", err)
		return nil
	}

	dsn := fmt.Sprintf(
		"host=%s user=%s password=%s dbname=%s sslmode=%s",
		cfg.host,
		cfg.user,
		cfg.password,
		cfg.name,
		cfg.sslmode,
	)

	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Printf("PostgreSQL unavailable for attendance listing: %v", err)
		return nil
	}

	pingCtx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		log.Printf("PostgreSQL ping failed, using in-memory fallback: %v", err)
		_ = db.Close()
		return nil
	}

	return db
}

func listEmployeeStorage(ctx context.Context, db *sql.DB, includePhoto bool) ([]map[string]any, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var (
		rows *sql.Rows
		err  error
	)
	if includePhoto {
		rows, err = db.QueryContext(queryCtx, `
			SELECT employee_id, name, embedding, photo
			FROM employees
			ORDER BY id DESC
		`)
	} else {
		rows, err = db.QueryContext(queryCtx, `
			SELECT employee_id, name, embedding
			FROM employees
			ORDER BY id DESC
		`)
	}
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	result := make([]map[string]any, 0)
	for rows.Next() {
		var employeeID, name string
		var embedding []byte

		item := map[string]any{}
		if includePhoto {
			var photo []byte
			if err := rows.Scan(&employeeID, &name, &embedding, &photo); err != nil {
				return nil, err
			}

			item = map[string]any{
				"photo_bytes": len(photo),
			}
			if len(photo) > 0 {
				item["photo_data_url"] = "data:image/jpeg;base64," + base64.StdEncoding.EncodeToString(photo)
			}
		} else {
			if err := rows.Scan(&employeeID, &name, &embedding); err != nil {
				return nil, err
			}
			item["photo_bytes"] = 0
		}

		item["employee_id"] = employeeID
		item["name"] = name
		item["embedding_bytes"] = len(embedding)

		result = append(result, item)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return result, nil
}

func resolveFaceGRPCAddr() string {
	addr := strings.TrimSpace(os.Getenv("BMPI_FACE_GRPC_ADDR"))
	if addr == "" {
		addr = "localhost:50051"
	}
	return addr
}

func resolveFaceGRPCDialOptions() ([]grpc.DialOption, error) {
	if boolFromEnv("BMPI_FACE_GRPC_TLS") {
		caCert := strings.TrimSpace(os.Getenv("BMPI_FACE_GRPC_CA_CERT"))
		if caCert == "" {
			return nil, fmt.Errorf("BMPI_FACE_GRPC_CA_CERT is required when BMPI_FACE_GRPC_TLS=true")
		}

		creds, err := credentials.NewClientTLSFromFile(caCert, "")
		if err != nil {
			return nil, fmt.Errorf("invalid BMPI_FACE_GRPC_CA_CERT: %w", err)
		}
		return []grpc.DialOption{grpc.WithTransportCredentials(creds)}, nil
	}

	return []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials())}, nil
}

func main() {
	dialOptions, err := resolveFaceGRPCDialOptions()
	if err != nil {
		log.Fatal(err)
	}

	conn, err := grpc.Dial(resolveFaceGRPCAddr(), dialOptions...)
	if err != nil {
		log.Fatal("Failed to connect to face service:", err)
	}
	defer conn.Close()

	faceClient := pb.NewFaceRecognitionServiceClient(conn)
	store := newAttendanceStore()
	db := openPostgres()
	if db != nil {
		defer db.Close()
	}

	go startHTTPServer(faceClient, store, db)

	lis, err := net.Listen("tcp", ":50052")
	if err != nil {
		log.Fatal(err)
	}

	grpcServer := grpc.NewServer()
	pb.RegisterFaceRecognitionServiceServer(grpcServer, &server{
		faceClient: faceClient,
		store:      store,
	})

	log.Println("Main Go Server running on :50052")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal(err)
	}
}
