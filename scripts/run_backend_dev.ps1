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
$goExe = "C:\Program Files\Go\bin\go.exe"
$goCache = Join-Path $rootPath ".gocache"
$goModCache = Join-Path $rootPath ".gomodcache"

if (-not (Test-Path $goCache)) {
    New-Item -ItemType Directory -Path $goCache | Out-Null
}
if (-not (Test-Path $goModCache)) {
    New-Item -ItemType Directory -Path $goModCache | Out-Null
}

if (-not (Test-Path $goExe)) {
    throw "No se encontro go.exe en $goExe"
}

$env:GOCACHE = $goCache
$env:GOMODCACHE = $goModCache

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

Set-Location $backendPath
& $goExe run .
