# Hardware Prototype

This folder contains the Raspberry Pi Pico W and Windows relay prototype for the DePIN rental noise governance demo.

## Files

- `pico_noise_sender.py`: MicroPython program for Pico W. It sends simulated noise violation JSON to the Windows oracle relay every 5 seconds. It also includes a MAX9814 microphone integration point.
- `web3_oracle.py`: Windows Python HTTP relay that receives Pico W POST requests, validates JSON, and simulates future Web3 oracle signing.
- `blink.py`: Pico W LED test.
- `sfm27_buzzer.py`: SFM-27-W buzzer test. Use a transistor or MOSFET driver for proper buzzer control.

## Pico W Setup

Edit these values in `pico_noise_sender.py` before copying it to the Pico W:

```python
SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"
ORACLE_URL = "http://YOUR_WINDOWS_IP:8000/"
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

## Windows Oracle Relay

Run:

```powershell
python hardware/web3_oracle.py
```

The relay listens on port `8000` and returns:

```json
{"status": "success", "message": "Oracle received and signed"}
```

## Future MAX9814 Microphone Wiring

```text
MAX9814 VDD -> Pico 3V3(OUT)
MAX9814 GND -> Pico GND
MAX9814 OUT -> Pico GP26 / ADC0
```

Then change:

```python
SENSOR_MODE = "microphone"
```
