param(
    [string]$Dataset,
    [string]$Output = "reports/ia",
    [string]$PythonBin = "",
    [switch]$UpdatePlanStatus,
    [switch]$AllowInsufficientDataset,
    [double]$BlurMin = 80,
    [double]$BrightnessMin = 60,
    [double]$BrightnessMax = 200,
    [double]$FaceHeightRatioMin = 0.20,
    [double]$FaceAreaRatioMin = 0.06,
    [double]$CenterDistanceRatioMax = 0.35,
    [int]$Upsample = 1,
    [string]$Thresholds = "0.45,0.50,0.55,0.60",
    [switch]$SkipEvaluation
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

function Write-Fail {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
}

function Resolve-PythonBin {
    param(
        [string]$RepoRoot,
        [string]$InputPythonBin
    )

    if (-not [string]::IsNullOrWhiteSpace($InputPythonBin)) {
        return $InputPythonBin
    }

    $venvPython = Join-Path $RepoRoot ".venv/Scripts/python.exe"
    if (Test-Path $venvPython) {
        return $venvPython
    }

    return "python"
}

function Invoke-Step {
    param(
        [string]$Name,
        [scriptblock]$Command
    )

    Write-Info "Paso: $Name"
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Paso falló: $Name (exit=$LASTEXITCODE)"
    }
    Write-Pass "Paso completado: $Name"
}

function Get-ImageCount {
    param([string]$DatasetPath)

    $exts = @('.jpg', '.jpeg', '.png', '.bmp', '.webp')
    $files = Get-ChildItem -Path $DatasetPath -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object {
            ($exts -contains $_.Extension.ToLower()) -and ($_.FullName -match '[\\/](known|genuine|impostor)[\\/]')
        }

    return @($files).Count
}

try {
    $repoRoot = Split-Path -Parent $PSScriptRoot

    if ([string]::IsNullOrWhiteSpace($Dataset)) {
        throw "Debes indicar -Dataset (ej: datasets/empresa_eval_20260224)"
    }

    $datasetPath = if ([System.IO.Path]::IsPathRooted($Dataset)) { $Dataset } else { Join-Path $repoRoot $Dataset }
    $datasetPath = [System.IO.Path]::GetFullPath($datasetPath)

    if (-not (Test-Path $datasetPath)) {
        throw "Dataset no encontrado: $datasetPath"
    }

    $outputPath = if ([System.IO.Path]::IsPathRooted($Output)) { $Output } else { Join-Path $repoRoot $Output }
    $outputPath = [System.IO.Path]::GetFullPath($outputPath)
    New-Item -ItemType Directory -Force -Path $outputPath | Out-Null

    $pythonExe = Resolve-PythonBin -RepoRoot $repoRoot -InputPythonBin $PythonBin
    Write-Info "Python: $pythonExe"
    Write-Info "Dataset: $datasetPath"
    Write-Info "Output: $outputPath"

    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $summary = [ordered]@{
        ok = $true
        timestamp = $stamp
        dataset = $datasetPath
        output = $outputPath
        steps = @()
    }

    $capturePlanPath = Join-Path $datasetPath "capture_plan.csv"
    $step1 = [ordered]@{ name = "verificar_dataset"; status = "skipped"; reason = "sin_capture_plan" }
    $summary.steps += $step1
    if (Test-Path $capturePlanPath) {
        $step1.status = "pending"
        $step1.Remove("reason")
        Invoke-Step -Name "Verificación de avance del dataset" -Command {
            $args = @("scripts/verificar_dataset_empresa.py", "--dataset", $datasetPath, "--output", $outputPath)
            if ($UpdatePlanStatus) {
                $args += "--update-plan-status"
            }
            & $pythonExe @args
        }
        $step1.status = "ok"
    }
    else {
        Write-Warn "No existe capture_plan.csv en el dataset; se omite verificar_dataset_empresa.py"
    }

    $imageCount = Get-ImageCount -DatasetPath $datasetPath
    Write-Info "Imágenes detectadas en known/genuine/impostor: $imageCount"

    $step2 = [ordered]@{ name = "verificar_calidad_fotos"; status = "skipped"; reason = "sin_imagenes" }
    $summary.steps += $step2

    if ($imageCount -gt 0) {
        $step2.status = "pending"
        $step2.Remove("reason")
        Invoke-Step -Name "Verificación de calidad de fotos" -Command {
            & $pythonExe "scripts/verificar_calidad_fotos.py" `
                --dataset $datasetPath `
                --output $outputPath `
                --upsample $Upsample `
                --blur-min $BlurMin `
                --brightness-min $BrightnessMin `
                --brightness-max $BrightnessMax `
                --face-height-ratio-min $FaceHeightRatioMin `
                --face-area-ratio-min $FaceAreaRatioMin `
                --center-distance-ratio-max $CenterDistanceRatioMax
        }
        $step2.status = "ok"
    }
    else {
        Write-Warn "Se omite calidad/evaluación porque no hay imágenes todavía."
    }

    $step3 = [ordered]@{ name = "evaluar_ia_empresa"; status = "skipped"; reason = "sin_imagenes" }
    $summary.steps += $step3

    if ($SkipEvaluation) {
        $step3.reason = "skip_evaluation"
        Write-Warn "Se omite evaluación FAR/FRR por parámetro -SkipEvaluation"
    }
    elseif ($imageCount -gt 0) {
        $step3.status = "pending"
        $step3.Remove("reason")
        Invoke-Step -Name "Evaluación FAR/FRR por umbral" -Command {
            $evalArgs = @(
                "scripts/evaluar_ia_empresa.py",
                "--dataset", $datasetPath,
                "--output", $outputPath,
                "--thresholds", $Thresholds
            )
            if ($AllowInsufficientDataset) {
                $evalArgs += "--allow-insufficient-dataset"
            }
            & $pythonExe @evalArgs
        }
        $step3.status = "ok"
    }

    $summaryPath = Join-Path $outputPath ("diagnostico_dataset_" + $stamp + ".json")
    $summaryMdPath = Join-Path $outputPath ("diagnostico_dataset_" + $stamp + ".md")

    ($summary | ConvertTo-Json -Depth 6) | Set-Content -Path $summaryPath -Encoding UTF8

    $tick = [char]96
    $mdLines = @(
        "# Diagnóstico dataset empresarial",
        "",
        "- Fecha: " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss"),
        ("- Dataset: " + $tick + $datasetPath + $tick),
        ("- Output: " + $tick + $outputPath + $tick),
        "",
        "## Pasos",
        ""
    )

    foreach ($step in $summary.steps) {
        if ($step.status -eq "ok") {
            $mdLines += "- [OK] $($step.name)"
        }
        elseif ($step.status -eq "skipped") {
            $mdLines += "- [SKIP] $($step.name) ($($step.reason))"
        }
        else {
            $mdLines += "- [PEND] $($step.name)"
        }
    }

    $mdLines += ""
    $mdLines += "## Resultado"
    $mdLines += ""
    $mdLines += "- Listo para ejecutar recaptura/evaluación con un solo comando."

    $mdLines | Set-Content -Path $summaryMdPath -Encoding UTF8

    Write-Pass "Diagnóstico completo"
    Write-Info "Resumen JSON: $summaryPath"
    Write-Info "Resumen MD: $summaryMdPath"
    exit 0
}
catch {
    Write-Fail $_.Exception.Message
    exit 1
}
