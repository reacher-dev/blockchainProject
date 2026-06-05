# Hardware Prototype

This folder contains the Raspberry Pi Pico W and Windows relay prototype for the DePIN rental noise governance demo.

## Files

- `pico_noise_sender.py`: MicroPython program for Pico W. It reads the INMP441 I2S microphone, sends live monitoring JSON every 0.1 seconds, and only reports an on-chain violation after sustained noise.
- `web3_oracle.py`: Python HTTP relay that receives Pico W POST requests, validates JSON, keeps latest/history state for the frontend/backend integration, and can optionally submit an oracle-signed `reportNoise` transaction to Anvil.
- `noise_monitor.html`: Standalone browser graph for live `estimatedDb`, `decibels`, and `noiseLevel`.
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

Current monitoring behavior:

- The Pico posts data every `0.1` seconds.
- `estimated_db` is the live microphone-derived dB estimate for display.
- `noise_level` is a normalized 0-100 microphone intensity value.
- `raw_peak_i2s` is the raw I2S peak value for debugging.
- `peak_decibel` is the reporting value used by the backend/contract.
- Short spikes are clamped below the threshold for `peak_decibel`.
- A real violation is reported only after `estimated_db >= 75` for `5` continuous seconds.
- Optional raw audio sample upload is separate from normal dB telemetry and is disabled by default.

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

Or start the backend, open `noise_monitor.html`, and run the Pico W script with one command:

```powershell
powershell -ExecutionPolicy Bypass -File hardware\run_hardware_test.ps1
```

If automatic Pico detection fails, pass the COM port explicitly:

```powershell
powershell -ExecutionPolicy Bypass -File hardware\run_hardware_test.ps1 -Port COM3
```

Verify that the backend is receiving real microphone data:

```powershell
curl http://127.0.0.1:8000/noise/latest
```

The response should include:

```json
"source": "inmp441"
```

To view the live graph, open `hardware/noise_monitor.html` in a browser while the backend is running. It polls `GET /noise/latest` every `100ms`.

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
    "peak_decibel": 74,
    "estimated_db": 92,
    "noise_level": 88,
    "raw_peak_i2s": 123456,
    "duration_seconds": 0.1,
    "source": "inmp441",
    "event_type": "monitoring",
    "violation_required_seconds": 5
  }
}
```

Endpoints:

- `POST /` or `POST /noise/ingest`: receive Pico W payloads.
- `POST /api/audio/upload`: receive optional short PCM sample buffers for future FFT/AI analysis.
- `GET /noise/latest`: latest normalized noise event for frontend polling.
- `GET /noise/history`: recent normalized noise events.
- `GET /noise/history?device_id=pico-w-001`: recent events from one Pico W.
- `GET /devices`: latest backend status for each Pico W device.
- `GET /health`: backend health/config status.

The relay also appends every received hardware event to:

```text
hardware/noise_events.jsonl
```

Override the path when needed:

```powershell
set ORACLE_EVENT_LOG_PATH=C:\path\to\noise_events.jsonl
```

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

Test the optional audio upload endpoint:

```powershell
python hardware/send_sample_audio.py --room-id "Room A" --duration-ms 250 --violation
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

## Optional Audio Upload

This step only prepares a raw audio data pipeline for future FFT or AI analysis. The backend does not run FFT, YAMNet, or classification, and raw audio is not permanently stored by default for privacy reasons.

Pico W config:

```python
ENABLE_AUDIO_UPLOAD = False
AUDIO_UPLOAD_INTERVAL_SECONDS = 5
AUDIO_BUFFER_DURATION_MS = 250
AUDIO_UPLOAD_TEST_MODE = False
```

Payload sent to `POST /api/audio/upload`:

```json
{
  "room_id": "Room A",
  "device_id": "pico-w-001",
  "timestamp": 1779611806,
  "sample_rate": 16000,
  "duration_ms": 16,
  "audio_format": "mono_s16le_pcm_json",
  "samples": [0, 12, -8],
  "current_db": 82,
  "average_db": 82,
  "max_db": 82,
  "violation": true,
  "event_id": null
}
```

`samples` is a JSON list of mono int16 PCM values. On Pico W, the practical sample count may be smaller than `AUDIO_BUFFER_DURATION_MS` because JSON payload size and RAM are limited. Keep `ENABLE_AUDIO_UPLOAD = False` during normal monitoring and enable it only for violation captures or manual tests.

## Continuous Threshold Recording

For listening to the actual sound when noise crosses the threshold, use the mic-test recording flow. This keeps normal dB telemetry unchanged, then records short PCM chunks only while the sound is above the threshold.

