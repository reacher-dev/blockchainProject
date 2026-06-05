param(
    [string]$Port = "auto",
    [int]$BackendPort = 8000
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$OracleScript = Join-Path $ScriptDir "web3_oracle.py"
$PicoScript = Join-Path $ScriptDir "pico_noise_sender.py"
$MonitorHtml = Join-Path $ScriptDir "noise_monitor.html"
$BackendOutLog = Join-Path $ScriptDir "web3_oracle.run.out.log"
$BackendErrLog = Join-Path $ScriptDir "web3_oracle.run.err.log"

function Stop-Backend {
    if ($script:BackendProcess -and -not $script:BackendProcess.HasExited) {
        Write-Host "`nStopping backend oracle..."
        Stop-Process -Id $script:BackendProcess.Id -Force
    }
}

try {
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
        throw "Backend exited early. Check $BackendOutLog and $BackendErrLog"
    }

    Write-Host "Backend running: http://127.0.0.1:$BackendPort"
    Write-Host "Opening monitor page..."
    Start-Process $MonitorHtml

    Write-Host "Running Pico W script with mpremote..."
    Write-Host "Press Ctrl+C to stop Pico output and backend."

    if ($Port -eq "auto") {
        python -m mpremote connect auto run $PicoScript
    } else {
        python -m mpremote connect $Port run $PicoScript
    }
} finally {
    Stop-Backend
    Remove-Item Env:\ORACLE_PORT -ErrorAction SilentlyContinue
}
