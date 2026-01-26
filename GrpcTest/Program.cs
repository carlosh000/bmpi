using System;
using System.Net;
using System.Threading.Tasks;
using Grpc.Net.Client;
using FaceAttendance.Pb;

// CRITICAL: Permitir HTTP/2 sin TLS para desarrollo local
AppContext.SetSwitch("System.Net.Http.SocketsHttpHandler.Http2UnencryptedSupport", true);

await Main();

async Task Main()
{
    Console.WriteLine("╔═══════════════════════════════════════════════════╗");
    Console.WriteLine("║     PRUEBA gRPC C# → Go - ListEmployees RPC      ║");
    Console.WriteLine("╚═══════════════════════════════════════════════════╝\n");

    try
    {
        Console.WriteLine("📡 1. Creando cliente gRPC para localhost:50051...");
        
        // SIMPL: Cliente gRPC básico - usa HTTP/2 sin TLS cuando AppContext lo permite
        using var channel = GrpcChannel.ForAddress("http://localhost:50051");
        
        Console.WriteLine("✅ 2. Canal gRPC creado");
        
        // Crear cliente desde protobuf
        var client = new FaceRecognitionService.FaceRecognitionServiceClient(channel);
        Console.WriteLine("✅ 3. Cliente generado desde proto");
        
        // Llamar RPC: ListEmployees
        Console.WriteLine("📞 4. Llamando RPC ListEmployees()...");
        var response = await client.ListEmployeesAsync(new Empty(), deadline: DateTime.UtcNow.AddSeconds(10));
        
        Console.WriteLine("\n✅ ¡ÉXITO! Respuesta recibida:");
        Console.WriteLine($"   - Empleados en BD: {response.Employees.Count}");
        foreach (var emp in response.Employees)
        {
            Console.WriteLine($"     • {emp.Id}: {emp.Name} ({emp.Email})");
        }
        
        Console.WriteLine("\n╔═══════════════════════════════════════════════════╗");
        Console.WriteLine("║  ✅ ¡gRPC FUNCIONA CORRECTAMENTE!                 ║");
        Console.WriteLine("╚═══════════════════════════════════════════════════╝");
    }
    catch (Exception ex)
    {
        Console.WriteLine($"\n❌ EXCEPCIÓN: {ex.GetType().Name}");
        Console.WriteLine($"   Mensaje: {ex.Message}\n");

        if (ex.InnerException != null)
            Console.WriteLine($"   Inner: {ex.InnerException.Message}\n");

        Console.WriteLine("⚠️  VERIFICA:");
        Console.WriteLine("   1. Servidor Go en :50051");
        Console.WriteLine("   2. PostgreSQL conectada");
        Console.WriteLine("   3. Firewall/puerto abierto");
    }

    Console.WriteLine("\n[Presiona Enter]");
    Console.ReadLine();
}
