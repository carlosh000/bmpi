param(
    [switch]$ForceRecreate,
    [switch]$OnlyVerify,
    [string]$VenvPath = ""
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

function Write-Fail {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Resolve-PythonExe {
    $cmd = Get-Command python -ErrorAction SilentlyContinue
    if ($cmd -and $cmd.Source) {
        return $cmd.Source
    }

    $candidates = @(
        "C:\Users\practicante\AppData\Local\Programs\Python\Python310\python.exe",
        "C:\Users\practicante\AppData\Local\Programs\Python\Python311\python.exe",
        "C:\Python310\python.exe",
        "C:\Python311\python.exe"
    )

    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    throw "No se encontró Python instalado. Instala Python 3.10+ primero."
}

try {
    $root = Split-Path -Parent $PSScriptRoot
    $mlDir = Join-Path $root "ml-model"
    if (-not (Test-Path $mlDir)) {
        throw "No existe carpeta ml-model en $root"
    }

    if ([string]::IsNullOrWhiteSpace($VenvPath)) {
        $VenvPath = Join-Path $root ".venv"
    }

    $pyInstaller = Resolve-PythonExe
    Write-Info "Python base detectado: $pyInstaller"

    if ($ForceRecreate -and (Test-Path $VenvPath)) {
        Write-Info "Eliminando venv existente: $VenvPath"
        Remove-Item -Recurse -Force $VenvPath
    }

    if (-not (Test-Path $VenvPath)) {
        Write-Info "Creando entorno virtual en $VenvPath"
        & $pyInstaller -m venv $VenvPath
    }

    $venvPython = Join-Path $VenvPath "Scripts\python.exe"
    if (-not (Test-Path $venvPython)) {
        throw "No se encontró python del venv en $venvPython"
    }

    Write-Info "Actualizando herramientas base de pip"
    & $venvPython -m pip install --upgrade pip

    if (-not $OnlyVerify) {
        Write-Info "Instalando dependencias IA compatibles para Windows"
        & $venvPython -m pip install --upgrade "setuptools<81" wheel
        $packages = @(
            "numpy>=1.20.0",
            "Pillow>=8.0.0",
            "opencv-python>=4.5.0",
            "grpcio>=1.60.0",
            "grpcio-tools>=1.60.0",
            "psycopg2-binary>=2.9.0",
            "dlib-bin>=19.24.6",
            "face-recognition-models>=0.3.0",
            "click>=8.0.0",
            "colorama>=0.4.6"
        )
        & $venvPython -m pip install --upgrade @packages

        Write-Info "Instalando face-recognition sin compilar dlib"
        & $venvPython -m pip install --upgrade "face-recognition==1.3.0" --no-deps
    }

    Write-Info "Validando imports críticos"
    & $venvPython -c "import cv2, face_recognition, grpc, numpy, psycopg2; print('imports_ok')"

    Write-Info "Validando sintaxis de face_server.py"
    & $venvPython -m py_compile (Join-Path $mlDir "face_server.py")

    Write-Host ""
    Write-Pass "Entorno IA listo."
    Write-Host "Usa este Python en VS Code:" -ForegroundColor Cyan
    Write-Host "$venvPython" -ForegroundColor Cyan
    exit 0
}
catch {
    Write-Host ""
    Write-Fail $_.Exception.Message
    exit 1
}
