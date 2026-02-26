param(
    [ValidateSet("dev", "prod")]
    [string]$Mode = "dev",
    [int]$DevPort = 4200,
    [int]$ProdPort = 4000,
    [string]$DevEnvFile = "",
    [switch]$SkipInstall,
    [switch]$SkipBuild,
    [switch]$SkipBackend,
    [switch]$SkipIA,
    [switch]$SkipFrontend,
    [switch]$NoHealthCheck,
    [switch]$AutoPrepareIA,
    [string]$EnvFile = ""
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

function Get-RuntimeStatePath {
    return Join-Path $PSScriptRoot ".bmpi-runtime.json"
}

function Load-RuntimeState {
    $statePath = Get-RuntimeStatePath
    if (-not (Test-Path $statePath)) {
        return @{
            updatedAt = ""
            pids = @()
        }
    }

    try {
        $raw = Get-Content -Path $statePath -Raw
        if ([string]::IsNullOrWhiteSpace($raw)) {
            return @{
                updatedAt = ""
                pids = @()
            }
        }

        $parsed = $raw | ConvertFrom-Json
        $pidList = @()
        if ($parsed.pids) {
            $pidList = @($parsed.pids | ForEach-Object { [int]$_ } | Select-Object -Unique)
        }

        return @{
            updatedAt = [string]$parsed.updatedAt
            pids = $pidList
        }
    }
    catch {
        return @{
            updatedAt = ""
            pids = @()
        }
    }
}

function Save-RuntimeState {
    param([hashtable]$State)

    $statePath = Get-RuntimeStatePath
    $State.updatedAt = (Get-Date).ToString("o")
    $json = $State | ConvertTo-Json -Depth 4
    Set-Content -Path $statePath -Value $json -Encoding UTF8
}

function Add-RuntimePid {
    param([int]$ProcessId)

    if ($ProcessId -le 0) {
        return
    }

    $state = Load-RuntimeState
    $current = @($state.pids)
    if ($current -notcontains $ProcessId) {
        $state.pids = @($current + $ProcessId | Select-Object -Unique)
        Save-RuntimeState -State $state
    }
}

function Set-NodePath {
    $nodeDir = "C:\Program Files\nodejs"
    if (-not (Test-Path $nodeDir)) {
        throw "No existe $nodeDir. Instala Node.js LTS primero."
    }

    if ($env:Path -notmatch [regex]::Escape($nodeDir)) {
        $env:Path = "$nodeDir;$env:Path"
    }

    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not [string]::IsNullOrWhiteSpace($userPath) -and $userPath -notmatch [regex]::Escape($nodeDir)) {
        [Environment]::SetEnvironmentVariable("Path", "$userPath;$nodeDir", "User")
    }
}

function Import-DotEnv {
    param([string]$Path)

    $vars = @{}
    foreach ($rawLine in Get-Content -Path $Path) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) {
            continue
        }

        $separator = $line.IndexOf("=")
        if ($separator -lt 1) {
            continue
        }

        $key = $line.Substring(0, $separator).Trim()
        $value = $line.Substring($separator + 1).Trim()

        if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
            $value = $value.Substring(1, $value.Length - 2)
        }

        $vars[$key] = $value
    }

    return $vars
}

