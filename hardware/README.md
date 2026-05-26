# Hardware Prototype

This folder contains the Raspberry Pi Pico W and Windows relay prototype for the DePIN rental noise governance demo.

## Files

- `pico_noise_sender.py`: MicroPython program for Pico W. It sends simulated noise violation JSON to the backend oracle relay every 5 seconds. It also includes an INMP441 I2S microphone integration point.
- `web3_oracle.py`: Python HTTP relay that receives Pico W POST requests, validates JSON, keeps latest/history state for the frontend/backend integration, and can optionally submit an oracle-signed `reportNoise` transaction to Anvil.
- `send_sample_payload.py`: Laptop-side Pico W payload simulator. Use this when the real Pico W is not available.
- `blink.py`: Pico W LED test.

## Pico W Setup

Edit these values in `pico_noise_sender.py` before copying it to the Pico W. `ORACLE_URL` must use the Windows computer's LAN IPv4 address, not `127.0.0.1`:

```python
SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"
ORACLE_URL = "http://YOUR_WINDOWS_IP:8000/"
```

Keep `SENSOR_MODE = "simulation"` while testing without the microphone. Change it after the INMP441 is wired:

```python
SENSOR_MODE = "inmp441"
```

Run from the computer while the Pico W is connected:

```powershell
python -m mpremote connect COM3 run hardware/pico_noise_sender.py
```

To make the Pico W auto-run after power-on:

```powershell
python -m mpremote connect COM3 fs cp hardware/pico_noise_sender.py :main.py
python -m mpremote connect COM3 reset
```

## Real Pico W on Windows

Find the Windows Wi-Fi IPv4 address:

```powershell
ipconfig
```

Use the `IPv4 Address` from `Wireless LAN adapter Wi-Fi`, for example:

```python
ORACLE_URL = "http://192.168.1.50:8000/"
SENSOR_MODE = "inmp441"
```

Run the backend relay on Windows:

```powershell
cd path\to\blockchainProject
python -m pip install web3 eth-account
$env:ORACLE_SUBMIT_ONCHAIN="1"
$env:ORACLE_RPC_URL="http://127.0.0.1:8545"
python hardware\web3_oracle.py
```

If the Pico W cannot reach the backend, allow Python through Windows Firewall for port `8000`.

Run the Pico script:

```powershell
python -m mpremote connect COM3 run hardware/pico_noise_sender.py
```

Verify that the backend is receiving real microphone data:

```powershell
curl http://127.0.0.1:8000/noise/latest
```

The response should include:

```json
"source": "inmp441"
```

## Backend Oracle Relay

Run:

```powershell
python hardware/web3_oracle.py
```

The relay listens on port `8000` and accepts the same JSON that the Pico W sends:

```json
{
  "device_id": "pico-w-001",
  "timestamp": 1779611806,
  "violation_details": {
    "culprit_room": "Room A",
    "peak_decibel": 82,
    "duration_seconds": 5,
    "source": "simulation"
  }
}
```

Endpoints:

- `POST /` or `POST /noise/ingest`: receive Pico W payloads.
- `GET /noise/latest`: latest normalized noise event for frontend polling.
- `GET /noise/history`: recent normalized noise events.
- `GET /health`: backend health/config status.

Response example:

```json
{
  "status": "success",
  "message": "Oracle received Pico W noise payload"
}
```

### Test Without Hardware

Start the relay:

```powershell
python hardware/web3_oracle.py
```

In another terminal, send a Pico-shaped payload:

```powershell
python hardware/send_sample_payload.py --room "Room A" --decibels 82
```

Then inspect the latest backend state:

```powershell
curl http://127.0.0.1:8000/noise/latest
```

### Optional On-Chain Submission

By default the relay only receives, validates, normalizes, and stores Pico W events. To also submit violations to the local smart contract, install Python Web3 dependencies and enable on-chain submission:

```powershell
pip install web3 eth-account
set ORACLE_SUBMIT_ONCHAIN=1
set ORACLE_RPC_URL=http://127.0.0.1:8545
python hardware/web3_oracle.py
```

The default `ORACLE_PRIVATE_KEY` is Anvil account #1, matching `script/Deploy.s.sol`. For any non-local environment, set `ORACLE_PRIVATE_KEY` from a secret instead of hard-coding it.

Before testing on-chain submission:

1. Start Anvil.
2. Deploy the contract.
3. Run `node go.cjs` from the project root so `frontend/src/contract.json` contains the current deployed address and ABI.
4. Register tenants and make sure the reported room has enough deposit to pay the penalty.

## INMP441 Microphone Wiring

```text
INMP441 VDD -> Pico 3V3(OUT)
INMP441 GND -> Pico GND
INMP441 SCK -> Pico GP10
INMP441 WS  -> Pico GP11
INMP441 SD  -> Pico GP12
INMP441 L/R -> GND
```

These pins match the defaults in `pico_noise_sender.py`:

```python
INMP441_SCK_PIN = 10
INMP441_WS_PIN = 11
INMP441_SD_PIN = 12
```

The current INMP441 conversion is an uncalibrated demo reading. It is good enough to prove that the Pico W sends microphone-derived events through the backend, but final dB thresholds should be calibrated against a real sound meter.
