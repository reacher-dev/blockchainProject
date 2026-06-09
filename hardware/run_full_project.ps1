param(
    [string]$Port = "auto",
    [int]$BackendPort = 8000,
    [int]$FrontendPort = 5173,
    [switch]$RunPico,
    [switch]$StartAnvil,
    [switch]$DeployContract,
    [int]$BackgroundSeconds = 0,
    [string]$HostIP = "",
    [string]$WifiSsid = $env:PICO_WIFI_SSID,
    [string]$WifiPassword = $env:PICO_WIFI_PASSWORD,
    [switch]$NoOpen
)

$ErrorActionPreference = "Stop"

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir
$FrontendDir = Join-Path $ProjectRoot "frontend"
$OracleScript = Join-Path $ScriptDir "web3_oracle.py"
$PicoScript = Join-Path $ScriptDir "pico_noise_sender.py"
$RequirementsFile = Join-Path $ProjectRoot "requirements.txt"
$BackendOutLog = Join-Path $ScriptDir "web3_oracle.full.out.log"
$BackendErrLog = Join-Path $ScriptDir "web3_oracle.full.err.log"
$FrontendOutLog = Join-Path $ScriptDir "frontend.full.out.log"
$FrontendErrLog = Join-Path $ScriptDir "frontend.full.err.log"
$AnvilOutLog = Join-Path $ScriptDir "anvil.full.out.log"
$AnvilErrLog = Join-Path $ScriptDir "anvil.full.err.log"
$PicoRuntimeScript = Join-Path ([System.IO.Path]::GetTempPath()) ("pico_noise_sender_{0}.py" -f [guid]::NewGuid().ToString("N"))

$BackendProcess = $null
$FrontendProcess = $null
$AnvilProcess = $null

function Stop-PortProcess {
    param([int]$LocalPort)
    $connections = Get-NetTCPConnection -LocalPort $LocalPort -ErrorAction SilentlyContinue
    foreach ($conn in $connections) {
        if ($conn.OwningProcess -and $conn.OwningProcess -ne 0) {
            Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue
        }
    }
}

function Wait-Http {
    param(
        [string]$Url,
        [int]$TimeoutSeconds = 20
    )
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        try {
            $response = Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2
            if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 500) {
                return $true
            }
        } catch {
            Start-Sleep -Milliseconds 500
        }
    }
    return $false
}

function Resolve-AnvilPath {
    $command = Get-Command anvil -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $candidates = @(
        (Join-Path $env:USERPROFILE ".foundry\bin\anvil.exe"),
        (Join-Path $env:USERPROFILE "scoop\shims\anvil.exe")
    )
    foreach ($candidate in $candidates) {
        if (Test-Path $candidate) {
            return $candidate
        }
    }

    return $null
}

function Resolve-FoundryCommand {
    param([string]$Name)

    $command = Get-Command $Name -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $extension = if ($IsWindows -or $env:OS -eq "Windows_NT") { ".exe" } else { "" }
    $candidate = Join-Path $env:USERPROFILE (".foundry\bin\{0}{1}" -f $Name, $extension)
    if (Test-Path $candidate) {
        return $candidate
    }

    return $null
}

function Resolve-HostIP {
    if ($HostIP) {
        return $HostIP
    }

    $configs = Get-NetIPConfiguration |
        Where-Object {
            $_.IPv4Address -and
            $_.IPv4DefaultGateway -and
            $_.NetAdapter.Status -eq "Up"
        }

    $wifiConfig = $configs | Where-Object { $_.InterfaceAlias -like "*Wi-Fi*" } | Select-Object -First 1
    if ($wifiConfig) {
        return $wifiConfig.IPv4Address.IPAddress
    }

    $config = $configs | Select-Object -First 1
    if ($config) {
        return $config.IPv4Address.IPAddress
    }

    $fallback = Get-NetIPAddress -AddressFamily IPv4 |
        Where-Object {
            $_.IPAddress -notlike "127.*" -and
            $_.IPAddress -notlike "169.254.*" -and
            $_.InterfaceAlias -notlike "*VirtualBox*" -and
            $_.InterfaceAlias -notlike "*VMware*"
        } |
        Select-Object -First 1

    if ($fallback) {
        return $fallback.IPAddress
    }

    throw "Could not detect a LAN IPv4 address. Pass -HostIP manually."
}

