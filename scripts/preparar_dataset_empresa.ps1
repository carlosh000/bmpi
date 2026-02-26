param(
    [string]$DatasetRoot = "",
    [string]$EmployeeIdsFile = "",
    [string]$EmployeeIds = "",
    [int]$MinEmployees = 30,
    [int]$KnownPerEmployee = 5,
    [int]$GenuinePerEmployee = 10,
    [int]$ImpostorIdentityCount = 30,
    [int]$ImpostorPhotosPerIdentity = 10
)

$ErrorActionPreference = "Stop"

if (-not $PSBoundParameters.ContainsKey('EmployeeIds')) {
    $EmployeeIds = ""
}
if (-not $PSBoundParameters.ContainsKey('EmployeeIdsFile')) {
    $EmployeeIdsFile = ""
}

function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message"
}

function Write-Pass {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
}

function New-RequiredDirectory {
    param([string]$Path)
    New-Item -Path $Path -ItemType Directory -Force | Out-Null
}

try {
    $repoRoot = Split-Path -Parent $PSScriptRoot

    if ([string]::IsNullOrWhiteSpace($DatasetRoot)) {
        $stamp = Get-Date -Format "yyyyMMdd"
        $DatasetRoot = Join-Path $repoRoot ("datasets/empresa_eval_" + $stamp)
    }

    $resolvedDatasetRoot = [System.IO.Path]::GetFullPath($DatasetRoot)

    $rawIdEntries = @()
    $hasExplicitIds = $false

    if (-not [string]::IsNullOrWhiteSpace($EmployeeIds)) {
        $hasExplicitIds = $true
        $rawIdEntries += ($EmployeeIds -split "[,;\s]+")
    }

    if (-not [string]::IsNullOrWhiteSpace($EmployeeIdsFile)) {
        $hasExplicitIds = $true
        if (-not (Test-Path $EmployeeIdsFile)) {
            throw "No existe EmployeeIdsFile: $EmployeeIdsFile"
        }
        $rawIdEntries += Get-Content -Path $EmployeeIdsFile
    }

    $employeeIdList = @(
        $rawIdEntries |
        ForEach-Object { [string]$_ } |
        ForEach-Object { $_.Trim() } |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
        Select-Object -Unique
    )

    if (-not $hasExplicitIds) {
        $employeeIdList = @()
        for ($idx = 1; $idx -le $MinEmployees; $idx++) {
            $employeeIdList += ("{0:D4}" -f (1000 + $idx))
        }
    }

    if ($employeeIdList.Count -lt $MinEmployees) {
        throw "Se requieren al menos $MinEmployees empleados. Proporcionaste $($employeeIdList.Count)."
    }

    if ($KnownPerEmployee -lt 5) {
        throw "KnownPerEmployee debe ser >= 5."
    }
    if ($GenuinePerEmployee -lt 10) {
        throw "GenuinePerEmployee debe ser >= 10."
    }
    if ($ImpostorIdentityCount -lt 2) {
        throw "ImpostorIdentityCount debe ser >= 2."
    }

    Write-Info "IDs detectados: $($employeeIdList.Count)"

    $knownRoot = Join-Path $resolvedDatasetRoot "known"
    $genuineRoot = Join-Path $resolvedDatasetRoot "genuine"
    $impostorRoot = Join-Path $resolvedDatasetRoot "impostor"

    New-RequiredDirectory -Path $knownRoot
    New-RequiredDirectory -Path $genuineRoot
    New-RequiredDirectory -Path $impostorRoot

    $planRows = @()

    foreach ($employeeId in $employeeIdList) {
        $knownDir = Join-Path $knownRoot $employeeId
        $genuineDir = Join-Path $genuineRoot $employeeId

        New-RequiredDirectory -Path $knownDir
        New-RequiredDirectory -Path $genuineDir

        Set-Content -Path (Join-Path $knownDir "_CAPTURA_AQUI.txt") -Encoding UTF8 -Value "Coloca aqui al menos $KnownPerEmployee fotos del empleado $employeeId para known/."
        Set-Content -Path (Join-Path $genuineDir "_CAPTURA_AQUI.txt") -Encoding UTF8 -Value "Coloca aqui al menos $GenuinePerEmployee fotos del empleado $employeeId para genuine/."

        $planRows += [PSCustomObject]@{
            grupo = "known"
            identidad = $employeeId
            fotos_objetivo = $KnownPerEmployee
            estado = "pendiente"
        }
        $planRows += [PSCustomObject]@{
            grupo = "genuine"
            identidad = $employeeId
            fotos_objetivo = $GenuinePerEmployee
            estado = "pendiente"
        }
    }

    for ($idx = 1; $idx -le $ImpostorIdentityCount; $idx++) {
        $impostorId = "persona_{0:D3}" -f $idx
        $impostorDir = Join-Path $impostorRoot $impostorId
        New-RequiredDirectory -Path $impostorDir

        Set-Content -Path (Join-Path $impostorDir "_CAPTURA_AQUI.txt") -Encoding UTF8 -Value "Coloca aqui al menos $ImpostorPhotosPerIdentity fotos de impostor para $impostorId."

        $planRows += [PSCustomObject]@{
            grupo = "impostor"
            identidad = $impostorId
            fotos_objetivo = $ImpostorPhotosPerIdentity
            estado = "pendiente"
        }
    }

    $planPath = Join-Path $resolvedDatasetRoot "capture_plan.csv"
    $planRows | Export-Csv -Path $planPath -NoTypeInformation -Encoding UTF8

    $idsPath = Join-Path $resolvedDatasetRoot "employee_ids_used.txt"
    $employeeIdList | Set-Content -Path $idsPath -Encoding UTF8

    $metaPath = Join-Path $resolvedDatasetRoot "README_CAPTURA.md"
    $totalKnown = $employeeIdList.Count * $KnownPerEmployee
    $totalGenuine = $employeeIdList.Count * $GenuinePerEmployee
    $totalImpostor = $ImpostorIdentityCount * $ImpostorPhotosPerIdentity

    @(
        "# Dataset de evaluación empresarial BMPI",
        "",
        "- Ruta: $resolvedDatasetRoot",
        "- Empleados: $($employeeIdList.Count)",
        "- Objetivo known: $KnownPerEmployee por empleado (total mínimo: $totalKnown)",
        "- Objetivo genuine: $GenuinePerEmployee por empleado (total mínimo: $totalGenuine)",
        "- Objetivo impostor: $ImpostorPhotosPerIdentity por identidad (identidades: $ImpostorIdentityCount, total mínimo: $totalImpostor)",
        "",
        "## Estructura",
        "- known/<employee_id>/",
        "- genuine/<employee_id>/",
        "- impostor/persona_XXX/",
        "",
        "## Siguiente paso",
        "1) Sustituye los archivos _CAPTURA_AQUI.txt por fotos reales.",
        "2) Actualiza estados en capture_plan.csv.",
        ('3) Ejecuta: python scripts/evaluar_ia_empresa.py --dataset "{0}" --output reports/ia' -f $resolvedDatasetRoot)
    ) | Set-Content -Path $metaPath -Encoding UTF8

    Write-Pass "Dataset preparado en: $resolvedDatasetRoot"
    Write-Info "Plan de captura: $planPath"
    Write-Info "IDs usados: $idsPath"
    Write-Info "Guía local: $metaPath"
    exit 0
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
