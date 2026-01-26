using System;
using System.Threading.Tasks;
using Grpc.Net.Client;
using FaceAttendance.Pb;

namespace FaceAttendance.Tests
{
    class GrpcConnectionTest
    {
        static async Task Main(string[] args)
        {
            Console.WriteLine("=== PRUEBA DE CONEXIÓN GRPC ===");
            Console.WriteLine();

            try
            {
                Console.WriteLine("[1] Conectando a servidor gRPC en localhost:50051...");
                var channel = GrpcChannel.ForAddress("http://localhost:50051");
                Console.WriteLine("[✓] Canal creado");

                Console.WriteLine("[2] Esperando a que el canal esté listo...");
                await channel.ConnectAsync();
                Console.WriteLine("[✓] Canal conectado");

                Console.WriteLine("[3] Creando cliente gRPC...");
                var client = new FaceRecognitionServiceClient(channel);
                Console.WriteLine("[✓] Cliente creado");

                Console.WriteLine("[4] Probando método ListEmployees...");
                var response = await client.ListEmployeesAsync(new Empty());
                Console.WriteLine("[✓] Respuesta recibida");
                Console.WriteLine($"   - Empleados en BD: {response.Employees.Count}");

                Console.WriteLine();
                Console.WriteLine("✅ COMUNICACIÓN GRPC EXITOSA");
                Console.WriteLine();
                Console.WriteLine("Detalles del servidor:");
                Console.WriteLine($"  - Dirección: localhost:50051");
                Console.WriteLine($"  - Protocolo: gRPC/HTTP2");
                Console.WriteLine($"  - Estado: OPERATIVO");

                await channel.ShutdownAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"❌ ERROR: {ex.Message}");
                Console.WriteLine($"   {ex.InnerException?.Message}");
                Environment.Exit(1);
            }
        }
    }
}