function Set-EnvironmentVariables {
    param([hashtable]$Vars)

    foreach ($key in $Vars.Keys) {
        [Environment]::SetEnvironmentVariable($key, $Vars[$key], "Process")
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
        [string]$TargetAddress,
        [int]$Port,
        [int]$TimeoutSeconds = 60
    )

    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $client = New-Object System.Net.Sockets.TcpClient
            $async = $client.BeginConnect($TargetAddress, $Port, $null, $null)
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
        [int]$TimeoutSeconds = 60
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
    $proc = Start-Process -FilePath "powershell.exe" `
        -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $Command) `
        -WorkingDirectory $WorkingDirectory `
        -PassThru

    if ($proc -and $proc.Id) {
        Add-RuntimePid -ProcessId ([int]$proc.Id)
    }
}

try {
    $rootPath = Split-Path -Parent $PSScriptRoot
    $scriptsPath = $PSScriptRoot
    $attendancePath = Join-Path $rootPath "attendance-web"
    $backendPath = Join-Path $rootPath "backend"
    $mlPath = Join-Path $rootPath "ml-model"
    $venvPython = Join-Path $rootPath ".venv\Scripts\python.exe"
    $binPath = Join-Path $rootPath "bin"
    $backendExe = Join-Path $binPath "bmpi-backend.exe"
    $iaPrepScript = Join-Path $scriptsPath "preparar_entorno_ia.ps1"

    if (-not (Test-Path $attendancePath)) {
        throw "No existe carpeta attendance-web en $rootPath"
    }
    if (-not (Test-Path $backendPath)) {
        throw "No existe carpeta backend en $rootPath"
    }
    if (-not (Test-Path $mlPath)) {
        throw "No existe carpeta ml-model en $rootPath"
    }

    if (-not $SkipIA -and -not (Test-Path $venvPython)) {
        if ($AutoPrepareIA) {
            if (-not (Test-Path $iaPrepScript)) {
                throw "No existe script para preparar IA: $iaPrepScript"
            }

            Write-Info "No existe .venv. Preparando entorno IA automáticamente"
            & $iaPrepScript
            if ($LASTEXITCODE -ne 0) {
                throw "Falló la preparación automática del entorno IA"
            }
        }
        else {
            Write-Warn "No existe .venv y la IA está habilitada."
            Write-Warn "Ejecuta scripts/preparar_entorno_ia.ps1 o usa -AutoPrepareIA"
        }
    }

    Set-NodePath
    $nodeVersion = & node -v
    $npmVersion = & npm.cmd -v
    Write-Pass "Node $nodeVersion y npm $npmVersion detectados"

    if ($Mode -eq "dev") {
        Write-Info "Modo desarrollo: inicia IA + backend + Angular (ng serve)"

        if ([string]::IsNullOrWhiteSpace($DevEnvFile)) {
            $DevEnvFile = Join-Path $scriptsPath ".env.dev"
        }

        if (Test-Path $DevEnvFile) {
            Write-Info "Cargando variables de desarrollo desde $DevEnvFile"
            $devEnvMap = Import-DotEnv -Path $DevEnvFile
            Set-EnvironmentVariables -Vars $devEnvMap

            if (-not $devEnvMap.ContainsKey("BMPI_OPERATOR_API_KEY")) {
                [Environment]::SetEnvironmentVariable("BMPI_OPERATOR_API_KEY", $null, "Process")
            }
            if (-not $devEnvMap.ContainsKey("BMPI_ADMIN_API_KEY")) {
                [Environment]::SetEnvironmentVariable("BMPI_ADMIN_API_KEY", $null, "Process")
            }
        }
        else {
            Write-Warn "No existe $DevEnvFile (opcional para desarrollo)."
        }

        if (-not $SkipIA) {
            if ([string]::IsNullOrWhiteSpace($env:DB_PASSWORD)) {
                throw "IA requiere DB_PASSWORD para conectar PostgreSQL. Crea scripts/.env.dev (puedes copiar scripts/.env.dev.example) y define DB_PASSWORD."
            }
            if ($env:DB_PASSWORD -match "^REEMPLAZAR") {
                throw "DB_PASSWORD en scripts/.env.dev sigue como placeholder. Reemplázalo con tu password real de PostgreSQL."
            }

            if (Test-LocalPortListening -LocalPort 50051) {
                Write-Pass "Servicio IA ya activo en :50051"
            }
            else {
                $pythonExe = if (Test-Path $venvPython) { $venvPython } else { "python" }
                Start-ComponentTerminal -Name "IA gRPC" -WorkingDirectory $mlPath -Command "& '$pythonExe' 'face_server.py'"

                if (-not $NoHealthCheck) {
                    Write-Info "Esperando IA en localhost:50051"
                    if (-not (Wait-TcpPort -TargetAddress "127.0.0.1" -Port 50051 -TimeoutSeconds 60)) {
                        throw "La IA no quedó disponible en :50051"
                    }
                    Write-Pass "IA gRPC lista en :50051"
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
                Start-ComponentTerminal -Name "Backend Go" -WorkingDirectory $backendPath -Command "go run ."

                if (-not $NoHealthCheck) {
                    $healthDate = (Get-Date).ToString("yyyy-MM-dd")
                    Write-Info "Esperando backend en http://localhost:8080/api/attendance"
                    if (-not (Wait-HttpEndpoint -Url "http://localhost:8080/api/attendance?date=$healthDate" -TimeoutSeconds 60)) {
                        throw "El backend no respondió en :8080"
                    }
                    Write-Pass "Backend REST listo en :8080"
                }
            }
        }
        else {
            Write-Warn "Saltando arranque backend por -SkipBackend"
        }

        Set-Location $attendancePath
        if (-not (Test-Path "package.json")) {
            throw "No se encontró package.json en $attendancePath"
        }

        if (-not $SkipInstall) {
            Write-Info "Ejecutando npm install"
            & npm.cmd install
            Write-Pass "Dependencias instaladas"
        }

        if (-not $SkipFrontend) {
            Write-Info "Iniciando Angular en puerto $DevPort"
            Write-Pass "Stack lista: IA :50051, Backend :8080, Frontend :$DevPort"
            & npx.cmd ng serve --host localhost --port $DevPort
        }
        else {
            Write-Pass "Preparación completada (sin ng serve por -SkipFrontend)"
        }

        exit 0
    }

    Write-Info "Modo producción: inicia IA + backend + frontend SSR"

    if ([string]::IsNullOrWhiteSpace($EnvFile)) {
        $EnvFile = Join-Path $scriptsPath ".env.production"
    }

    if (-not (Test-Path $EnvFile)) {
        $envExample = Join-Path $scriptsPath ".env.production.example"
        if (Test-Path $envExample) {
            Copy-Item -Force $envExample $EnvFile
            throw "Se creó $EnvFile desde ejemplo. Completa credenciales reales y vuelve a ejecutar."
        }
        throw "No existe archivo de entorno para producción: $EnvFile"
    }

    $envMap = Import-DotEnv -Path $EnvFile
    $envMap["BMPI_ENV"] = "production"
    if (-not $envMap["BMPI_HTTP_ADDR"]) { $envMap["BMPI_HTTP_ADDR"] = ":8080" }
    if (-not $envMap["BMPI_FACE_GRPC_ADDR"]) { $envMap["BMPI_FACE_GRPC_ADDR"] = "127.0.0.1:50051" }
    if (-not $envMap["BMPI_FACE_GRPC_TLS"]) { $envMap["BMPI_FACE_GRPC_TLS"] = "false" }
    if (-not $envMap["BMPI_API_BASE_URL"]) { $envMap["BMPI_API_BASE_URL"] = "http://127.0.0.1:8080" }
    if (-not $envMap["BMPI_ALLOWED_ORIGINS"]) { $envMap["BMPI_ALLOWED_ORIGINS"] = "http://localhost:$ProdPort,http://127.0.0.1:$ProdPort" }

    $requiredVars = @(
        "DB_HOST",
        "DB_NAME",
        "DB_USER",
        "DB_PASSWORD",
        "BMPI_OPERATOR_API_KEY",
        "BMPI_ADMIN_API_KEY"
    )

    $missingVars = @()
    foreach ($required in $requiredVars) {
        if ([string]::IsNullOrWhiteSpace($envMap[$required])) {
            $missingVars += $required
        }
    }

    if ($missingVars.Count -gt 0) {
        throw "Faltan variables requeridas para producción: $($missingVars -join ', ')"
    }

    Set-EnvironmentVariables -Vars $envMap

    $goVersion = & go version
    Write-Pass "$goVersion"

    if (-not $SkipBuild) {
        Set-Location $attendancePath
        if (-not (Test-Path (Join-Path $attendancePath "node_modules"))) {
            Write-Info "Instalando dependencias frontend"
            & npm.cmd install
        }

        Write-Info "Compilando Angular SSR para producción"
        & npm.cmd run build -- --configuration production
        Write-Pass "Build frontend completado"
    }

    if (-not $SkipIA) {
        if (Test-LocalPortListening -LocalPort 50051) {
            Write-Pass "Servicio IA ya activo en :50051"
        }
        else {
            if (-not (Test-Path $venvPython)) {
                throw "No existe $venvPython. Ejecuta scripts/preparar_entorno_ia.ps1 o usa -AutoPrepareIA."
            }

            Start-ComponentTerminal -Name "IA gRPC" -WorkingDirectory $mlPath -Command "& '$venvPython' 'face_server.py'"
            if (-not $NoHealthCheck) {
                Write-Info "Esperando IA gRPC en :50051"
                if (-not (Wait-TcpPort -TargetAddress "127.0.0.1" -Port 50051 -TimeoutSeconds 90)) {
                    throw "La IA no quedó disponible en :50051"
                }
                Write-Pass "IA gRPC lista"
            }
        }
    }
    else {
        Write-Warn "Saltando IA por -SkipIA"
    }

    if (-not $SkipBackend) {
        if (Test-LocalPortListening -LocalPort 8080) {
            Write-Pass "Backend ya activo en :8080"
        }
        else {
            if (-not (Test-Path $binPath)) {
                New-Item -ItemType Directory -Path $binPath | Out-Null
            }

            Set-Location $backendPath
            Write-Info "Compilando backend Go"
            & go build -o $backendExe .

            Start-ComponentTerminal -Name "Backend Go" -WorkingDirectory $backendPath -Command "& '$backendExe'"
            if (-not $NoHealthCheck) {
                $healthDate = (Get-Date).ToString("yyyy-MM-dd")
                Write-Info "Esperando backend REST en :8080"
                if (-not (Wait-HttpEndpoint -Url "http://127.0.0.1:8080/api/attendance?date=$healthDate" -TimeoutSeconds 90)) {
                    throw "El backend no respondió en :8080"
                }
                Write-Pass "Backend REST listo"
            }
        }
    }
    else {
        Write-Warn "Saltando backend por -SkipBackend"
    }

    if (-not $SkipFrontend) {
        $frontendServerFile = Join-Path $attendancePath "dist\attendance-web\server\server.mjs"
        if (-not (Test-Path $frontendServerFile)) {
            throw "No existe $frontendServerFile. Ejecuta sin -SkipBuild."
        }

        if (Test-LocalPortListening -LocalPort $ProdPort) {
            Write-Pass "Frontend SSR ya activo en :$ProdPort"
        }
        else {
            $frontendCommand = "$env:PORT=$ProdPort; $env:BMPI_API_BASE_URL='$($envMap['BMPI_API_BASE_URL'])'; node 'dist/attendance-web/server/server.mjs'"
            Start-ComponentTerminal -Name "Frontend SSR" -WorkingDirectory $attendancePath -Command $frontendCommand
            if (-not $NoHealthCheck) {
                Write-Info "Esperando frontend SSR en :$ProdPort"
                if (-not (Wait-HttpEndpoint -Url "http://127.0.0.1:$ProdPort" -TimeoutSeconds 90)) {
                    throw "El frontend no respondió en :$ProdPort"
                }
                Write-Pass "Frontend SSR listo"
            }
        }
    }
    else {
        Write-Warn "Saltando frontend por -SkipFrontend"
    }

    Write-Host ""
    if ($SkipIA -and $SkipBackend -and $SkipFrontend) {
        Write-Pass "Validación de entorno $Mode completada (sin procesos iniciados)"
    }
    else {
        Write-Pass "Stack $Mode levantada"
    }
    $activeFrontendPort = $ProdPort
    if ($Mode -eq "dev") {
        $activeFrontendPort = $DevPort
    }
    Write-Host "Frontend: http://localhost:$activeFrontendPort" -ForegroundColor Cyan
    Write-Host "Backend:  http://localhost:8080" -ForegroundColor Cyan
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
