package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"image"
	_ "image/gif"
	_ "image/jpeg"
	_ "image/png"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	pb "github.com/example/face-attendance/backend/pb"
	_ "github.com/lib/pq"
	"google.golang.org/grpc"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/credentials"
	"google.golang.org/grpc/credentials/insecure"
	"google.golang.org/grpc/status"
)

const (
	roleOperator = "operator"
	roleAdmin    = "admin"
)

type photoQualityMetrics struct {
	Width      int
	Height     int
	Brightness float64
	Detail     float64
}

type attendanceRecord struct {
	RowID     int64  `json:"row_id,omitempty"`
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

type embeddingInputFile struct {
	Name string `json:"name"`
	Data string `json:"data"`
}

type embeddingExtractItem struct {
	Name      string
	Embedding []float64
	Err       error
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

func (s *attendanceStore) add(employeeID string, name string) attendanceRecord {
	s.mu.Lock()
	defer s.mu.Unlock()

	recordID := s.nextID
	if parsedID, err := strconv.ParseInt(strings.TrimSpace(employeeID), 10, 64); err == nil && parsedID > 0 {
		recordID = parsedID
	}

	record := attendanceRecord{
		ID:        recordID,
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
				http.Error(w, "JSON inválido", http.StatusBadRequest)
				return
			}

			payload.EmployeeID = strings.TrimSpace(payload.EmployeeID)
			if payload.EmployeeID == "" {
				http.Error(w, "employee_id es obligatorio", http.StatusBadRequest)
				return
			}

			employeeIDNumber, parseErr := strconv.ParseInt(payload.EmployeeID, 10, 64)
			if parseErr != nil || employeeIDNumber <= 0 {
				http.Error(w, "employee_id debe ser un entero positivo", http.StatusBadRequest)
				return
			}

			payload.Name = strings.TrimSpace(payload.Name)
			if payload.Name == "" {
				http.Error(w, "name es obligatorio", http.StatusBadRequest)
				return
			}

			manualTimestamp, err := parseManualAttendanceTimestamp(payload.Timestamp)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if manualTimestamp != nil && !isTodayTimestamp(*manualTimestamp) {
				http.Error(w, "timestamp debe ser del día de hoy", http.StatusBadRequest)
				return
			}

			loggedAt := time.Now()
			if db != nil {
				insertedAt, success, message, fallbackErr := logAttendanceInDB(r.Context(), db, payload.EmployeeID, payload.Name, manualTimestamp)
				if fallbackErr != nil {
					http.Error(w, "no se pudo registrar asistencia", http.StatusBadGateway)
					return
				}
				if !success {
					http.Error(w, message, http.StatusBadRequest)
					return
				}
				loggedAt = insertedAt
			} else {
				ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
				defer cancel()

				if manualTimestamp != nil {
					loggedAt = *manualTimestamp
				}

				resp, grpcErr := grpcClient.LogAttendance(ctx, &pb.AttendanceRequest{EmployeeId: payload.EmployeeID})
				if grpcErr != nil {
					http.Error(w, "no se pudo registrar asistencia en el servicio gRPC", http.StatusBadGateway)
					return
				}

				if !resp.GetSuccess() {
					http.Error(w, resp.GetMessage(), http.StatusBadRequest)
					return
				}
			}

			record := attendanceRecord{
				ID:        employeeIDNumber,
				Name:      payload.Name,
				Timestamp: loggedAt.Format(time.RFC3339),
			}
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(record)
		default:
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/attendance/", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if !requireRole(w, r, roleOperator) {
			return
		}

		if db == nil {
			http.Error(w, "se requiere conexión a base de datos", http.StatusBadGateway)
			return
		}

		rowID, err := parseAttendanceRowIDFromPath(r.URL.Path)
		if err != nil {
			http.Error(w, "id de fila de asistencia inválido", http.StatusBadRequest)
			return
		}

		switch r.Method {
		case http.MethodPut:
			var payload struct {
				EmployeeID string `json:"employee_id"`
				Name       string `json:"name"`
				Timestamp  string `json:"timestamp"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "JSON inválido", http.StatusBadRequest)
				return
			}

			payload.EmployeeID = strings.TrimSpace(payload.EmployeeID)
			if payload.EmployeeID == "" {
				http.Error(w, "employee_id es obligatorio", http.StatusBadRequest)
				return
			}

			employeeIDNumber, parseErr := strconv.ParseInt(payload.EmployeeID, 10, 64)
			if parseErr != nil || employeeIDNumber <= 0 {
				http.Error(w, "employee_id debe ser un entero positivo", http.StatusBadRequest)
				return
			}

			payload.Name = strings.TrimSpace(payload.Name)
			if payload.Name == "" {
				http.Error(w, "name es obligatorio", http.StatusBadRequest)
				return
			}

			manualTimestamp, err := parseManualAttendanceTimestamp(payload.Timestamp)
			if err != nil {
				http.Error(w, err.Error(), http.StatusBadRequest)
				return
			}
			if manualTimestamp == nil {
				http.Error(w, "timestamp es obligatorio", http.StatusBadRequest)
				return
			}
			if !isTodayTimestamp(*manualTimestamp) {
				http.Error(w, "timestamp debe ser del día de hoy", http.StatusBadRequest)
				return
			}

			canModify, checkErr := isAttendanceRowFromToday(r.Context(), db, rowID)
			if checkErr != nil {
				if strings.Contains(checkErr.Error(), "not found") {
					http.Error(w, "registro de asistencia no encontrado", http.StatusNotFound)
					return
				}
				http.Error(w, "no se pudo validar el registro de asistencia", http.StatusBadGateway)
				return
			}
			if !canModify {
				http.Error(w, "solo se permite editar registros del día de hoy", http.StatusBadRequest)
				return
			}

			if err := updateAttendanceInDB(r.Context(), db, rowID, payload.EmployeeID, payload.Name, *manualTimestamp); err != nil {
				if strings.Contains(err.Error(), "not found") {
					http.Error(w, "registro de asistencia no encontrado", http.StatusNotFound)
					return
				}
				http.Error(w, "no se pudo actualizar asistencia", http.StatusBadGateway)
				return
			}

			_ = json.NewEncoder(w).Encode(attendanceRecord{
				RowID:     rowID,
				ID:        employeeIDNumber,
				Name:      payload.Name,
				Timestamp: manualTimestamp.Format(time.RFC3339),
			})

		case http.MethodDelete:
			canModify, checkErr := isAttendanceRowFromToday(r.Context(), db, rowID)
			if checkErr != nil {
				if strings.Contains(checkErr.Error(), "not found") {
					http.Error(w, "registro de asistencia no encontrado", http.StatusNotFound)
					return
				}
				http.Error(w, "no se pudo validar el registro de asistencia", http.StatusBadGateway)
				return
			}
			if !canModify {
				http.Error(w, "solo se permite eliminar registros del día de hoy", http.StatusBadRequest)
				return
			}

			if err := deleteAttendanceInDB(r.Context(), db, rowID); err != nil {
				if strings.Contains(err.Error(), "not found") {
					http.Error(w, "registro de asistencia no encontrado", http.StatusNotFound)
					return
				}
				http.Error(w, "no se pudo eliminar asistencia", http.StatusBadGateway)
				return
			}
			w.WriteHeader(http.StatusNoContent)

		default:
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/embeddings/extract", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w, r)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if r.Method != http.MethodPost {
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}

		var payload struct {
			Files []embeddingInputFile `json:"files"`
		}
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			http.Error(w, "JSON inválido", http.StatusBadRequest)
			return
		}

		results := make([]map[string]any, 0, len(payload.Files))
		errors := make([]string, 0)

		forcedMode := ""
		if !isProduction() {
			if mode := strings.TrimSpace(r.URL.Query().Get("mode")); mode != "" {
				forcedMode = mode
			}
		}

		tmpResults, extractionMode := extractEmbeddings(payload.Files, forcedMode)

		for _, item := range tmpResults {
			if item == nil {
				continue
			}
			if item.Err != nil {
				errors = append(errors, fmt.Sprintf("%s: %v", item.Name, item.Err))
				continue
			}

			results = append(results, map[string]any{
				"fileName":   item.Name,
				"embedding":  item.Embedding,
				"dimensions": len(item.Embedding),
			})
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"mode":    extractionMode,
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
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
			return
		}

		ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
		defer cancel()

		employees, err := grpcClient.ListEmployees(ctx, &pb.Empty{})
		if err != nil {
			http.Error(w, "no se pudieron listar empleados desde el servicio gRPC", http.StatusBadGateway)
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
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
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
			http.Error(w, "no se pudo leer el almacenamiento de empleados", http.StatusBadGateway)
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
			http.Error(w, "método no permitido", http.StatusMethodNotAllowed)
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
			http.Error(w, "JSON inválido", http.StatusBadRequest)
			return
		}
		if strings.TrimSpace(payload.EmployeeName) == "" {
			http.Error(w, "employeeName es obligatorio", http.StatusBadRequest)
			return
		}
		payload.EmployeeID = strings.TrimSpace(payload.EmployeeID)
		if payload.EmployeeID == "" {
			http.Error(w, "employeeId es obligatorio", http.StatusBadRequest)
			return
		}
		if len(payload.Files) == 0 {
			http.Error(w, "se requiere al menos un archivo", http.StatusBadRequest)
			return
		}
		if len(payload.Files) > 10 {
			http.Error(w, "por precisión, el máximo permitido es 10 archivos", http.StatusBadRequest)
			return
		}

		employeeExists, existsErr := employeeExistsByID(r.Context(), db, payload.EmployeeID)
		if existsErr != nil {
			http.Error(w, "no se pudo validar empleado en base de datos", http.StatusInternalServerError)
			return
		}
		if !employeeExists && len(payload.Files) < 5 {
			http.Error(w, "por precisión, el registro inicial requiere entre 5 y 10 archivos", http.StatusBadRequest)
			return
		}

		healthCtx, healthCancel := context.WithTimeout(r.Context(), 2*time.Second)
		_, healthErr := grpcClient.ListEmployees(healthCtx, &pb.Empty{})
		healthCancel()
		if healthErr != nil {
			http.Error(w, "servicio IA no disponible temporalmente, reintenta en unos segundos", http.StatusServiceUnavailable)
			return
		}

		saved := make([]map[string]any, 0, 1)
		errors := make([]string, 0)

		type registerPhotoJob struct {
			index int
			name  string
			data  string
		}
		type registerPhotoResult struct {
			index         int
			name          string
			success       bool
			errMsg        string
			qualityIssues []string
		}

		workerCount := resolveRegisterPhotoWorkerCount(len(payload.Files))
		rpcTimeout := resolveRegisterPhotoRPCTimeout()
		retryCount := resolveRegisterPhotoRetryCount()
		retryBackoff := resolveRegisterPhotoRetryBackoff()
		jobs := make(chan registerPhotoJob)
		out := make(chan registerPhotoResult, len(payload.Files))

		var wg sync.WaitGroup
		for worker := 0; worker < workerCount; worker++ {
			wg.Add(1)
			go func() {
				defer wg.Done()
				for job := range jobs {
					imageData, decodeErr := decodeBase64Image(job.data)
					if decodeErr != nil {
						out <- registerPhotoResult{index: job.index, name: job.name, errMsg: fmt.Sprintf("%s: payload de imagen inválido", job.name)}
						continue
					}

					qualityIssues, qualityErr := evaluatePhotoQuality(imageData)
					if qualityErr != nil {
						qualityIssues = append(qualityIssues, "no_se_pudo_validar_calidad")
					}

					resp, grpcErr := registerEmployeeWithRetry(
						r.Context(),
						grpcClient,
						&pb.RegisterEmployeeRequest{
						Name:       payload.EmployeeName,
						EmployeeId: payload.EmployeeID,
						Image:      imageData,
						},
						rpcTimeout,
						retryCount,
						retryBackoff,
					)

					if grpcErr != nil {
						errText := describeRegisterGRPCError(grpcErr)
						out <- registerPhotoResult{index: job.index, name: job.name, errMsg: fmt.Sprintf("%s: %s", job.name, errText), qualityIssues: qualityIssues}
						continue
					}
					if !resp.GetSuccess() {
						out <- registerPhotoResult{index: job.index, name: job.name, errMsg: fmt.Sprintf("%s: %s", job.name, resp.GetMessage()), qualityIssues: qualityIssues}
						continue
					}

					out <- registerPhotoResult{index: job.index, name: job.name, success: true, qualityIssues: qualityIssues}
				}
			}()
		}

		for index, file := range payload.Files {
			jobs <- registerPhotoJob{index: index, name: file.Name, data: file.Data}
		}
		close(jobs)

		go func() {
			wg.Wait()
			close(out)
		}()

		orderedResults := make([]*registerPhotoResult, len(payload.Files))
		for item := range out {
			itemCopy := item
			orderedResults[item.index] = &itemCopy
		}

		processedCount := 0
		qualityWarnings := make([]string, 0)
		for _, item := range orderedResults {
			if item == nil {
				continue
			}
			if len(item.qualityIssues) > 0 {
				qualityWarnings = append(qualityWarnings, fmt.Sprintf("%s: %s", item.name, strings.Join(item.qualityIssues, ",")))
			}
			if item.success {
				processedCount++
				continue
			}
			if strings.TrimSpace(item.errMsg) != "" {
				errors = append(errors, item.errMsg)
			}
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
			"saved":           saved,
			"errors":          errors,
			"qualityWarnings": qualityWarnings,
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

func resolveExtractionWorkerCount(fileCount int) int {
	if fileCount <= 1 {
		return 1
	}

	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}

	if configured := strings.TrimSpace(os.Getenv("BMPI_EXTRACT_WORKERS")); configured != "" {
		if parsed, err := strconv.Atoi(configured); err == nil && parsed > 0 {
			workers = parsed
		}
	}

	if workers > fileCount {
		workers = fileCount
	}
	if workers < 1 {
		workers = 1
	}

	return workers
}

func resolveRegisterPhotoWorkerCount(fileCount int) int {
	if fileCount <= 1 {
		return 1
	}

	workers := runtime.NumCPU()
	if workers < 2 {
		workers = 2
	}

	if configured := strings.TrimSpace(os.Getenv("BMPI_REGISTER_PHOTO_WORKERS")); configured != "" {
		if parsed, err := strconv.Atoi(configured); err == nil && parsed > 0 {
			workers = parsed
		}
	}

	if workers > fileCount {
		workers = fileCount
	}
	if workers < 1 {
		workers = 1
	}

	return workers
}

func resolveRegisterPhotoRPCTimeout() time.Duration {
	defaultTimeout := 12 * time.Second
	raw := strings.TrimSpace(os.Getenv("BMPI_REGISTER_PHOTO_TIMEOUT_MS"))
	if raw == "" {
		return defaultTimeout
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return defaultTimeout
	}

	return time.Duration(parsed) * time.Millisecond
}

func resolveRegisterPhotoRetryCount() int {
	defaultRetries := 1
	raw := strings.TrimSpace(os.Getenv("BMPI_REGISTER_PHOTO_RETRIES"))
	if raw == "" {
		return defaultRetries
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 0 {
		return defaultRetries
	}

	if parsed > 5 {
		return 5
	}

	return parsed
}

func resolveRegisterPhotoRetryBackoff() time.Duration {
	defaultBackoff := 300 * time.Millisecond
	raw := strings.TrimSpace(os.Getenv("BMPI_REGISTER_PHOTO_RETRY_BACKOFF_MS"))
	if raw == "" {
		return defaultBackoff
	}

	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed <= 0 {
		return defaultBackoff
	}

	return time.Duration(parsed) * time.Millisecond
}

func isRegisterRetryable(err error) bool {
	st, ok := status.FromError(err)
	if !ok {
		return false
	}

	switch st.Code() {
	case codes.Unavailable, codes.DeadlineExceeded:
		return true
	default:
		return false
	}
}

func registerEmployeeWithRetry(
	ctx context.Context,
	client pb.FaceRecognitionServiceClient,
	request *pb.RegisterEmployeeRequest,
	rpcTimeout time.Duration,
	retries int,
	retryBackoff time.Duration,
) (*pb.RegisterEmployeeResponse, error) {
	attempts := retries + 1
	var lastErr error

	for attempt := 0; attempt < attempts; attempt++ {
		rpcCtx, cancel := context.WithTimeout(ctx, rpcTimeout)
		response, err := client.RegisterEmployee(rpcCtx, request)
		cancel()

		if err == nil {
			return response, nil
		}

		lastErr = err
		if !isRegisterRetryable(err) || attempt == attempts-1 {
			break
		}

		backoff := retryBackoff * time.Duration(attempt+1)
		select {
		case <-time.After(backoff):
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}

	return nil, lastErr
}

func describeRegisterGRPCError(grpcErr error) string {
	errText := "error gRPC al registrar empleado"
	if st, ok := status.FromError(grpcErr); ok {
		switch st.Code() {
		case codes.ResourceExhausted:
			errText = "imagen demasiado pesada; reduce resolución/tamaño de foto"
		case codes.DeadlineExceeded:
			errText = "tiempo agotado al procesar foto; intenta con fotos más ligeras"
		case codes.Unavailable:
			errText = "servicio IA no disponible temporalmente"
		default:
			errText = fmt.Sprintf("error IA (%s)", st.Code().String())
		}
	} else {
		rawErr := strings.ToLower(grpcErr.Error())
		if strings.Contains(rawErr, "larger than max") || strings.Contains(rawErr, "resourceexhausted") {
			errText = "imagen demasiado pesada; reduce resolución/tamaño de foto"
		}
	}

	return errText
}

func normalizeExtractionMode(raw string) string {
	mode := strings.ToLower(strings.TrimSpace(raw))
	if mode == "" {
		return "auto"
	}

	switch mode {
	case "auto", "batch", "legacy":
		return mode
	default:
		log.Printf("BMPI_EXTRACT_MODE inválido '%s', usando 'auto'", mode)
		return "auto"
	}
}

func resolveExtractionMode() string {
	return normalizeExtractionMode(os.Getenv("BMPI_EXTRACT_MODE"))
}

func extractEmbeddings(files []embeddingInputFile, forcedMode string) ([]*embeddingExtractItem, string) {
	mode := resolveExtractionMode()
	if strings.TrimSpace(forcedMode) != "" {
		mode = normalizeExtractionMode(forcedMode)
	}

	switch mode {
	case "legacy":
		return extractEmbeddingsLegacy(files), "legacy"
	case "batch":
		batchResults, err := extractEmbeddingsBatch(files)
		if err == nil {
			return batchResults, "batch"
		}
		log.Printf("extract-batch falló en modo 'batch', usando fallback legacy: %v", err)
		return extractEmbeddingsLegacy(files), "batch-fallback-legacy"
	default:
		batchResults, err := extractEmbeddingsBatch(files)
		if err == nil {
			return batchResults, "auto-batch"
		}
		log.Printf("extract-batch falló en modo 'auto', usando legacy: %v", err)
		return extractEmbeddingsLegacy(files), "auto-fallback-legacy"
	}
}

func requireRole(w http.ResponseWriter, r *http.Request, role string) bool {
	operatorKey := strings.TrimSpace(os.Getenv("BMPI_OPERATOR_API_KEY"))
	adminKey := strings.TrimSpace(os.Getenv("BMPI_ADMIN_API_KEY"))

	if isProduction() {
		if operatorKey == "" {
			http.Error(w, "servidor mal configurado: BMPI_OPERATOR_API_KEY es obligatorio en producción", http.StatusInternalServerError)
			return false
		}
		if role == roleAdmin && adminKey == "" {
			http.Error(w, "servidor mal configurado: BMPI_ADMIN_API_KEY es obligatorio para endpoints de administrador", http.StatusInternalServerError)
			return false
		}
	}

	if operatorKey == "" && adminKey == "" && !isProduction() {
		return true
	}

	requestKey := strings.TrimSpace(r.Header.Get("X-API-Key"))
	if requestKey == "" {
		http.Error(w, "falta API key", http.StatusUnauthorized)
		return false
	}

	if role == roleAdmin {
		if adminKey == "" || requestKey != adminKey {
			http.Error(w, "prohibido: se requiere clave de administrador", http.StatusForbidden)
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

	http.Error(w, "prohibido", http.StatusForbidden)
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
		return nil, fmt.Errorf("respuesta de Python inválida para %s: %w", fileName, err)
	}
	if !response.Success || len(response.Embedding) == 0 {
		message := response.Error
		if message == "" {
			message = "no se devolvió embedding facial"
		}
		return nil, fmt.Errorf(message)
	}

	return response.Embedding, nil
}

func extractEmbeddingsLegacy(files []embeddingInputFile) []*embeddingExtractItem {
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

	workerCount := resolveExtractionWorkerCount(len(files))
	jobs := make(chan extractJob)
	out := make(chan extractResult, len(files))

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

	for index, file := range files {
		jobs <- extractJob{index: index, name: file.Name, data: file.Data}
	}
	close(jobs)

	go func() {
		wg.Wait()
		close(out)
	}()

	tmpResults := make([]*embeddingExtractItem, len(files))
	for item := range out {
		tmpResults[item.index] = &embeddingExtractItem{
			Name:      item.name,
			Embedding: item.embedding,
			Err:       item.err,
		}
	}

	return tmpResults
}

func extractEmbeddingsBatch(files []embeddingInputFile) ([]*embeddingExtractItem, error) {
	if len(files) == 0 {
		return []*embeddingExtractItem{}, nil
	}

	pythonBin, err := resolvePythonBinary()
	if err != nil {
		return nil, err
	}

	scriptPath, err := resolveEmbeddingScriptPath()
	if err != nil {
		return nil, err
	}

	tmpFiles := make([]string, 0, len(files))
	pathToName := make(map[string]string, len(files))
	for _, file := range files {
		imageData, decodeErr := decodeBase64Image(file.Data)
		if decodeErr != nil {
			continue
		}

		tmpFile, createErr := os.CreateTemp("", "bmpi-embedding-batch-*")
		if createErr != nil {
			return nil, fmt.Errorf("temp file: %w", createErr)
		}

		if _, writeErr := tmpFile.Write(imageData); writeErr != nil {
			_ = tmpFile.Close()
			_ = os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("write image: %w", writeErr)
		}
		if closeErr := tmpFile.Close(); closeErr != nil {
			_ = os.Remove(tmpFile.Name())
			return nil, fmt.Errorf("close image file: %w", closeErr)
		}

		tmpFiles = append(tmpFiles, tmpFile.Name())
		pathToName[tmpFile.Name()] = file.Name
	}

	defer func() {
		for _, path := range tmpFiles {
			_ = os.Remove(path)
		}
	}()

	if len(tmpFiles) == 0 {
		return nil, fmt.Errorf("sin archivos válidos")
	}

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	args := append([]string{scriptPath, "extract-batch"}, tmpFiles...)
	cmd := exec.CommandContext(ctx, pythonBin, args...)
	cmd.Env = append(os.Environ(), "PYTHONWARNINGS=ignore")
	out, cmdErr := cmd.CombinedOutput()
	if cmdErr != nil {
		return nil, fmt.Errorf("python extract-batch failed: %v (%s)", cmdErr, strings.TrimSpace(string(out)))
	}

	var response struct {
		Success bool `json:"success"`
		Results []struct {
			Path      string    `json:"path"`
			Success   bool      `json:"success"`
			Embedding []float64 `json:"embedding"`
			Error     string    `json:"error"`
		} `json:"results"`
		Error string `json:"error"`
	}

	raw := strings.TrimSpace(string(out))
	start := strings.Index(raw, "{")
	end := strings.LastIndex(raw, "}")
	if start >= 0 && end > start {
		raw = raw[start : end+1]
	}

	if err := json.Unmarshal([]byte(raw), &response); err != nil {
		return nil, fmt.Errorf("respuesta batch de Python inválida: %w", err)
	}
	if !response.Success {
		if response.Error != "" {
			return nil, fmt.Errorf(response.Error)
		}
		return nil, fmt.Errorf("extract-batch falló")
	}

	byPath := make(map[string]struct {
		success   bool
		embedding []float64
		err       string
	}, len(response.Results))
	for _, item := range response.Results {
		byPath[item.Path] = struct {
			success   bool
			embedding []float64
			err       string
		}{
			success:   item.Success,
			embedding: item.Embedding,
			err:       item.Error,
		}
	}

	results := make([]*embeddingExtractItem, 0, len(tmpFiles))
	for _, path := range tmpFiles {
		name := pathToName[path]
		item, ok := byPath[path]
		if !ok {
			results = append(results, &embeddingExtractItem{Name: name, Err: fmt.Errorf("sin respuesta para archivo")})
			continue
		}
		if !item.success || len(item.embedding) == 0 {
			errMsg := item.err
			if errMsg == "" {
				errMsg = "no se devolvió embedding facial"
			}
			results = append(results, &embeddingExtractItem{Name: name, Err: fmt.Errorf(errMsg)})
			continue
		}
		results = append(results, &embeddingExtractItem{Name: name, Embedding: item.embedding})
	}

	return results, nil
}

func decodeBase64Image(data string) ([]byte, error) {
	trimmed := strings.TrimSpace(data)
	if trimmed == "" {
		return nil, fmt.Errorf("datos de imagen vacíos")
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

	return nil, fmt.Errorf("datos de imagen base64 inválidos")
}

func resolvePhotoQualityMinDimension() int {
	raw := strings.TrimSpace(os.Getenv("BMPI_QUALITY_MIN_DIMENSION"))
	if raw == "" {
		return 220
	}
	parsed, err := strconv.Atoi(raw)
	if err != nil || parsed < 64 {
		return 220
	}
	return parsed
}

func resolvePhotoQualityBrightnessMin() float64 {
	raw := strings.TrimSpace(os.Getenv("BMPI_QUALITY_BRIGHTNESS_MIN"))
	if raw == "" {
		return 55.0
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 55.0
	}
	return parsed
}

func resolvePhotoQualityBrightnessMax() float64 {
	raw := strings.TrimSpace(os.Getenv("BMPI_QUALITY_BRIGHTNESS_MAX"))
	if raw == "" {
		return 210.0
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 210.0
	}
	return parsed
}

func resolvePhotoQualityDetailMin() float64 {
	raw := strings.TrimSpace(os.Getenv("BMPI_QUALITY_DETAIL_MIN"))
	if raw == "" {
		return 2.5
	}
	parsed, err := strconv.ParseFloat(raw, 64)
	if err != nil {
		return 2.5
	}
	return parsed
}

func evaluatePhotoQuality(imageData []byte) ([]string, error) {
	metrics, err := computePhotoQualityMetrics(imageData)
	if err != nil {
		return []string{"no_se_pudo_decodificar_imagen"}, err
	}

	issues := make([]string, 0)
	minDimension := resolvePhotoQualityMinDimension()
	if metrics.Width < minDimension || metrics.Height < minDimension {
		issues = append(issues, "resolucion_baja")
	}

	brightnessMin := resolvePhotoQualityBrightnessMin()
	brightnessMax := resolvePhotoQualityBrightnessMax()
	if metrics.Brightness < brightnessMin {
		issues = append(issues, "iluminacion_baja")
	} else if metrics.Brightness > brightnessMax {
		issues = append(issues, "iluminacion_alta")
	}

	if metrics.Detail < resolvePhotoQualityDetailMin() {
		issues = append(issues, "detalle_bajo_posible_blur")
	}

	return issues, nil
}

func computePhotoQualityMetrics(imageData []byte) (photoQualityMetrics, error) {
	reader := bytes.NewReader(imageData)
	img, _, err := image.Decode(reader)
	if err != nil {
		return photoQualityMetrics{}, err
	}

	bounds := img.Bounds()
	width := bounds.Dx()
	height := bounds.Dy()
	if width <= 0 || height <= 0 {
		return photoQualityMetrics{}, fmt.Errorf("imagen inválida")
	}

	var brightnessSum float64
	var detailSum float64
	var detailSamples float64

	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		var prevLum float64
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			r, g, b, _ := img.At(x, y).RGBA()
			lum := (0.2126*float64(r) + 0.7152*float64(g) + 0.0722*float64(b)) / 257.0
			brightnessSum += lum
			if x > bounds.Min.X {
				d := lum - prevLum
				if d < 0 {
					d = -d
				}
				detailSum += d
				detailSamples++
			}
			prevLum = lum
		}
	}

	pixelCount := float64(width * height)
	brightness := 0.0
	if pixelCount > 0 {
		brightness = brightnessSum / pixelCount
	}

	detail := 0.0
	if detailSamples > 0 {
		detail = detailSum / detailSamples
	}

	return photoQualityMetrics{
		Width:      width,
		Height:     height,
		Brightness: brightness,
		Detail:     detail,
	}, nil
}

func parseRequestedAttendanceDate(r *http.Request) (*time.Time, error) {
	rawDate := strings.TrimSpace(r.URL.Query().Get("date"))
	if rawDate == "" {
		return nil, nil
	}

	parsed, err := time.Parse("2006-01-02", rawDate)
	if err != nil {
		return nil, fmt.Errorf("formato de fecha inválido, se espera YYYY-MM-DD")
	}

	now := time.Now()
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	if parsed.After(today) {
		return nil, fmt.Errorf("la fecha no puede estar en el futuro")
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
		SELECT a.id, a.employee_id, COALESCE(NULLIF(TRIM(a.name), ''), NULLIF(TRIM(e.name), ''), a.employee_id) AS name, a.timestamp
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
		var rowID int64
		var employeeIDRaw string
		var ts time.Time
		if err := rows.Scan(&rowID, &employeeIDRaw, &rec.Name, &ts); err != nil {
			return nil, err
		}

		employeeIDRaw = strings.TrimSpace(employeeIDRaw)
		parsedID, err := strconv.ParseInt(employeeIDRaw, 10, 64)
		if err != nil || parsedID <= 0 {
			parsedID = 0
		}
		rec.ID = parsedID
		rec.RowID = rowID
		rec.Timestamp = ts.Format(time.RFC3339)
		records = append(records, rec)
	}

	if err := rows.Err(); err != nil {
		return nil, err
	}

	return records, nil
}

func employeeExistsByID(ctx context.Context, db *sql.DB, employeeID string) (bool, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	trimmedID := strings.TrimSpace(employeeID)
	if trimmedID == "" {
		return false, nil
	}

	var exists bool
	err := db.QueryRowContext(
		queryCtx,
		"SELECT EXISTS (SELECT 1 FROM employees WHERE employee_id = $1)",
		trimmedID,
	).Scan(&exists)
	if err != nil {
		return false, err
	}

	return exists, nil
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
			return nil, fmt.Errorf("formato de timestamp inválido; usa ISO o YYYY-MM-DDTHH:MM")
		}
		parsed = parsedLocal
	}

	if parsed.After(time.Now().Add(1 * time.Minute)) {
		return nil, fmt.Errorf("Hora futura no permitida: debe ser menor o igual a la hora actual")
	}

	return &parsed, nil
}

func isTodayTimestamp(ts time.Time) bool {
	now := time.Now()
	localized := ts.In(now.Location())

	return localized.Year() == now.Year() && localized.Month() == now.Month() && localized.Day() == now.Day()
}

func parseAttendanceRowIDFromPath(path string) (int64, error) {
	const prefix = "/api/attendance/"
	if !strings.HasPrefix(path, prefix) {
		return 0, fmt.Errorf("ruta inválida")
	}

	raw := strings.TrimSpace(strings.TrimPrefix(path, prefix))
	if raw == "" || strings.Contains(raw, "/") {
		return 0, fmt.Errorf("id inválido")
	}

	parsed, err := strconv.ParseInt(raw, 10, 64)
	if err != nil || parsed <= 0 {
		return 0, fmt.Errorf("id inválido")
	}

	return parsed, nil
}

func updateAttendanceInDB(ctx context.Context, db *sql.DB, rowID int64, employeeID string, name string, timestamp time.Time) error {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	result, err := db.ExecContext(
		queryCtx,
		`UPDATE attendance SET employee_id = $1, name = $2, timestamp = $3 WHERE id = $4`,
		employeeID,
		name,
		timestamp,
		rowID,
	)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("not found")
	}

	return nil
}

func deleteAttendanceInDB(ctx context.Context, db *sql.DB, rowID int64) error {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	result, err := db.ExecContext(queryCtx, `DELETE FROM attendance WHERE id = $1`, rowID)
	if err != nil {
		return err
	}

	rowsAffected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if rowsAffected == 0 {
		return fmt.Errorf("not found")
	}

	return nil
}

func isAttendanceRowFromToday(ctx context.Context, db *sql.DB, rowID int64) (bool, error) {
	queryCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()

	var ts time.Time
	err := db.QueryRowContext(queryCtx, `SELECT timestamp FROM attendance WHERE id = $1`, rowID).Scan(&ts)
	if err != nil {
		if err == sql.ErrNoRows {
			return false, fmt.Errorf("not found")
		}
		return false, err
	}

	return isTodayTimestamp(ts), nil
}

func logAttendanceInDB(ctx context.Context, db *sql.DB, employeeID string, employeeName string, attendanceAt *time.Time) (time.Time, bool, string, error) {
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
			`INSERT INTO attendance (employee_id, name, timestamp) VALUES ($1, $2, $3)`,
			employeeID,
			employeeName,
			insertedAt,
		)
	} else {
		_, err = db.ExecContext(
			queryCtx,
			`INSERT INTO attendance (employee_id, name, timestamp) VALUES ($1, $2, NOW())`,
			employeeID,
			employeeName,
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

	if _, err := db.Exec(`ALTER TABLE attendance ADD COLUMN IF NOT EXISTS name TEXT`); err != nil {
		log.Printf("could not ensure attendance.name column: %v", err)
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
			SELECT employee_id, name, embedding, OCTET_LENGTH(photo) AS photo_bytes
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
			var photoBytes sql.NullInt64
			if err := rows.Scan(&employeeID, &name, &embedding, &photoBytes); err != nil {
				return nil, err
			}
			if photoBytes.Valid && photoBytes.Int64 > 0 {
				item["photo_bytes"] = int(photoBytes.Int64)
			} else {
				item["photo_bytes"] = 0
			}
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
	maxMsgMB := 20
	if raw := strings.TrimSpace(os.Getenv("BMPI_GRPC_MAX_MSG_MB")); raw != "" {
		if parsed, err := strconv.Atoi(raw); err == nil && parsed > 0 {
			maxMsgMB = parsed
		}
	}

	maxMsgBytes := maxMsgMB * 1024 * 1024
	callOptions := grpc.WithDefaultCallOptions(
		grpc.MaxCallRecvMsgSize(maxMsgBytes),
		grpc.MaxCallSendMsgSize(maxMsgBytes),
	)

	if boolFromEnv("BMPI_FACE_GRPC_TLS") {
		caCert := strings.TrimSpace(os.Getenv("BMPI_FACE_GRPC_CA_CERT"))
		if caCert == "" {
			return nil, fmt.Errorf("BMPI_FACE_GRPC_CA_CERT is required when BMPI_FACE_GRPC_TLS=true")
		}

		creds, err := credentials.NewClientTLSFromFile(caCert, "")
		if err != nil {
			return nil, fmt.Errorf("invalid BMPI_FACE_GRPC_CA_CERT: %w", err)
		}
		return []grpc.DialOption{grpc.WithTransportCredentials(creds), callOptions}, nil
	}

	return []grpc.DialOption{grpc.WithTransportCredentials(insecure.NewCredentials()), callOptions}, nil
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
