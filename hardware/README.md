# Hardware, Audio, and Oracle Guide

This folder contains the complete hardware pipeline for the DePIN rental noise
governance demo.

```text
INMP441 microphone
        |
        | I2S audio
        v
Raspberry Pi Pico W
        |
        | HTTP telemetry and optional PCM audio
        v
Python oracle relay (port 8000)
        |
        +--> live dB monitor and device status
        +--> WAV recording
        +--> FFT feature extraction
        +--> noise-type model prediction
        +--> optional signed reportNoise() transaction
```

There are three separate data paths:

1. **Noise telemetry**: sends dB-like readings every 0.1 seconds.
2. **Audio analysis**: sends PCM audio for WAV recording, FFT, and ML
   classification.
3. **On-chain reporting**: optionally submits a signed noise violation to the
   smart contract.

Start with telemetry only. Enable audio recording and blockchain submission
after the basic connection works.

## Integration Contract

This is the shared interface for the hardware, backend, and frontend teams.
Changing these field names or routes requires updating all three parts.

### Telemetry Flow

```text
Pico W
  POST /noise/ingest
      |
      v
Oracle normalizes and stores the event
      |
      +--> Frontend polls GET /noise/latest every 200 ms
      +--> GET /devices reports Pico online/offline state
      +--> Optional reportNoise() transaction
```

Minimum Pico payload:

```json
{
  "device_id": "pico-w-001",
  "timestamp": 1780729132,
  "violation_details": {
    "culprit_room": "Room A",
    "peak_decibel": 82,
    "duration_seconds": 5,
    "source": "inmp441"
  }
}
```

Normalized fields used by the frontend:

```json
{
  "deviceId": "pico-w-001",
  "timestamp": 1780729132,
  "roomIndex": 0,
  "roomLabel": "林",
  "decibels": 82,
  "estimatedDb": 82,
  "eventType": "violation",
  "source": "inmp441",
  "reportAllowed": true,
  "onchain": {
    "submitted": true,
    "txHash": "0x..."
  }
}
```

The frontend currently depends on:

- `estimatedDb`, falling back to `decibels`, for the live chart
- `roomIndex` and `roomLabel` for room display
- `reportAllowed` for the room warning animation
- `onchain.submitted` to reload contract state after a hardware transaction
- `timestamp` to avoid processing the same backend event twice

### Audio Flow

PCM audio is separate from telemetry:

```text
POST /api/audio/upload     short JSON sample test
POST /api/mic-test/upload  continuous Pico recording chunks
```

These routes update FFT/ML results. They do not directly create a smart-contract
penalty. A penalty still requires an accepted telemetry event and successful
on-chain submission.

### Contract Address Ownership

`frontend/src/contract.json` contains ABI and bytecode, not a permanent deployed
address. The integration contract address is the one deployed by the landlord
through the frontend.

After deployment, the frontend:

1. saves the address in browser `localStorage`
2. creates its ethers contract instance
3. POSTs the same address to `/contract/address`

The Oracle then uses that runtime address for `reportNoise()`. If Anvil restarts,
the old address is invalid and the apartment must be deployed again.

### Integration URLs

When frontend and Oracle run on the same computer:

```text
Frontend sensor API: http://127.0.0.1:8000
Frontend RPC:        http://127.0.0.1:8545
Pico Oracle API:     http://COMPUTER_LAN_IP:8000
```

When the frontend runs on another computer, set:

```env
VITE_SENSOR_API_URL=http://ORACLE_COMPUTER_IP:8000
VITE_RPC_URL=http://ANVIL_COMPUTER_IP:8545
```

The lowest-risk demo setup is to run Anvil, Oracle, and frontend on the same
computer and connect only the Pico W over Wi-Fi.

## Files

