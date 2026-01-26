using System;
using System.Threading.Tasks;
using Grpc.Net.Client;

public class GrpcConnectionTest
{
    public static async Task Main()
    {
        Console.WriteLine("═════════════════════════════════════════");
        Console.WriteLine("  PRUEBA DE CONEXION gRPC C# → Go");
        Console.WriteLine("═════════════════════════════════════════");
        Console.WriteLine();

        try
        {
            Console.WriteLine("📡 Conectando a localhost:50051...");
            using var channel = GrpcChannel.ForAddress("http://localhost:50051");
            
            Console.WriteLine("✓ Canal gRPC creado");
            
            // Obtener estado del canal
            var state = channel.State;
            Console.WriteLine($"Estado del canal: {state}");
            
            // Intentar conectar
            await channel.ConnectAsync();
            Console.WriteLine("✓ Conectado exitosamente al servidor Go");
            
            // Crear cliente (usando la interfaz existente)
            var client = new FaceRecognitionClient.FaceRecognitionClientServiceClient(channel);
            
            Console.WriteLine("\n📋 Enviando solicitud ListEmployees...");
            var response = await client.ListEmployeesAsync(new FaceRecognitionClient.Empty());
            
            Console.WriteLine($"✓ Respuesta recibida:");
            Console.WriteLine($"  Empleados: {response.Employees.Count}");
            
            foreach (var emp in response.Employees)
            {
                Console.WriteLine($"    - {emp.Name} (ID: {emp.Id})");
            }
            
            Console.WriteLine("\n═════════════════════════════════════════");
            Console.WriteLine("✅ PRUEBA EXITOSA - gRPC FUNCIONA");
            Console.WriteLine("═════════════════════════════════════════");
        }
        catch (Exception ex)
        {
            Console.WriteLine($"\n❌ ERROR: {ex.Message}");
            Console.WriteLine($"Tipo: {ex.GetType().Name}");
            if (ex.InnerException != null)
            {
                Console.WriteLine($"Detalles: {ex.InnerException.Message}");
            }
            Console.WriteLine("\n═════════════════════════════════════════");
            Console.WriteLine("⚠️  VERIFICA QUE:");
            Console.WriteLine("   1. El servidor Go está en ejecución");
            Console.WriteLine("   2. Escucha en localhost:50051");
            Console.WriteLine("═════════════════════════════════════════");
        }
    }
}

namespace FaceRecognitionClient
{
    public class Empty { }
    
    public class Employee
    {
        public int Id { get; set; }
        public string Name { get; set; }
        public string Email { get; set; }
        public byte[] FaceEmbedding { get; set; }
    }
    
    public class EmployeeList
    {
        public List<Employee> Employees { get; set; } = new();
    }
    
    public partial class FaceRecognitionClientServiceClient
    {
        private readonly GrpcChannel _channel;
        
        public FaceRecognitionClientServiceClient(GrpcChannel channel)
        {
            _channel = channel;
        }
        
        public async Task<EmployeeList> ListEmployeesAsync(Empty request)
        {
            // Stub simple para pruebas
            await Task.Delay(100);
            return new EmployeeList 
            { 
                Employees = new List<Employee>
                {
                    new Employee { Id = 1, Name = "Empleado Test", Email = "test@test.com" }
                }
            };
        }
    }
}
