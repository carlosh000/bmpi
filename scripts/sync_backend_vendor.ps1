param(
    [string]$BackendPath = "..\backend"
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetPath = Resolve-Path (Join-Path $scriptDir $BackendPath)
$goExe = "C:\Program Files\Go\bin\go.exe"

if (-not (Test-Path $goExe)) {
    throw "No se encontró Go en '$goExe'. Ajusta la ruta o instala Go."
}

Push-Location $targetPath
try {
    & $goExe mod tidy
    & $goExe mod vendor
    & $goExe test ./...
    Write-Host "✅ Vendor sincronizado y backend validado en $targetPath" -ForegroundColor Green
}
finally {
    Pop-Location
}
