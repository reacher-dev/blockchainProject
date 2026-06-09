param(
    [string]$Port = "auto",
    [int]$BackendPort = 8000,
    [int]$BackgroundSeconds = 0
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$OracleScript = Join-Path $ScriptDir "web3_oracle.py"
$PicoScript = Join-Path $ScriptDir "pico_noise_sender.py"
$BackendOutLog = Join-Path $ScriptDir "web3_oracle.instant.out.log"
$BackendErrLog = Join-Path $ScriptDir "web3_oracle.instant.err.log"

$OriginalPicoScriptContent = $null
$PicoScriptModified = $false

function Stop-Backend {
    Write-Host "`nStopping backend oracle on port $BackendPort..."
    $connections = Get-NetTCPConnection -LocalPort $BackendPort -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
    }
}

try {
    $existing = Get-NetTCPConnection -LocalPort $BackendPort -ErrorAction SilentlyContinue
    if ($existing) {
        Write-Host "Found existing process on port $BackendPort. Cleaning up..."
        foreach ($conn in $existing) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    }

    $OriginalPicoScriptContent = Get-Content $PicoScript -Raw
    $TempContent = $OriginalPicoScriptContent
    if ($TempContent -match "ENABLE_MIC_TEST_UPLOAD = False") {
        Write-Host "Temporarily enabling ENABLE_MIC_TEST_UPLOAD for instant model chunks..."
        $TempContent = $TempContent -replace "ENABLE_MIC_TEST_UPLOAD = False", "ENABLE_MIC_TEST_UPLOAD = True"
        $PicoScriptModified = $true
    }
    if ($BackgroundSeconds -gt 0) {
        Write-Host "Temporarily forcing recording for $BackgroundSeconds seconds..."
        $TempContent = $TempContent -replace "MIC_TEST_FORCE_RECORD_SECONDS = \d+", "MIC_TEST_FORCE_RECORD_SECONDS = $BackgroundSeconds"
        $PicoScriptModified = $true
    }
    if ($PicoScriptModified) {
        [System.IO.File]::WriteAllText($PicoScript, $TempContent, (New-Object System.Text.UTF8Encoding($false)))
    }

    Write-Host "Starting backend oracle on port $BackendPort..."
    $env:ORACLE_PORT = [string]$BackendPort
    $BackendProcess = Start-Process `
        -FilePath "python" `
        -ArgumentList @($OracleScript) `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $BackendOutLog `
        -RedirectStandardError $BackendErrLog `
        -WindowStyle Hidden `
        -PassThru

    Start-Sleep -Seconds 2
    if ($BackendProcess.HasExited -and -not (Get-NetTCPConnection -LocalPort $BackendPort -ErrorAction SilentlyContinue)) {
        throw "Backend exited early. Check logs: $BackendOutLog and $BackendErrLog"
    }

    $TestUrl = "http://127.0.0.1:$BackendPort/instant_noise_test/"
    Write-Host "Opening instant model test page: $TestUrl"
    Start-Process $TestUrl

    Write-Host "Running Pico W script with mpremote..."
    if ($BackgroundSeconds -gt 0) {
        Write-Host "Background mode: keep the room quiet. The Pico W records for $BackgroundSeconds seconds."
    } else {
        Write-Host "Make noise above MIC_TEST_START_DECIBEL_THRESHOLD to stream 500 ms chunks."
    }
    Write-Host "Final classes: human_created_noise / environment_noise / background"
    Write-Host "Press Ctrl+C to stop and restore pico_noise_sender.py."
    Write-Host "--------------------------------------------------------"

    if ($Port -eq "auto") {
        python -m mpremote connect auto run $PicoScript
    } else {
        python -m mpremote connect $Port run $PicoScript
    }
} finally {
    Stop-Backend
    Remove-Item Env:\ORACLE_PORT -ErrorAction SilentlyContinue

    if ($PicoScriptModified -and $OriginalPicoScriptContent) {
        Write-Host "Restoring pico_noise_sender.py..."
        [System.IO.File]::WriteAllText($PicoScript, $OriginalPicoScriptContent, (New-Object System.Text.UTF8Encoding($false)))
    }
}
