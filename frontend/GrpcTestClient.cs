using System;
using System.Threading.Tasks;
using Grpc.Net.Client;

class GrpcTest
{
    static async Task Main()
    {
        Console.WriteLine("╔════════════════════════════════════════╗");
        Console.WriteLine("║     PRUEBA gRPC C# → Go                ║");
        Console.WriteLine("╚════════════════════════════════════════╝\n");

        try
        {
            Console.WriteLine("📡 1. Conectando a localhost:50051...");
            using var channel = GrpcChannel.ForAddress("http://localhost:50051");
            
            Console.WriteLine("✅ 2. Canal gRPC creado");
            Console.WriteLine($"   Estado inicial: {channel.State}");
            
            Console.WriteLine("⏳ 3. Esperando conexión HTTP/2 (3s timeout)...");
            var connectTask = channel.ConnectAsync();
            var completed = await Task.WhenAny(connectTask, Task.Delay(3000));
            
            if (completed == connectTask)
            {
                Console.WriteLine("✅ 4. Conexión establecida");
                Console.WriteLine($"   Estado final: {channel.State}");
                Console.WriteLine("\n╔════════════════════════════════════════╗");
                Console.WriteLine("║  ✅ ¡ÉXITO! gRPC CONECTA               ║");
                Console.WriteLine("╚════════════════════════════════════════╝");
            }
            else
            {
                Console.WriteLine("⏱️ 4. Timeout - conexión no completó");
                Console.WriteLine($"   Estado: {channel.State}");
                Console.WriteLine("\n╔════════════════════════════════════════╗");
                Console.WriteLine("║  ⚠️  gRPC NO RESPONDE EN TIEMPO        ║");
                Console.WriteLine("╚════════════════════════════════════════╝");
            }
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
}