| File | Purpose | Runs on |
|------|---------|---------|
| `pico_noise_sender.py` | Reads the INMP441, sends telemetry, and optionally uploads PCM recording chunks | Pico W |
| `web3_oracle.py` | HTTP relay, event log, device status, WAV storage, FFT/ML analysis, and optional blockchain submission | Computer |
| `noise_monitor.html` | Live browser graph for dB telemetry | Browser |
| `run_hardware_test.ps1` | Starts the relay, opens the monitor, and runs the Pico | Windows |
| `run_mic_test.ps1` | Starts the relay, opens recording/FFT pages, and runs the Pico audio test | Windows |
| `send_sample_payload.py` | Sends one fake Pico telemetry payload | Computer |
| `send_sample_audio.py` | Sends generated PCM samples to the audio endpoint | Computer |
| `send_wav_to_fft_demo.py` | Uploads a local WAV file to the backend FFT page | Computer |
| `analyze_wav_fft.py` | Runs FFT analysis directly on local WAV files | Computer |
| `train_noise_model.py` | Trains the sklearn model from labeled FFT features | Computer |
| `blink.py` | Basic Pico GPIO LED test | Pico W |

Generated data is stored outside the source files:

```text
hardware/noise_events.jsonl       normalized telemetry event log
mic_test_audio/                   recorded WAV files
training_data/labels.csv          manually labeled FFT features
training_data/<label>/            labeled WAV copies
training_data/noise_model.joblib  trained model used by the relay
```

## Requirements

### Computer

- Python 3.10 or newer
- `mpremote` for running MicroPython files on the Pico W
- `numpy` for FFT analysis
- `scikit-learn` and `joblib` for model prediction/training
- `web3` and `eth-account` only for blockchain submission

Install all hardware/backend dependencies. The bundled model was serialized
with scikit-learn 1.9.0, so use that version when loading the included model:

```powershell
python -m pip install mpremote numpy scikit-learn==1.9.0 joblib web3 eth-account
```

### Pico W

- Raspberry Pi Pico W
- MicroPython firmware with `network`, `urequests`, and `machine.I2S`
- INMP441 I2S microphone
- Pico W and relay computer on the same local network

## Recommended Test Order

1. Start the relay and send fake telemetry.
2. Open the live monitor.
3. Test generated PCM audio and the FFT page.
4. Configure the Pico W network addresses.
5. Run the Pico in simulation mode.
6. Wire and test the INMP441.
7. Test continuous recording and ML classification.
8. Enable on-chain submission last.

Do not skip directly to on-chain testing. A visible dB value proves only the
telemetry path; an FFT result proves only the PCM path. The final integration is
complete only when a real Pico event produces `onchain.submitted: true` and the
frontend reloads the resulting contract state.

## 1. Start the Oracle Relay

From the project root:

```powershell
python hardware\web3_oracle.py
```

Expected output:

```text
Web3 oracle relay listening on http://0.0.0.0:8000
Waiting for Pico W HTTP POST requests...
```

Check the relay:

```powershell
curl.exe http://127.0.0.1:8000/health
```

Important URLs:

```text
http://127.0.0.1:8000/health
http://127.0.0.1:8000/noise/latest
http://127.0.0.1:8000/devices
http://127.0.0.1:8000/fft_demo/
http://127.0.0.1:8000/mic_test_audio/
```

## 2. Test Telemetry Without Hardware

Keep the relay running. In a second terminal:

```powershell
python hardware\send_sample_payload.py --room "Room A" --decibels 82
```

Inspect the normalized event:

```powershell
curl.exe http://127.0.0.1:8000/noise/latest
```

The result should include:

```json
{
  "roomIndex": 0,
  "roomLabel": "林",
  "decibels": 82,
  "source": "simulation",
  "reportAllowed": true
}
```

Accepted room names:

| Index | Alias | Display name |
|------:|-------|--------------|
| `0` | `A`, `Room A` | `林` |
| `1` | `B`, `Room B` | `劉` |
| `2` | `C`, `Room C` | `鄭` |
| `3` | `D`, `Room D` | `吳` |
| `4` | `E`, `Room E` | `許` |

The relay stores the latest events in memory and appends all accepted telemetry
to `hardware/noise_events.jsonl`.

Filter history by device:

```powershell
curl.exe "http://127.0.0.1:8000/noise/history?device_id=pico-w-001"
```

## 3. Test FFT and ML Without Hardware

The FFT pipeline can be tested before connecting the Pico W.

### Generated PCM Test

```powershell
python hardware\send_sample_audio.py --room-id "Room A" --duration-ms 250 --violation
```

Open:

```text
http://127.0.0.1:8000/fft_demo/
```

The relay calculates FFT features and, when
`training_data/noise_model.joblib` is available, runs the bundled sklearn
model. The page shows:

