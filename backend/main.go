package main

import (
	"context"
	"encoding/json"
	"log"
	"net"
	"net/http"
	"sync"
	"time"

	pb "github.com/example/face-attendance/backend/pb"
	"google.golang.org/grpc"
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

func startHTTPServer(grpcClient pb.FaceRecognitionServiceClient, store *attendanceStore) {
	mux := http.NewServeMux()

	mux.HandleFunc("/api/attendance", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w)
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}

		switch r.Method {
		case http.MethodGet:
			_ = json.NewEncoder(w).Encode(store.list())
		case http.MethodPost:
			var payload struct {
				EmployeeID string `json:"employee_id"`
				Name       string `json:"name"`
			}
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				http.Error(w, "invalid JSON payload", http.StatusBadRequest)
				return
			}

			if payload.EmployeeID == "" {
				http.Error(w, "employee_id is required", http.StatusBadRequest)
				return
			}

			ctx, cancel := context.WithTimeout(r.Context(), 5*time.Second)
			defer cancel()

			resp, err := grpcClient.LogAttendance(ctx, &pb.AttendanceRequest{EmployeeId: payload.EmployeeID})
			if err != nil {
				http.Error(w, "could not log attendance in gRPC service", http.StatusBadGateway)
				return
			}
			if !resp.GetSuccess() {
				http.Error(w, resp.GetMessage(), http.StatusBadRequest)
				return
			}

			name := payload.Name
			if name == "" {
				name = "Empleado " + payload.EmployeeID
			}
			record := store.add(payload.EmployeeID, name)
			w.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(w).Encode(record)
		default:
			http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		}
	})

	mux.HandleFunc("/api/embeddings/extract", func(w http.ResponseWriter, r *http.Request) {
		setJSONHeaders(w)
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
		for _, file := range payload.Files {
			results = append(results, map[string]any{
				"fileName":   file.Name,
				"embedding":  []float64{},
				"dimensions": 0,
			})
		}

		_ = json.NewEncoder(w).Encode(map[string]any{
			"results": results,
			"errors":  []string{"embedding extraction endpoint connected; integrate Python model service to return real vectors"},
		})
	})

	log.Println("REST bridge running on :8080")
	if err := http.ListenAndServe(":8080", mux); err != nil {
		log.Fatal(err)
	}
}

func setJSONHeaders(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Access-Control-Allow-Origin", "*")
	w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
	w.Header().Set("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
}

func main() {
	conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
	if err != nil {
		log.Fatal("Failed to connect to face service:", err)
	}
	defer conn.Close()

	faceClient := pb.NewFaceRecognitionServiceClient(conn)
	store := newAttendanceStore()

	go startHTTPServer(faceClient, store)

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