Pico W config:

```python
ENABLE_MIC_TEST_UPLOAD = False
MIC_TEST_START_DECIBEL_THRESHOLD = 55
MIC_TEST_CHUNK_DURATION_MS = 500
MIC_TEST_WAV_SAMPLE_RATE = 8000
MIC_TEST_CONTINUE_DECIBEL_THRESHOLD = 50
MIC_TEST_SILENCE_STOP_SECONDS = 6
```

Behavior:

- Recording starts when `estimated_db >= MIC_TEST_START_DECIBEL_THRESHOLD`.
- After recording starts, readings above `MIC_TEST_CONTINUE_DECIBEL_THRESHOLD` are still treated as part of the same continuous noise event.
- Pico W uploads 500 ms mono int16 PCM chunks as base64.
- All chunks in the same `session_id` are appended into one WAV file.
- `MIC_TEST_WAV_SAMPLE_RATE` controls WAV playback speed/pitch. Raise it if playback sounds slow/low; lower it if playback sounds fast/high.
- Recording stops after the sound stays below the continue threshold for 6 seconds.
- WAV files are saved under `mic_test_audio/` for testing.

Run the full test flow:

```powershell
powershell -ExecutionPolicy Bypass -File hardware\run_mic_test.ps1 -Port COM3
```

Then open:

```text
http://127.0.0.1:8000/mic_test_audio/
```

This feature stores raw audio files for debugging, so only enable it during controlled tests.

## Backend FFT Demo

The FFT demo runs only on the backend after `POST /api/mic-test/upload` receives an audio chunk. Pico W still only uploads PCM audio and does not run FFT, AI classification, or YAMNet.

Install the backend dependency if it is not already available:

```powershell
python -m pip install numpy
```

Start the backend and run the mic test flow:

```powershell
powershell -ExecutionPolicy Bypass -File hardware\run_mic_test.ps1 -Port COM3
```

Open the FFT graph:

```text
http://127.0.0.1:8000/fft_demo/
```

The page polls the backend once per second, so the displayed `sound_type` updates automatically when Pico W uploads a new audio chunk.

Use the label buttons on the FFT page to save the correct label for the latest audio chunk. The backend appends FFT features to:

```text
training_data/labels.csv
```

If the latest FFT result has a WAV file, it is copied into:

```text
training_data/<label>/
```

Available labels:

- `human_voice`
- `music`
- `rain`
- `car`
- `other_noise`
- `background`

Train the first sklearn model from collected labels:

```powershell
python -m pip install scikit-learn joblib
python hardware\train_noise_model.py
```

This writes:

```text
training_data/noise_model.joblib
training_data/noise_model_metadata.json
```

When `training_data/noise_model.joblib` exists, the backend FFT demo loads it automatically and shows:

- `sound_type`: model prediction when available
- `model_confidence`
- `rule_sound_type`: old rule-based FFT result for comparison

The page fetches the latest result from:

```text
http://127.0.0.1:8000/api/fft/latest
```

The result includes:

```json
{
  "peak_frequency_hz": 440.0,
  "peak_magnitude": 0.0123,
  "low_band_energy": 0.0001,
  "speech_band_energy": 0.003,
  "high_band_energy": 0.0004,
  "sound_type": "possible_human_voice"
}
```

`sound_type` is a rule-based FFT demo label only. It is useful for testing the data pipeline and visualizing frequency content, but it is not reliable AI classification.

### Analyze Prepared WAV Files

If you prepare sound test files first, analyze them locally without Pico W:

```powershell
python hardware\analyze_wav_fft.py .\sounds\voice.wav
python hardware\analyze_wav_fft.py .\sounds\voice.wav .\sounds\music.wav .\sounds\clap.wav
```

The analyzer prints:

- `peak_frequency_hz`
- `dominant_band`
- `low_band_energy`
- `speech_band_energy`
- `high_band_energy`
- `sound_type`
- `spectral_centroid_hz`
- `spectral_flatness`
- `zero_crossing_rate`

Current demo labels:

- `possible_human_voice`
- `possible_music`
- `possible_instrument_or_music`
- `other_noise`

For machine-readable output:

```powershell
python hardware\analyze_wav_fft.py .\sounds\voice.wav --json
```

You can also upload a prepared WAV file to the backend FFT page:

```powershell
python hardware\send_wav_to_fft_demo.py .\sounds\voice.wav
```

Then open:

```text
http://127.0.0.1:8000/fft_demo/
```
