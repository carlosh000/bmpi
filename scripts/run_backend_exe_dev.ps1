param(
    [string]$EnvFile = ""
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($EnvFile)) {
    $EnvFile = Join-Path $PSScriptRoot ".env.dev"
}

if (-not (Test-Path $EnvFile)) {
    throw "No existe archivo de entorno: $EnvFile"
}

$rootPath = Split-Path -Parent $PSScriptRoot
$backendPath = Join-Path $rootPath "backend"
$backendExe = Join-Path $backendPath "backend.exe"

foreach ($rawLine in Get-Content -Path $EnvFile) {
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
    [Environment]::SetEnvironmentVariable($key, $value, "Process")
}

if (-not (Test-Path $backendExe)) {
    throw "No se encontro backend.exe en $backendExe. Ejecuta scripts/iniciar_bmpi.ps1 para compilar."
}

Set-Location $backendPath
& $backendExe
