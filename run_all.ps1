param(
    [string]$Port = "auto",
    [string]$WifiSsid = $env:PICO_WIFI_SSID,
    [string]$WifiPassword = $env:PICO_WIFI_PASSWORD,
    [string]$HostIP = "",
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"
$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Launcher = Join-Path $ProjectRoot "hardware\run_full_project.ps1"

& $Launcher `
    -Port $Port `
    -BackendPort $BackendPort `
    -FrontendPort $FrontendPort `
    -HostIP $HostIP `
    -WifiSsid $WifiSsid `
    -WifiPassword $WifiPassword `
    -StartAnvil `
    -DeployContract `
    -RunPico `
    -NoOpen:$NoOpen
