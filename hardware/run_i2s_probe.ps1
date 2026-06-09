param(
    [string]$Port = "auto"
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProbeScript = Join-Path $ScriptDir "pico_i2s_probe.py"

Write-Host "Running standalone Pico W I2S probe..."
Write-Host "This does not start Wi-Fi, backend, frontend, or the model."
Write-Host "Look for a line with peak > 0 and nonzero > 0, or BEST."
Write-Host "--------------------------------------------------------"

if ($Port -eq "auto") {
    python -m mpremote connect auto run $ProbeScript
} else {
    python -m mpremote connect $Port run $ProbeScript
}