- frequency spectrum
- peak frequency
- low, speech, and high band energy
- rule-based result
- model result and confidence

### Local WAV Upload

Upload the first second of a PCM WAV file:

```powershell
python hardware\send_wav_to_fft_demo.py .\sounds\voice.wav
```

Change the limit or upload the complete file:

```powershell
python hardware\send_wav_to_fft_demo.py .\sounds\voice.wav --max-duration-ms 2000
python hardware\send_wav_to_fft_demo.py .\sounds\voice.wav --max-duration-ms 0
```

### Offline WAV Analysis

Run the same style of FFT analysis without starting the relay:

```powershell
python hardware\analyze_wav_fft.py .\sounds\voice.wav
python hardware\analyze_wav_fft.py .\sounds\voice.wav .\sounds\music.wav
python hardware\analyze_wav_fft.py .\sounds\voice.wav --json
```

FFT classification is a demo feature. Model accuracy in the bundled metadata
describes its current dataset split; it is not evidence of production accuracy
for new rooms, microphones, or background conditions.

## 4. Wire the INMP441

Disconnect the Pico W from power before changing wires.

```text
INMP441       Pico W
--------      ------------
VDD           3V3(OUT)
GND           GND
SCK / BCLK    GP10
WS / LRCL     GP11
SD / DOUT     GP12
L/R           GND
```

These pins match the script:

```python
INMP441_I2S_ID = 0
INMP441_SCK_PIN = 10
INMP441_WS_PIN = 11
INMP441_SD_PIN = 12
INMP441_SAMPLE_RATE = 16000
```

The current conversion from I2S amplitude to `estimated_db` is uncalibrated.
Use a real sound meter before treating it as dB SPL:

```python
INMP441_SAMPLE_SHIFT = 14
INMP441_NOISE_FLOOR = 8
INMP441_LEVEL_SCALE = 450
```

## 5. Configure the Pico W

Edit the configuration block at the top of `pico_noise_sender.py`.

The repository version currently contains development network values. Replace
them with your own values before running the Pico, and do not commit real Wi-Fi
credentials.

```python
SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"

ORACLE_URL = "http://YOUR_COMPUTER_IP:8000/noise/ingest"
AUDIO_UPLOAD_URL = "http://YOUR_COMPUTER_IP:8000/api/audio/upload"
MIC_TEST_UPLOAD_URL = "http://YOUR_COMPUTER_IP:8000/api/mic-test/upload"

DEVICE_ID = "pico-w-001"
CULPRIT_ROOM = "Room A"
SENSOR_MODE = "inmp441"
```

All three URLs must use the relay computer's LAN IPv4 address. Do not use
`127.0.0.1` or `localhost`; those addresses refer to the Pico itself.

Find the Windows address:

```powershell
ipconfig
```

Use the `IPv4 Address` under the active Wi-Fi adapter. Example:

```python
ORACLE_URL = "http://192.168.1.50:8000/noise/ingest"
AUDIO_UPLOAD_URL = "http://192.168.1.50:8000/api/audio/upload"
MIC_TEST_UPLOAD_URL = "http://192.168.1.50:8000/api/mic-test/upload"
```

Allow Python through Windows Firewall for private networks or allow inbound TCP
port `8000`.

## 6. Run the Pico W

List connected MicroPython devices:

```powershell
python -m mpremote connect list
```

Run without installing:

```powershell
python -m mpremote connect COM3 run hardware\pico_noise_sender.py
```

Use `connect auto` when only one compatible device is connected:

```powershell
python -m mpremote connect auto run hardware\pico_noise_sender.py
```

For a telemetry-first test, use:

```python
SENSOR_MODE = "simulation"
ENABLE_AUDIO_UPLOAD = False
ENABLE_MIC_TEST_UPLOAD = False
```

For the real microphone:

```python
SENSOR_MODE = "inmp441"
ENABLE_AUDIO_UPLOAD = False
ENABLE_MIC_TEST_UPLOAD = False
```

Verify the relay is receiving the Pico:

```powershell
curl.exe http://127.0.0.1:8000/noise/latest
curl.exe http://127.0.0.1:8000/devices
```

The latest event should include:

```json
"source": "inmp441"
```

### Windows Telemetry Helper

This starts the relay, opens `noise_monitor.html`, and runs the Pico:

