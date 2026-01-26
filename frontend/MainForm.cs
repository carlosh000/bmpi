using System;
using System.ComponentModel;
using System.Drawing;
using System.IO;
using System.Threading.Tasks;
using System.Windows.Forms;
using Grpc.Net.Client;
using FaceAttendance.Pb;

namespace FaceAttendance;

public partial class MainForm : Form
{
        //private FaceRecognitionClientService? _clientService;

        public MainForm()
        {
            InitializeComponent();
            //InitializeGrpcClient();
        }

    private void InitializeComponent()
    {

        // Panel principal
        Panel pnlMain = new Panel { Dock = DockStyle.Fill, BackColor = Color.White };
        
        // Label título
        Label lblTitle = new Label 
        { 
            Text = "🎯 Sistema de Reconocimiento Facial",
            Font = new Font("Arial", 18, FontStyle.Bold),
            ForeColor = Color.DarkBlue,
            AutoSize = true,
            Location = new Point(20, 20)
        };
        
        // Panel de cámara
        PictureBox picCamera = new PictureBox
        {
            BorderStyle = BorderStyle.Fixed3D,
            Size = new Size(400, 300),
            Location = new Point(50, 70),
            BackColor = Color.Black
        };
        picCamera.Name = "picCamera";
        
        // Botón para capturar
        Button btnCapture = new Button
        {
            Text = "📸 Capturar y Reconocer",
            Font = new Font("Arial", 12, FontStyle.Bold),
            BackColor = Color.LimeGreen,
            ForeColor = Color.White,
            Size = new Size(150, 40),
            Location = new Point(50, 390),
            Cursor = Cursors.Hand
        };
        btnCapture.Click += BtnCapture_Click;
        btnCapture.Name = "btnCapture";
        
        // Botón para registrar
        Button btnRegister = new Button
        {
            Text = "➕ Registrar Empleado",
            Font = new Font("Arial", 12, FontStyle.Bold),
            BackColor = Color.DodgerBlue,
            ForeColor = Color.White,
            Size = new Size(150, 40),
            Location = new Point(220, 390),
            Cursor = Cursors.Hand
        };
        btnRegister.Click += BtnRegister_Click;
        btnRegister.Name = "btnRegister";
        
        // Label de resultado
        Label lblResult = new Label
        {
            Text = "Esperando captura...",
            Font = new Font("Arial", 14, FontStyle.Bold),
            ForeColor = Color.DarkGreen,
            AutoSize = true,
            Location = new Point(50, 450),
            MaximumSize = new Size(400, 100)
        };
        lblResult.Name = "lblResult";
        
        // Añadir controles
        pnlMain.Controls.Add(lblTitle);
        pnlMain.Controls.Add(picCamera);
        pnlMain.Controls.Add(btnCapture);
        pnlMain.Controls.Add(btnRegister);
        pnlMain.Controls.Add(lblResult);
        
        // Configurar formulario
        Controls.Add(pnlMain);
        Text = "Face Attendance System";
        Size = new Size(600, 600);
        StartPosition = FormStartPosition.CenterScreen;
        FormBorderStyle = FormBorderStyle.FixedSingle;
        MaximizeBox = false;
    }

    private void InitializeGrpcClient()
    {
        try
        {
            // Conectar a servidor Go en localhost:50051
            _clientService = new FaceRecognitionClientService("http://localhost:50051");
            
            UpdateLabel("✅ Conectado a servidor Go");
            LogMessage("Conexión gRPC establecida");
        }
        catch (Exception ex)
        {
            UpdateLabel($"❌ Error conectando: {ex.Message}");
            LogMessage($"Error gRPC: {ex}");
        }
    }

    private async void BtnCapture_Click(object? sender, EventArgs e)
    {
        try
        {
            UpdateLabel("📸 Capturando...");
            
            // Aquí irá el código para capturar de cámara
            // Por ahora usaremos una imagen de prueba
            
            string testImagePath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "test_face.jpg");
            
            if (!File.Exists(testImagePath))
            {
                UpdateLabel("⚠️ Carga una imagen: test_face.jpg en la carpeta de la app");
                return;
            }
            
            byte[] imageBytes = File.ReadAllBytes(testImagePath);
            
            // Llamar a gRPC con el cliente simplificado
            var response = await _clientService!.RecognizeFaceAsync(imageBytes, 0.6f);
            
            if (response.Found)
            {
                UpdateLabel($"✅ {response.Name}\nConfianza: {(response.Confidence * 100):F1}%");
                
                // Registrar asistencia automáticamente
                await RegisterAttendance(response.EmployeeId);
            }
            else
            {
                UpdateLabel($"❌ {response.Message}");
            }
        }
        catch (Exception ex)
        {
            UpdateLabel($"❌ Error: {ex.Message}");
            LogMessage($"Error capturando: {ex}");
        }
    }

    private void BtnRegister_Click(object? sender, EventArgs e)
    {
        UpdateLabel("➕ Función de registro no implementada aún");
        // TODO: Implementar registro de nuevos empleados
    }

    private async Task RegisterAttendance(int employeeId)
    {
        try
        {
            var response = await _clientService!.LogAttendanceAsync(employeeId, "Oficina Principal");
            
            if (response.Success)
            {
                LogMessage($"✅ Asistencia registrada (ID: {response.AttendanceId})");
            }
        }
        catch (Exception ex)
        {
            LogMessage($"Error registrando asistencia: {ex.Message}");
        }
    }

    private void UpdateLabel(string message)
    {
        if (InvokeRequired)
        {
            Invoke(() => UpdateLabel(message));
            return;
        }
        
        var label = Controls.Find("lblResult", true).FirstOrDefault() as Label;
        if (label != null)
        {
            label.Text = message;
        }
    }

    private void LogMessage(string message)
    {
        Console.WriteLine($"[{DateTime.Now:HH:mm:ss}] {message}");
    }

    protected override void Dispose(bool disposing)
    {
        if (disposing)
        {
            _clientService?.CloseAsync().GetAwaiter().GetResult();
        }
        base.Dispose(disposing);
    }
}
