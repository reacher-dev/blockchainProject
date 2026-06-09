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
$BackendOutLog = Join-Path $ScriptDir "web3_oracle.run.out.log"
$BackendErrLog = Join-Path $ScriptDir "web3_oracle.run.err.log"

$OriginalPicoScriptContent = $null
$PicoScriptModified = $false

function Stop-Backend {
    Write-Host "`nStopping backend oracle on port $BackendPort..."
    $proc = Get-NetTCPConnection -LocalPort $BackendPort -ErrorAction SilentlyContinue
    if ($proc) {
        foreach ($conn in $proc) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

try {
    # 0. Clean up any existing process on port $BackendPort before starting
    $oldProc = Get-NetTCPConnection -LocalPort $BackendPort -ErrorAction SilentlyContinue
    if ($oldProc) {
        Write-Host "Found existing process on port $BackendPort. Cleaning up..."
        foreach ($conn in $oldProc) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
        Start-Sleep -Seconds 1
    }

    # 1. Temporarily enable mic test upload in pico_noise_sender.py
    $OriginalPicoScriptContent = Get-Content $PicoScript -Raw
    $TempContent = $OriginalPicoScriptContent
    if ($TempContent -match "ENABLE_MIC_TEST_UPLOAD = False") {
        Write-Host "Temporarily enabling ENABLE_MIC_TEST_UPLOAD in pico_noise_sender.py..."
        $TempContent = $TempContent -replace "ENABLE_MIC_TEST_UPLOAD = False", "ENABLE_MIC_TEST_UPLOAD = True"
        $PicoScriptModified = $true
    }
    if ($BackgroundSeconds -gt 0) {
        Write-Host "Temporarily enabling background recording for $BackgroundSeconds seconds..."
        $TempContent = $TempContent -replace "MIC_TEST_FORCE_RECORD_SECONDS = \d+", "MIC_TEST_FORCE_RECORD_SECONDS = $BackgroundSeconds"
        $PicoScriptModified = $true
    }
    if ($PicoScriptModified) {
        [System.IO.File]::WriteAllText($PicoScript, $TempContent, (New-Object System.Text.UTF8Encoding($false)))
    }

    # 2. Clean up old WAV files
    $WavDir = Join-Path $ProjectRoot "mic_test_audio"
    if (Test-Path $WavDir) {
        Write-Host "Cleaning up old WAV test files..."
        Remove-Item (Join-Path $WavDir "*.wav") -ErrorAction SilentlyContinue
    } else {
        New-Item -ItemType Directory -Path $WavDir | Out-Null
    }

    # 3. Start Backend Oracle
    Write-Host "Starting backend oracle on port $BackendPort..."
    $env:ORACLE_PORT = [string]$BackendPort
    $script:BackendProcess = Start-Process `
        -FilePath "python" `
        -ArgumentList @($OracleScript) `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $BackendOutLog `
        -RedirectStandardError $BackendErrLog `
        -WindowStyle Hidden `
        -PassThru

    Start-Sleep -Seconds 2

    if ($script:BackendProcess.HasExited) {
        # Check if it was a shim exit but process is actually running on port
        $checkProc = Get-NetTCPConnection -LocalPort $BackendPort -ErrorAction SilentlyContinue
        if (-not $checkProc) {
            throw "Backend exited early. Check logs: $BackendOutLog and $BackendErrLog"
        }
    }

    Write-Host "Backend running: http://127.0.0.1:$BackendPort"
    Write-Host "WAV files will be saved in: $WavDir"
    Write-Host "Opening recording list page..."
    Start-Process "http://127.0.0.1:$BackendPort/mic_test_audio/"
    Write-Host "Opening FFT live demo page..."
    Start-Process "http://127.0.0.1:$BackendPort/fft_demo/"

    # 4. Start Pico W MicroPython Script
    Write-Host "Running Pico W script with mpremote..."
    Write-Host "--------------------------------------------------------"
    if ($BackgroundSeconds -gt 0) {
        Write-Host "Background mode: keep the room quiet. The Pico W records for $BackgroundSeconds seconds."
    } else {
        Write-Host "Please clap / speak / make noise near the microphone."
        Write-Host "The Pico W records continuous 500 ms chunks while noise"
        Write-Host "exceeds the mic-test threshold, then stops after silence."
    }
    Write-Host "FFT needs 'Sending recording chunk' and 'Mic test POST status: 200'."
    Write-Host "A normal '/noise/ingest' POST is only dB telemetry, not FFT audio."
    Write-Host "Press Ctrl+C to exit."
    Write-Host "--------------------------------------------------------"

    if ($Port -eq "auto") {
        python -m mpremote connect auto run $PicoScript
    } else {
        python -m mpremote connect $Port run $PicoScript
    }

} finally {
    # 5. Stop Backend and Restore Script configuration
    Stop-Backend
    Remove-Item Env:\ORACLE_PORT -ErrorAction SilentlyContinue

    if ($PicoScriptModified -and $OriginalPicoScriptContent) {
        Write-Host "Restoring pico_noise_sender.py..."
        [System.IO.File]::WriteAllText($PicoScript, $OriginalPicoScriptContent, (New-Object System.Text.UTF8Encoding($false)))
    }
}
