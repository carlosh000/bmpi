param(
    [string]$BackendUrl = "http://localhost:8080",
    [string]$Username = "",
    [string]$Password = "",
    [string]$EnvFile = "scripts/.env.production"
)

$ErrorActionPreference = "Stop"

function Load-EnvUserPass {
    param([string]$RepoRoot, [string]$EnvFilePath)

    $envFile = if ([System.IO.Path]::IsPathRooted($EnvFilePath)) { $EnvFilePath } else { Join-Path $RepoRoot $EnvFilePath }
    if (-not (Test-Path $envFile)) {
        throw "No existe $envFile"
    }

    $envMap = @{}
    Get-Content $envFile | ForEach-Object {
        $line = $_.Trim()
        if ($line -eq "" -or $line.StartsWith("#")) { return }
        $parts = $line.Split("=", 2)
        if ($parts.Count -eq 2) {
            $envMap[$parts[0].Trim()] = $parts[1].Trim().Trim('"').Trim("'")
        }
    }

    $user = [string]$envMap["BMPI_SMOKE_USER"]
    $pass = [string]$envMap["BMPI_SMOKE_PASS"]
    if ([string]::IsNullOrWhiteSpace($user)) { $user = [string]$envMap["BMPI_BOOTSTRAP_ADMIN_USER"] }
    if ([string]::IsNullOrWhiteSpace($pass)) { $pass = [string]$envMap["BMPI_BOOTSTRAP_ADMIN_PASS"] }

    return @{ user = $user; pass = $pass }
}

try {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    if ([string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrWhiteSpace($Password)) {
        $creds = Load-EnvUserPass -RepoRoot $repoRoot -EnvFilePath $EnvFile
        if ([string]::IsNullOrWhiteSpace($Username)) { $Username = $creds.user }
        if ([string]::IsNullOrWhiteSpace($Password)) { $Password = $creds.pass }
    }

    if ([string]::IsNullOrWhiteSpace($Username) -or [string]::IsNullOrWhiteSpace($Password)) {
        throw "No hay credenciales. Usa -Username/-Password o define BMPI_SMOKE_USER/BMPI_SMOKE_PASS."
    }

    $payload = @{ username = $Username; password = $Password } | ConvertTo-Json -Depth 4 -Compress
    $login = Invoke-RestMethod -Method Post -Uri "$BackendUrl/api/auth/login" -ContentType "application/json" -Body $payload -TimeoutSec 20

    if (-not $login.token) {
        throw "Login sin token."
    }

    $result = [ordered]@{
        token = $login.token
        role = $login.role
        username = $login.username
        expiresAt = $login.expiresAt
    }

    $result | ConvertTo-Json -Depth 4
    exit 0
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
