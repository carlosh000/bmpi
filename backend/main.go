package main

import (
	"context"
	"log"
	"net"
	"time"

	pb "github.com/example/face-attendance/backend/pb"
	"google.golang.org/grpc"
)

type server struct {
	pb.UnimplementedFaceRecognitionServiceServer
	faceClient pb.FaceRecognitionServiceClient
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
	return s.faceClient.LogAttendance(ctx, req)
}

func (s *server) ListEmployees(ctx context.Context, req *pb.Empty) (*pb.EmployeeList, error) {
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return s.faceClient.ListEmployees(ctx, req)
}

func main() {

	conn, err := grpc.Dial("localhost:50051", grpc.WithInsecure())
	if err != nil {
		log.Fatal("Failed to connect to face service:", err)
	}
	defer conn.Close()

	faceClient := pb.NewFaceRecognitionServiceClient(conn)

	lis, err := net.Listen("tcp", ":50052")
	if err != nil {
		log.Fatal(err)
	}

	grpcServer := grpc.NewServer()
	pb.RegisterFaceRecognitionServiceServer(grpcServer, &server{
		faceClient: faceClient,
	})

	log.Println("Main Go Server running on :50052")
	if err := grpcServer.Serve(lis); err != nil {
		log.Fatal(err)
	}
}
