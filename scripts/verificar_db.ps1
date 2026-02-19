param(
    [string]$PythonBin = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($PythonBin)) {
    $PythonBin = "C:/Users/practicante/Desktop/bmpi-main/.venv/Scripts/python.exe"
}

if (-not (Test-Path $PythonBin)) {
    throw "No se encontró Python en $PythonBin"
}

$scriptPath = Join-Path $PSScriptRoot "verificar_db.py"
if (-not (Test-Path $scriptPath)) {
    throw "No se encontró $scriptPath"
}

Write-Host "[INFO] Ejecutando verificación de DB con $PythonBin"
& $PythonBin $scriptPath
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAIL] Se detectaron problemas en la verificación de DB" -ForegroundColor Red
    exit $LASTEXITCODE
}

Write-Host "[PASS] Verificación de DB completada OK" -ForegroundColor Green