```powershell
powershell -ExecutionPolicy Bypass -File hardware\run_hardware_test.ps1 -Port COM3
```

Use automatic port detection:

```powershell
powershell -ExecutionPolicy Bypass -File hardware\run_hardware_test.ps1
```

Press `Ctrl+C` to stop the Pico output. The script then stops the relay.

### Install as `main.py`

After testing succeeds:

```powershell
python -m mpremote connect COM3 fs cp hardware\pico_noise_sender.py :main.py
python -m mpremote connect COM3 reset
```

The Pico will run the program automatically after power-on.

## 7. Continuous Microphone Recording

Mic-test mode records PCM chunks while the measured level remains above the
configured thresholds.

Current configuration keys:

```python
ENABLE_MIC_TEST_UPLOAD = True
MIC_TEST_START_DECIBEL_THRESHOLD = 40
MIC_TEST_CHUNK_DURATION_MS = 500
MIC_TEST_WAV_SAMPLE_RATE = 8000
MIC_TEST_CONTINUE_DECIBEL_THRESHOLD = 37
MIC_TEST_SILENCE_STOP_SECONDS = 6
```

Behavior:

1. Recording starts at or above the start threshold.
2. The Pico captures 500 ms PCM chunks.
3. Chunks are base64-encoded and posted to `/api/mic-test/upload`.
4. Chunks with the same `session_id` are appended to one WAV file.
5. Recording stops after six seconds below the continue threshold.
6. Each uploaded chunk updates the FFT and model result.

Run the Windows mic test:

```powershell
powershell -ExecutionPolicy Bypass -File hardware\run_mic_test.ps1 -Port COM3
```

The script opens:

```text
http://127.0.0.1:8000/mic_test_audio/
http://127.0.0.1:8000/fft_demo/
```

Watch for these Pico messages:

```text
Sending recording chunk ...
Mic test POST status: 200
```

Raw audio is saved to `mic_test_audio/`. Only enable this mode during controlled
tests where audio recording is permitted.

`MIC_TEST_WAV_SAMPLE_RATE` controls WAV playback speed and pitch. It does not
change the physical I2S capture rate. Raise it if playback is too slow/low, or
lower it if playback is too fast/high.

## 8. Label Data and Train the Model

The FFT page provides label buttons for:

- `human_voice`
- `music`
- `rain`
- `car`
- `other_noise`
- `background`

When a label is submitted, the relay:

1. Appends FFT features to `training_data/labels.csv`.
2. Copies the associated WAV file to `training_data/<label>/` when available.

Train a new model:

```powershell
python hardware\train_noise_model.py
```

Outputs:

```text
training_data/noise_model.joblib
training_data/noise_model_metadata.json
```

The relay automatically reloads the model when the model file modification time
changes. Restarting the relay is not required.

Training requires:

- at least two labels
- enough rows in every label for a stratified train/test split
- data collected across realistic speakers, rooms, distances, and background
  conditions

## 9. Optional On-Chain Submission

The relay does not submit transactions by default:

```text
ORACLE_SUBMIT_ONCHAIN=0
```

Before enabling submission:

1. Start Anvil.
2. Deploy `RentEscrow.sol`.
3. Update `frontend/src/contract.json` with the deployed address and ABI, or
   call `POST /contract/address`.
4. Confirm the relay key belongs to a registered oracle.
5. Register a tenant for the reported room.
6. Ensure the tenant has enough deposit for the penalty.

PowerShell:

```powershell
$env:ORACLE_SUBMIT_ONCHAIN = "1"
$env:ORACLE_RPC_URL = "http://127.0.0.1:8545"
$env:ORACLE_PRIVATE_KEY = "0xYOUR_ORACLE_PRIVATE_KEY"
python hardware\web3_oracle.py
```

The built-in fallback key is Anvil account #1 and is for local development
only. Always provide a secret through `ORACLE_PRIVATE_KEY` outside local Anvil.

Set a runtime contract address:

```powershell
curl.exe -X POST http://127.0.0.1:8000/contract/address `
  -H "Content-Type: application/json" `
  -d '{"address":"0xYOUR_DEPLOYED_CONTRACT_ADDRESS"}'
```

After sending a violation:

```powershell
curl.exe http://127.0.0.1:8000/noise/latest
curl.exe http://127.0.0.1:8000/health
```

A successful event contains:

