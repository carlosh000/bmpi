param(
    [string]$EmployeeId = "9500",
    [string]$EmployeeName = "Prod Smoke",
    [string]$PhotoDir = "datasets/empresa_eval_20260220/known/200",
    [string]$BackendUrl = "http://localhost:8080"
)

$ErrorActionPreference = "Stop"

function Load-ProdOperatorKey {
    param([string]$RepoRoot)

    $envFile = Join-Path $RepoRoot "scripts/.env.production"
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

    $key = [string]$envMap["BMPI_OPERATOR_API_KEY"]
    if ([string]::IsNullOrWhiteSpace($key)) {
        throw "BMPI_OPERATOR_API_KEY no está definido en scripts/.env.production"
    }

    return $key
}

try {
    $repoRoot = Split-Path -Parent $PSScriptRoot
    $opKey = Load-ProdOperatorKey -RepoRoot $repoRoot

    $resolvedPhotoDir = if ([System.IO.Path]::IsPathRooted($PhotoDir)) { $PhotoDir } else { Join-Path $repoRoot $PhotoDir }
    if (-not (Test-Path $resolvedPhotoDir)) {
        throw "No existe PhotoDir: $resolvedPhotoDir"
    }

    $files = Get-ChildItem -Path $resolvedPhotoDir -Filter *.jpg | Sort-Object Name | Select-Object -First 5
    if ($files.Count -lt 5) {
        throw "Se requieren al menos 5 fotos .jpg en $resolvedPhotoDir"
    }

    $payload = [pscustomobject]@{
        employeeId = $EmployeeId
        employeeName = $EmployeeName
        files = @($files | ForEach-Object {
            [pscustomobject]@{
                name = $_.Name
                data = [Convert]::ToBase64String([IO.File]::ReadAllBytes($_.FullName))
            }
        })
    } | ConvertTo-Json -Depth 8 -Compress

    $headers = @{ "X-API-Key" = $opKey }

    $register = Invoke-RestMethod -Method Post -Uri "$BackendUrl/api/employees/register-photos" -Headers $headers -ContentType "application/json" -Body $payload -TimeoutSec 180
    $storage = Invoke-RestMethod -Method Get -Uri "$BackendUrl/api/employees/storage" -Headers $headers
    $employees = Invoke-RestMethod -Method Get -Uri "$BackendUrl/api/employees" -Headers $headers

    $row = $storage | Where-Object { $_.employee_id -eq $EmployeeId } | Select-Object -First 1
    $cacheRow = $employees | Where-Object { $_.employee_id -eq $EmployeeId } | Select-Object -First 1

    $result = [ordered]@{
        ok = $true
        register = $register
        storage = $row
        cache_visible = [bool]$cacheRow
        checks = [ordered]@{
            saved_ok = ($register.saved.Count -gt 0)
            no_failures = (($register.saved | Measure-Object -Sum failedPhotos).Sum -eq 0)
            embedding_saved = ($null -ne $row -and [int]$row.embedding_bytes -gt 0)
            photo_saved = ($null -ne $row -and [int]$row.photo_bytes -gt 0)
            cache_visible = [bool]$cacheRow
        }
    }

    $result | ConvertTo-Json -Depth 8
    exit 0
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
