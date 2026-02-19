param(
    [ValidateSet("dev", "prod", "all")]
    [string]$Mode = "all",
    [int]$DevPort = 4200,
    [int]$ProdPort = 4000,
    [switch]$SkipIA,
    [switch]$DryRun
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

function Stop-ProcessByIdSafe {
    param(
        [int]$ProcessId,
        [string]$Reason
    )

    if ($ProcessId -le 0 -or $ProcessId -eq $PID) {
        return $false
    }

    try {
        $proc = Get-Process -Id $ProcessId -ErrorAction Stop
    }
    catch {
        return $false
    }

    if ($DryRun) {
        Write-Info "[DryRun] Detendría PID $ProcessId ($($proc.ProcessName)) por $Reason"
        return $true
    }

    try {
        Stop-Process -Id $ProcessId -Force -ErrorAction Stop
        Write-Pass "Detenido PID $ProcessId ($($proc.ProcessName)) por $Reason"
        return $true
    }
    catch {
        Write-Warn "No se pudo detener PID $ProcessId ($($proc.ProcessName)): $($_.Exception.Message)"
        return $false
    }
}

function Get-PortsToStop {
    $ports = @()

    switch ($Mode) {
        "dev" {
            $ports += $DevPort
            $ports += 8080
            if (-not $SkipIA) {
                $ports += 50051
            }
        }
        "prod" {
            $ports += $ProdPort
            $ports += 8080
            if (-not $SkipIA) {
                $ports += 50051
            }
        }
        default {
            $ports += $DevPort
            $ports += $ProdPort
            $ports += 8080
            if (-not $SkipIA) {
                $ports += 50051
            }
        }
    }

    return ($ports | Sort-Object -Unique)
}

try {
    $ports = Get-PortsToStop
    $stopped = New-Object System.Collections.Generic.HashSet[int]
    $state = Load-RuntimeState

    Write-Info "Deteniendo stack BMPI (modo: $Mode)"
    Write-Info "Puertos objetivo: $($ports -join ', ')"

    if ($state.pids.Count -gt 0) {
        Write-Info "Intentando detener PIDs registrados: $($state.pids -join ', ')"
        foreach ($procId in $state.pids) {
            if ($stopped.Contains($procId)) {
                continue
            }

            if (Stop-ProcessByIdSafe -ProcessId $procId -Reason "runtime state") {
                $stopped.Add($procId) | Out-Null
            }
        }
    }

    foreach ($port in $ports) {
        $listeners = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
        if (-not $listeners) {
            Write-Info "Puerto $port sin listener activo"
            continue
        }

        $pids = $listeners | Select-Object -ExpandProperty OwningProcess -Unique
        foreach ($procId in $pids) {
            if ($stopped.Contains($procId)) {
                continue
            }

            if (Stop-ProcessByIdSafe -ProcessId $procId -Reason "puerto $port") {
                $stopped.Add($procId) | Out-Null
            }
        }
    }

    if ($stopped.Count -eq 0) {
        Write-Warn "No se encontraron procesos BMPI activos para detener."
    }
    else {
        Write-Pass "Procesos detenidos: $($stopped.Count)"
    }

    $alivePids = @()
    foreach ($procId in $state.pids) {
        if (Get-Process -Id $procId -ErrorAction SilentlyContinue) {
            $alivePids += $procId
        }
    }
    $state.pids = @($alivePids | Select-Object -Unique)
    Save-RuntimeState -State $state
}
catch {
    Write-Host "[FAIL] $($_.Exception.Message)" -ForegroundColor Red
    exit 1
}
