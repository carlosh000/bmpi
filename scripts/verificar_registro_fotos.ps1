param(
    [string]$BackendUrl = "http://localhost:8080",
    [string]$EmployeeId = "200",
    [string]$EmployeeName = "Empleado Prueba",
    [string]$WorkDir = ""
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

function Ensure-BackendAlive {
    param([string]$Url)

    try {
        $null = Invoke-RestMethod -Method Get -Uri "$Url/api/attendance" -TimeoutSec 10
    }
    catch {
        throw "No se pudo conectar al backend en $Url. Asegúrate de tener backend + IA activos."
    }
}

function New-PhotoFile {
    param(
        [string]$TargetPath,
        [string]$SourceUrl
    )

    Invoke-WebRequest -Uri $SourceUrl -OutFile $TargetPath
}

function Convert-PhotosToPayloadFiles {
    param([System.IO.FileInfo[]]$Files)

    $payloadFiles = @()
    foreach ($file in $Files) {
        $bytes = [System.IO.File]::ReadAllBytes($file.FullName)
        $base64 = [Convert]::ToBase64String($bytes)
        $payloadFiles += [PSCustomObject]@{
            name = $file.Name
            data = $base64
        }
    }

    return $payloadFiles
}

function Invoke-RegisterPhotos {
    param(
        [string]$Url,
        [string]$Id,
        [string]$Name,
        [System.IO.FileInfo[]]$Files
    )

    $payload = [PSCustomObject]@{
        employeeName = $Name
        employeeId = $Id
        files = (Convert-PhotosToPayloadFiles -Files $Files)
    }

    $json = $payload | ConvertTo-Json -Depth 8 -Compress
    return Invoke-RestMethod -Method Post -Uri "$Url/api/employees/register-photos" -ContentType "application/json" -Body $json
}

function Get-HttpErrorDetail {
    param([System.Exception]$Exception)

    $detail = $Exception.Message

    try {
        $response = $Exception.Response
        if ($null -ne $response -and $response.GetResponseStream()) {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $body = $reader.ReadToEnd()
            if (-not [string]::IsNullOrWhiteSpace($body)) {
                $detail = "$detail | body: $body"
            }
        }
    }
    catch {
    }

    return $detail
}

function Test-OkCase {
    param(
        [string]$Url,
        [string]$Id,
        [string]$Name,
        [System.IO.FileInfo[]]$Files
    )

    if ($Files.Count -ne 5) {
        throw "Caso OK inválido: se esperaban 5 archivos y llegaron $($Files.Count)."
    }

    $response = Invoke-RegisterPhotos -Url $Url -Id $Id -Name $Name -Files $Files

    if (-not $response.saved -or $response.saved.Count -lt 1) {
        throw "Caso OK falló: la respuesta no incluyó registros guardados."
    }

    $saved = $response.saved[0]
    if ([int]$saved.photosProcessed -ne 5) {
        throw "Caso OK falló: photosProcessed esperado=5 real=$($saved.photosProcessed)."
    }

    if ([int]$saved.failedPhotos -ne 0) {
        throw "Caso OK falló: failedPhotos esperado=0 real=$($saved.failedPhotos)."
    }

    Write-Pass "Caso 5 fotos OK: procesadas=$($saved.photosProcessed), fallidas=$($saved.failedPhotos), employeeId=$($saved.employeeId)."
}

function Test-FailCase {
    param(
        [string]$Url,
        [string]$Id,
        [string]$Name,
        [System.IO.FileInfo[]]$Files
    )

    if ($Files.Count -ne 4) {
        throw "Caso FAIL inválido: se esperaban 4 archivos y llegaron $($Files.Count)."
    }

    try {
        $null = Invoke-RegisterPhotos -Url $Url -Id $Id -Name $Name -Files $Files
        throw "Caso FAIL no falló: el backend aceptó 4 fotos y debía rechazarlo."
    }
    catch {
        $message = Get-HttpErrorDetail -Exception $_.Exception
        $isExpected = $false
        if ($message -match "between 5 and 10|5 y 10|for precision") {
            $isExpected = $true
        }
        elseif ($message -match "\(400\)|400") {
            $isExpected = $true
        }

        if (-not $isExpected) {
            throw "Caso FAIL devolvió error inesperado: $message"
        }

        Write-Pass "Caso 4 fotos FAIL: backend rechazó correctamente por regla de precisión (5-10)."
    }
}

try {
    $root = Split-Path -Parent $PSScriptRoot
    $resolvedWorkDir = if ([string]::IsNullOrWhiteSpace($WorkDir)) {
        Join-Path $root "tmp-test-photos"
    }
    else {
        $WorkDir
    }

    New-Item -ItemType Directory -Force -Path $resolvedWorkDir | Out-Null

    Write-Info "Verificando backend en $BackendUrl"
    Ensure-BackendAlive -Url $BackendUrl
    Write-Pass "Backend accesible"

    $sourceUrl = "https://raw.githubusercontent.com/ageitgey/face_recognition/master/examples/obama.jpg"
    Write-Info "Descargando 5 fotos de prueba en $resolvedWorkDir"

    $allFiles = @()
    for ($i = 1; $i -le 5; $i++) {
        $path = Join-Path $resolvedWorkDir ("emp_{0}_{1}.jpg" -f $EmployeeId, $i)
        New-PhotoFile -TargetPath $path -SourceUrl $sourceUrl
        $allFiles += Get-Item $path
    }

    $okFiles = $allFiles
    $failFiles = $allFiles[0..3]

    Write-Info "Ejecutando prueba 1/2: 5 fotos (debe pasar)"
    Test-OkCase -Url $BackendUrl -Id $EmployeeId -Name $EmployeeName -Files $okFiles

    Write-Info "Ejecutando prueba 2/2: 4 fotos (debe fallar)"
    Test-FailCase -Url $BackendUrl -Id $EmployeeId -Name $EmployeeName -Files $failFiles

    Write-Host ""
    Write-Pass "Validación automática completada: OK (5 fotos PASS + 4 fotos FAIL)."
    exit 0
}
catch {
    Write-Host ""
    Write-Fail $_.Exception.Message
    exit 1
}