function ConvertTo-PythonString {
    param([string]$Value)
    $escaped = $Value.Replace("\", "\\").Replace('"', '\"').Replace("`r", "\r").Replace("`n", "\n")
    return '"' + $escaped + '"'
}

function New-PicoRuntimeScript {
    param([string]$ResolvedHostIP)

    if ([string]::IsNullOrWhiteSpace($WifiSsid) -or [string]::IsNullOrWhiteSpace($WifiPassword)) {
        throw "Pico Wi-Fi credentials are required. Pass -WifiSsid and -WifiPassword, or set PICO_WIFI_SSID and PICO_WIFI_PASSWORD."
    }

    $content = Get-Content $PicoScript -Raw
    $content = [regex]::Replace($content, '(?m)^SSID = .+$', "SSID = $(ConvertTo-PythonString $WifiSsid)")
    $content = [regex]::Replace($content, '(?m)^PASSWORD = .+$', "PASSWORD = $(ConvertTo-PythonString $WifiPassword)")
    $content = [regex]::Replace($content, '(?m)^ORACLE_URL = .+$', "ORACLE_URL = `"http://${ResolvedHostIP}:$BackendPort/noise/ingest`"")
    $content = [regex]::Replace($content, '(?m)^AUDIO_UPLOAD_URL = .+$', "AUDIO_UPLOAD_URL = `"http://${ResolvedHostIP}:$BackendPort/api/audio/upload`"")
    $content = [regex]::Replace($content, '(?m)^MIC_TEST_UPLOAD_URL = .+$', "MIC_TEST_UPLOAD_URL = `"http://${ResolvedHostIP}:$BackendPort/api/mic-test/upload`"")
    $content = [regex]::Replace($content, '(?m)^ENABLE_MIC_TEST_UPLOAD = .+$', "ENABLE_MIC_TEST_UPLOAD = True")
    if ($BackgroundSeconds -gt 0) {
        $content = [regex]::Replace($content, '(?m)^MIC_TEST_FORCE_RECORD_SECONDS = \d+$', "MIC_TEST_FORCE_RECORD_SECONDS = $BackgroundSeconds")
    }

    [System.IO.File]::WriteAllText($PicoRuntimeScript, $content, (New-Object System.Text.UTF8Encoding($false)))
}

function Stop-All {
    foreach ($proc in @($BackendProcess, $FrontendProcess, $AnvilProcess)) {
        if ($proc -and -not $proc.HasExited) {
            Stop-Process -Id $proc.Id -Force -ErrorAction SilentlyContinue
        }
    }
    Remove-Item -LiteralPath $PicoRuntimeScript -Force -ErrorAction SilentlyContinue
    Remove-Item Env:\ORACLE_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:\ORACLE_SUBMIT_ONCHAIN -ErrorAction SilentlyContinue
    Remove-Item Env:\ORACLE_RPC_URL -ErrorAction SilentlyContinue
    Remove-Item Env:\PRIVATE_KEY -ErrorAction SilentlyContinue
}

try {
    Write-Host "Cleaning ports $BackendPort and $FrontendPort..."
    Stop-PortProcess -LocalPort $BackendPort
    Stop-PortProcess -LocalPort $FrontendPort
    if ($StartAnvil) {
        Stop-PortProcess -LocalPort 8545
    }
    Start-Sleep -Seconds 1

    if ($StartAnvil) {
        $AnvilPath = Resolve-AnvilPath
        if (-not $AnvilPath) {
            throw "StartAnvil was requested, but anvil was not found in PATH or $env:USERPROFILE\.foundry\bin. Install Foundry or run without -StartAnvil."
        }
        Write-Host "Starting Anvil on http://127.0.0.1:8545 using $AnvilPath..."
        $AnvilProcess = Start-Process `
            -FilePath $AnvilPath `
            -ArgumentList @("--host", "127.0.0.1", "--port", "8545") `
            -WorkingDirectory $ProjectRoot `
            -RedirectStandardOutput $AnvilOutLog `
            -RedirectStandardError $AnvilErrLog `
            -WindowStyle Hidden `
            -PassThru
        Start-Sleep -Seconds 2
        $env:ORACLE_SUBMIT_ONCHAIN = "1"
        $env:ORACLE_RPC_URL = "http://127.0.0.1:8545"
    }

    if ($DeployContract) {
        if (-not $StartAnvil) {
            throw "DeployContract requires -StartAnvil."
        }
        $ForgePath = Resolve-FoundryCommand -Name "forge"
        if (-not $ForgePath) {
            throw "forge was not found in PATH or $env:USERPROFILE\.foundry\bin."
        }
        if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
            throw "Node.js was not found in PATH."
        }
        $env:PRIVATE_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
        Write-Host "Deploying RentEscrow to Anvil..."
        & $ForgePath script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
        if ($LASTEXITCODE -ne 0) {
            throw "Contract deployment failed."
        }
        & node (Join-Path $ProjectRoot "go.cjs")
        if ($LASTEXITCODE -ne 0) {
            throw "frontend/src/contract.json generation failed."
        }
    }

    if (-not (Get-Command python -ErrorAction SilentlyContinue)) {
        throw "Python was not found in PATH."
    }
    & python -c "import eth_account, joblib, mpremote, numpy, sklearn, web3" 2>$null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Installing Python dependencies..."
        & python -m pip install -r $RequirementsFile
        if ($LASTEXITCODE -ne 0) {
            throw "Python dependency installation failed."
        }
    }
    Write-Host "Starting backend oracle on http://127.0.0.1:$BackendPort..."
    $env:ORACLE_PORT = [string]$BackendPort
    $BackendProcess = Start-Process `
        -FilePath "python" `
        -ArgumentList @($OracleScript) `
        -WorkingDirectory $ProjectRoot `
        -RedirectStandardOutput $BackendOutLog `
        -RedirectStandardError $BackendErrLog `
        -WindowStyle Hidden `
        -PassThru

    if (-not (Wait-Http -Url "http://127.0.0.1:$BackendPort/health" -TimeoutSeconds 20)) {
        throw "Backend did not become ready. Check logs: $BackendOutLog and $BackendErrLog"
    }

    if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) {
        throw "npm was not found in PATH."
    }
    if (-not (Test-Path (Join-Path $FrontendDir "node_modules"))) {
        Write-Host "Installing frontend dependencies..."
        & npm.cmd install --prefix $FrontendDir
        if ($LASTEXITCODE -ne 0) {
            throw "npm install failed."
        }
    }

    Write-Host "Starting frontend on http://127.0.0.1:$FrontendPort..."
    $FrontendProcess = Start-Process `
        -FilePath "npm.cmd" `
        -ArgumentList @("run", "dev", "--", "--host", "127.0.0.1", "--port", [string]$FrontendPort) `
        -WorkingDirectory $FrontendDir `
        -RedirectStandardOutput $FrontendOutLog `
        -RedirectStandardError $FrontendErrLog `
        -WindowStyle Hidden `
        -PassThru

    if (-not (Wait-Http -Url "http://127.0.0.1:$FrontendPort/" -TimeoutSeconds 25)) {
        throw "Frontend did not become ready. Check logs: $FrontendOutLog and $FrontendErrLog"
    }

    if ($RunPico) {
        $ResolvedHostIP = Resolve-HostIP
        Write-Host "Using host IP for Pico W URLs: $ResolvedHostIP"
        New-PicoRuntimeScript -ResolvedHostIP $ResolvedHostIP
    }

    $FrontendUrl = "http://127.0.0.1:$FrontendPort/"
    $InstantUrl = "http://127.0.0.1:$BackendPort/instant_noise_test/"
    $FftUrl = "http://127.0.0.1:$BackendPort/fft_demo/"
    $HealthUrl = "http://127.0.0.1:$BackendPort/health"

    Write-Host ""
    Write-Host "Project is running:"
    Write-Host "  Frontend:      $FrontendUrl"
    Write-Host "  Instant model: $InstantUrl"
    Write-Host "  FFT demo:      $FftUrl"
    Write-Host "  Backend:       $HealthUrl"
    if ($StartAnvil) {
        Write-Host "  Anvil:         http://127.0.0.1:8545"
    }
    Write-Host ""

    if (-not $NoOpen) {
        Start-Process $FrontendUrl
        Start-Process $InstantUrl
    }

    if ($RunPico) {
        Write-Host "Running Pico W script with mpremote. Press Ctrl+C to stop everything."
        if ($BackgroundSeconds -gt 0) {
            Write-Host "Background mode: keep quiet for $BackgroundSeconds seconds."
        }
        Write-Host "--------------------------------------------------------"
        if ($Port -eq "auto") {
            python -m mpremote connect auto run $PicoRuntimeScript
        } else {
            python -m mpremote connect $Port run $PicoRuntimeScript
        }
    } else {
        Write-Host "RunPico is off. Services will stay open until you press Ctrl+C in this terminal."
        Write-Host "To include Pico W, run this script with -RunPico -Port COM3."
        while ($true) {
            Start-Sleep -Seconds 2
            if ($BackendProcess.HasExited) { throw "Backend stopped. Check $BackendOutLog and $BackendErrLog" }
            if ($FrontendProcess.HasExited) { throw "Frontend stopped. Check $FrontendOutLog and $FrontendErrLog" }
            if ($StartAnvil -and $AnvilProcess.HasExited) { throw "Anvil stopped. Check $AnvilOutLog and $AnvilErrLog" }
        }
    }
} finally {
    Stop-All
}
