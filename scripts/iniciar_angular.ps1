param(
    [string]$ProjectPath = "",
    [int]$Port = 4200,
    [switch]$SkipInstall,
    [switch]$SkipServe,
    [switch]$SkipBackend,
    [switch]$SkipIA,
    [switch]$NoHealthCheck
)

$ErrorActionPreference = "Stop"

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message"
}

function Write-Pass {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function Write-Warn {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Set-NodePath {
    $nodeDir = "C:\Program Files\nodejs"
    if (-not (Test-Path $nodeDir)) {
        throw "No existe $nodeDir. Instala Node.js LTS primero."
    }

    if ($env:Path -notmatch [regex]::Escape($nodeDir)) {
        $env:Path = "$nodeDir;$env:Path"
        Write-Info "PATH de esta sesión actualizado con $nodeDir"
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrWhiteSpace($userPath)) {
        [Environment]::SetEnvironmentVariable("Path", $nodeDir, "User")
        Write-Info "PATH de usuario inicializado con $nodeDir"
    }
    elseif ($userPath -notmatch [regex]::Escape($nodeDir)) {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$nodeDir", "User")
        Write-Info "PATH de usuario actualizado permanentemente con $nodeDir"
    }
    else {
        Write-Info "PATH de usuario ya contiene $nodeDir"
    }
}

function Test-LocalPortListening {
    param([int]$LocalPort)
    try {
        $listeners = Get-NetTCPConnection -LocalPort $LocalPort -State Listen -ErrorAction SilentlyContinue
        return $null -ne $listeners
    }
    catch {
        return $false
    }
}

function Wait-TcpPort {
    param(
        [string]$Host,
        [int]$Port,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $async = $client.BeginConnect($Host, $Port, $null, $null)
            if ($async.AsyncWaitHandle.WaitOne(1000, $false) -and $client.Connected) {
                $client.EndConnect($async)
                $client.Close()
                return $true
            }
            $client.Close()
        }
        catch {
        }
        Start-Sleep -Milliseconds 800
    }

    return $false
}

function Test-HttpEndpointReachable {
    param([string]$Url)

    try {
        $null = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 4
        return $true
    }
    catch {
        if ($_.Exception.Response) {
            return $true
        }
        return $false
    }
}

function Wait-HttpEndpoint {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 45
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if (Test-HttpEndpointReachable -Url $Url) {
            return $true
        }
        Start-Sleep -Milliseconds 800
    }

    return $false
}

function Start-ComponentTerminal {
    param(
        [string]$Name,
        [string]$WorkingDirectory,
        [string]$Command
    )

    Write-Info "Lanzando $Name en una nueva terminal"
    Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
        -WorkingDirectory $WorkingDirectory | Out-Null
}

try {
    $rootPath = Split-Path -Parent $PSScriptRoot

    if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
        $ProjectPath = Join-Path $rootPath "attendance-web"
    }

    $backendPath = Join-Path $rootPath "backend"
    $mlPath = Join-Path $rootPath "ml-model"
    $venvPython = Join-Path $rootPath ".venv\Scripts\python.exe"

    Set-NodePath

    $nodeVersion = & node -v
    $npmVersion = & npm.cmd -v
    Write-Pass "Node $nodeVersion y npm $npmVersion detectados"

    if (-not (Test-Path $ProjectPath)) {
        throw "No existe la carpeta Angular: $ProjectPath"
    }

    if (-not $SkipIA) {
        if (Test-LocalPortListening -LocalPort 50051) {
            Write-Pass "Servicio IA ya activo en :50051"
        }
        else {
            if (-not (Test-Path $mlPath)) {
                throw "No existe la carpeta IA: $mlPath"
            }

            $pythonExe = if (Test-Path $venvPython) { $venvPython } else { "python" }
            $iaCommand = "& '$pythonExe' 'face_server.py'"
            Start-ComponentTerminal -Name "IA gRPC" -WorkingDirectory $mlPath -Command $iaCommand

            if (-not $NoHealthCheck) {
                Write-Info "Esperando IA en localhost:50051"
                if (Wait-TcpPort -Host "127.0.0.1" -Port 50051 -TimeoutSeconds 60) {
                    Write-Pass "IA gRPC lista en :50051"
                }
                else {
                    throw "La IA no quedó disponible en :50051. Revisa la terminal de IA."
                }
            }
        }
    }
    else {
        Write-Warn "Saltando arranque IA por -SkipIA"
    }

    if (-not $SkipBackend) {
        if (Test-LocalPortListening -LocalPort 8080) {
            Write-Pass "Backend REST ya activo en :8080"
        }
        else {
            if (-not (Test-Path $backendPath)) {
                throw "No existe la carpeta backend: $backendPath"
            }

            Start-ComponentTerminal -Name "Backend Go" -WorkingDirectory $backendPath -Command "go run ."

            if (-not $NoHealthCheck) {
                $healthDate = (Get-Date).ToString("yyyy-MM-dd")
                Write-Info "Esperando backend en http://localhost:8080/api/attendance"
                if (Wait-HttpEndpoint -Url "http://localhost:8080/api/attendance?date=$healthDate" -TimeoutSeconds 60) {
                    Write-Pass "Backend REST listo en :8080"
                }
                else {
                    throw "El backend no respondió en :8080. Revisa la terminal de backend."
                }
            }
        }
    }
    else {
        Write-Warn "Saltando arranque backend por -SkipBackend"
    }

    Set-Location $ProjectPath
    if (-not (Test-Path "package.json")) {
        throw "No se encontró package.json en $ProjectPath"
    }

    if (-not $SkipInstall) {
        Write-Info "Ejecutando npm install"
        & npm.cmd install
        Write-Pass "Dependencias instaladas"
    }

    if (-not $SkipServe) {
        Write-Info "Iniciando Angular en puerto $Port"
        Write-Pass "Stack lista: IA :50051, Backend :8080, Frontend :$Port"
        & npx.cmd ng serve --host localhost --port $Port
    }
    else {
        Write-Pass "Preparación completada (sin ng serve por -SkipServe)"
    }
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
