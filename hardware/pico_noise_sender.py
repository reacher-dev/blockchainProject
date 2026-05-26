import network
import ntptime
import rp2
import time
import ujson
import urequests
from machine import I2S, Pin


SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"
ORACLE_URL = "http://YOUR_WINDOWS_IP:8000/"

DEVICE_ID = "pico-w-001"
CULPRIT_ROOM = "Room A"
POST_INTERVAL_SECONDS = 5
SENSOR_MODE = "simulation"  # Use "inmp441" after the I2S microphone is connected.
VIOLATION_DECIBEL_THRESHOLD = 75

# INMP441 I2S wiring. Change these pins if your Pico W wiring is different.
INMP441_I2S_ID = 0
INMP441_SCK_PIN = 10  # INMP441 SCK / BCLK
INMP441_WS_PIN = 11   # INMP441 WS / LRCL
INMP441_SD_PIN = 12   # INMP441 SD / DOUT
INMP441_SAMPLE_RATE = 16000
INMP441_BUFFER_SIZE = 4096


WIFI_STATUS_MESSAGES = {
    network.STAT_IDLE: "idle",
    network.STAT_CONNECTING: "connecting",
    network.STAT_WRONG_PASSWORD: "wrong password",
    network.STAT_NO_AP_FOUND: "Wi-Fi network not found",
    network.STAT_CONNECT_FAIL: "connection failed",
    network.STAT_GOT_IP: "connected",
}

microphone_i2s = None


def connect_wifi():
    rp2.country("TW")

    wlan = network.WLAN(network.STA_IF)
    wlan.active(True)

    print("Scanning Wi-Fi networks...")
    for item in wlan.scan():
        ssid = item[0].decode("utf-8", "ignore")
        channel = item[2]
        rssi = item[3]
        print("  SSID: {!r}, channel: {}, RSSI: {}".format(ssid, channel, rssi))

    if not wlan.isconnected():
        print("Connecting to Wi-Fi...")
        wlan.connect(SSID, PASSWORD)

        for _ in range(30):
            if wlan.isconnected():
                break
            status = wlan.status()
            print("Waiting for Wi-Fi...", WIFI_STATUS_MESSAGES.get(status, status))
            time.sleep(1)

    if not wlan.isconnected():
        status = wlan.status()
        message = WIFI_STATUS_MESSAGES.get(status, status)
        raise RuntimeError("Wi-Fi connection failed: {}".format(message))

    print("Wi-Fi connected")
    print("Network config:", wlan.ifconfig())
    return wlan


def sync_time():
    print("Syncing time with NTP...")

    for attempt in range(1, 6):
        try:
            ntptime.settime()
            print("NTP time synced")
            print("UTC time:", time.localtime())
            return
        except Exception as exc:
            print("NTP sync failed, attempt {}: {}".format(attempt, exc))
            time.sleep(2)

    print("NTP sync skipped after retries; timestamp may be incorrect")


def get_simulated_noise_reading(counter):
    return {
        "peak_decibel": 80 + (counter % 10),
        "duration_seconds": POST_INTERVAL_SECONDS,
        "source": "simulation",
    }


def get_inmp441_noise_reading():
    """
    INMP441 digital I2S microphone integration point.

    Hardware wiring:
      INMP441 VDD -> Pico 3V3(OUT)
      INMP441 GND -> Pico GND
      INMP441 SCK -> Pico GP10
      INMP441 WS  -> Pico GP11
      INMP441 SD  -> Pico GP12
      INMP441 L/R -> GND

    This starter implementation reads signed 32-bit I2S samples and converts
    the peak level to a rough noise score. True dB SPL calibration needs a
    reference sound meter and a calibration offset.
    """
    global microphone_i2s

    if microphone_i2s is None:
        microphone_i2s = I2S(
            INMP441_I2S_ID,
            sck=Pin(INMP441_SCK_PIN),
            ws=Pin(INMP441_WS_PIN),
            sd=Pin(INMP441_SD_PIN),
            mode=I2S.RX,
            bits=32,
            format=I2S.MONO,
            rate=INMP441_SAMPLE_RATE,
            ibuf=INMP441_BUFFER_SIZE,
        )

    sample_bytes = bytearray(INMP441_BUFFER_SIZE)
    bytes_read = microphone_i2s.readinto(sample_bytes)

    peak = 0
    for offset in range(0, bytes_read - 3, 4):
        sample = int.from_bytes(sample_bytes[offset : offset + 4], "little", True)
        absolute = abs(sample)
        if absolute > peak:
            peak = absolute

    # Rough, uncalibrated mapping for demo thresholding. Calibrate this with a
    # real sound meter before treating it as dB SPL.
    normalized_peak = min(peak / 2147483648, 1)
    rough_decibel = int(35 + normalized_peak * 75)

    if rough_decibel < 35:
        rough_decibel = 35

    return {
        "peak_decibel": rough_decibel,
        "duration_seconds": 1,
        "source": "inmp441",
        "raw_peak_i2s": peak,
    }


def get_noise_reading(counter):
    if SENSOR_MODE == "simulation":
        return get_simulated_noise_reading(counter)

    if SENSOR_MODE == "inmp441":
        return get_inmp441_noise_reading()

    raise ValueError("Unknown SENSOR_MODE: {}".format(SENSOR_MODE))


def build_violation_payload(counter):
    reading = get_noise_reading(counter)

    return {
        "device_id": DEVICE_ID,
        "timestamp": int(time.time()),
        "violation_details": {
            "culprit_room": CULPRIT_ROOM,
            "peak_decibel": reading["peak_decibel"],
            "duration_seconds": reading["duration_seconds"],
            "source": reading["source"],
        },
    }


def post_violation(payload):
    headers = {"Content-Type": "application/json"}
    response = None

    try:
        response = urequests.post(
            ORACLE_URL,
            data=ujson.dumps(payload),
            headers=headers,
        )
        print("POST status:", response.status_code)
        print("POST response:", response.text)
    finally:
        if response is not None:
            response.close()


def main():
    connect_wifi()
    sync_time()

    counter = 0
    while True:
        payload = build_violation_payload(counter)
        print("Sending:", payload)

        try:
            post_violation(payload)
        except Exception as exc:
            print("POST failed:", exc)

        counter += 1
        time.sleep(POST_INTERVAL_SECONDS)


main()
