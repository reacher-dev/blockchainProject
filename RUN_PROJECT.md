# Run the complete project

The supported hardware is Raspberry Pi Pico W with an INMP441 microphone.
Arduino and ESP32 are not required.

The launchers start Anvil, deploy `RentEscrow`, generate the frontend contract
metadata, start the Python backend, start the React frontend, configure a
temporary Pico W script, and run it through `mpremote`.

## Prerequisites

- Foundry (`anvil` and `forge`)
- Node.js 18 or newer
- Python 3.10 or newer
- Pico W connected by USB
- Pico W and the computer connected to the same Wi-Fi network

Python and frontend packages are installed automatically when missing.

## Windows

```powershell
powershell -ExecutionPolicy Bypass -File .\run_all.ps1 -Port COM3 -WifiSsid "YOUR_WIFI" -WifiPassword "YOUR_PASSWORD"
```

Environment variables can keep credentials out of shell history:

```powershell
$env:PICO_WIFI_SSID = "YOUR_WIFI"; $env:PICO_WIFI_PASSWORD = "YOUR_PASSWORD"; powershell -ExecutionPolicy Bypass -File .\run_all.ps1 -Port COM3
```

## macOS

Find the Pico serial port:

```bash
ls /dev/cu.usbmodem*
```

Run the project:

```bash
./run_all.sh --port /dev/cu.usbmodemXXXX --wifi-ssid "YOUR_WIFI" --wifi-password "YOUR_PASSWORD"
```

Environment variable form:

```bash
PICO_WIFI_SSID="YOUR_WIFI" PICO_WIFI_PASSWORD="YOUR_PASSWORD" ./run_all.sh --port /dev/cu.usbmodemXXXX
```

Press `Ctrl+C` to stop the Pico process and all services started by the
launcher.

## URLs

- DePIN frontend: `http://127.0.0.1:5173/`
- Instant model test: `http://127.0.0.1:8000/instant_noise_test/`
- FFT demo: `http://127.0.0.1:8000/fft_demo/`
- Backend health: `http://127.0.0.1:8000/health`
- Anvil RPC: `http://127.0.0.1:8545`

Use `-HostIP` on Windows or `--host-ip` on macOS if automatic LAN IP
detection chooses the wrong network adapter.