```json
"onchain": {
  "submitted": true,
  "txHash": "0x..."
}
```

`lastError` in `/health` contains the latest submission failure.

## Threshold Behavior

Both the Pico and relay currently use 75 as the configured threshold, but their
comparisons are slightly different:

- Pico sustained detection: `estimated_db >= 75` continuously for five seconds.
- Relay submission check: `peak_decibel > 75`.

The Pico clamps monitoring events to 74 and only sends the real measured value
after its sustained-noise test passes. However, the relay does not independently
validate the five-second duration; it trusts `peak_decibel`.

Keep `ORACLE_SUBMIT_ONCHAIN=0` while calibrating or testing audio. For stronger
trust, add server-side duration validation before using unattended hardware.

## API Reference

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/health` | Relay configuration, counters, and latest on-chain error |
| `GET` | `/devices` | Latest state and online status for every device |
| `GET` | `/noise/latest` | Most recently accepted telemetry event |
| `GET` | `/noise/history` | Last 50 in-memory telemetry events |
| `GET` | `/noise/history?device_id=...` | Telemetry filtered by device |
| `GET` | `/api/fft/latest` | Latest FFT and model result |
| `GET` | `/fft_demo/` | Live FFT/model browser page |
| `GET` | `/mic_test_audio/` | Recorded WAV browser page |
| `POST` | `/` | Accept Pico telemetry |
| `POST` | `/noise/ingest` | Accept Pico telemetry |
| `POST` | `/api/audio/upload` | Accept JSON int16 PCM samples and run FFT |
| `POST` | `/api/mic-test/upload` | Accept recording chunks, save WAV, and run FFT |
| `POST` | `/api/fft/label` | Save a label and FFT training row |
| `POST` | `/noise/mock` | Immediately attempt a direct on-chain report |
| `POST` | `/contract/address` | Override the contract address for this process |

## Troubleshooting

### Pico cannot connect to Wi-Fi

- Replace the repository development SSID/password with the current network.
- Use a 2.4 GHz network supported by the Pico W.
- Read the network scan and status printed by the Pico.

### Pico prints `POST failed`

- Confirm `web3_oracle.py` is running.
- Confirm all three Pico URLs use the computer's LAN IPv4 address.
- Confirm the Pico and computer are on the same network.
- Allow inbound TCP port `8000` through Windows Firewall.
- Test `http://COMPUTER_IP:8000/health` from another device.

### Telemetry works but no FFT appears

Telemetry at `/noise/ingest` does not contain the PCM audio required by FFT.
Confirm one of these appears in the Pico output:

```text
Audio POST status: 200
Mic test POST status: 200
```

Also confirm `numpy` is installed:

```powershell
python -c "import numpy; print(numpy.__version__)"
```

### FFT works but no model result appears

```powershell
python -c "import joblib, sklearn; print(sklearn.__version__)"
```

Confirm this file exists:

```text
training_data/noise_model.joblib
```

The bundled model was created with scikit-learn 1.9.0. Loading it with another
version can produce `InconsistentVersionWarning` or incompatible results.

The first model load can also take longer than the 10-second timeout used by
`send_sample_audio.py`. If the client times out but the relay later prints
`Loaded noise model`, run the sample command again; later predictions use the
in-memory model cache.

The FFT page still shows `rule_sound_type` when the model cannot load.

### Microphone readings are zero or constant

- Recheck `SCK`, `WS`, `SD`, `VDD`, `GND`, and `L/R`.
- Confirm `SENSOR_MODE = "inmp441"`.
- Confirm the MicroPython build supports `machine.I2S`.
- Inspect `raw_peak_i2s`, `centered_peak`, and `rms` in the Pico console.

### Relay receives data but does not submit on-chain

```powershell
curl.exe http://127.0.0.1:8000/health
```

Check:

- `submitOnchain` is `true`.
- `lastError` is `null`.
- Anvil is running at `rpcUrl`.
- The contract address is current.
- The oracle address is authorized.
- The room has a registered tenant with enough deposit.

### Port 8000 is already in use

```powershell
Get-NetTCPConnection -LocalPort 8000
```

Use another port:

```powershell
$env:ORACLE_PORT = "8001"
python hardware\web3_oracle.py
```

Also change all Pico URLs and helper script `-BackendPort` values to the same
port.
