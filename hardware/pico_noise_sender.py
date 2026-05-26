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
WIFI_CONNECT_TIMEOUT_SECONDS = 35

DEVICE_ID = "pico-w-001"
CULPRIT_ROOM = "Room A"
POST_INTERVAL_SECONDS = 0.1
SENSOR_MODE = "inmp441"  # Use "simulation" when testing without the microphone.
VIOLATION_DECIBEL_THRESHOLD = 75
VIOLATION_REQUIRED_SECONDS = 5

# INMP441 I2S wiring. Change these pins if your Pico W wiring is different.
INMP441_I2S_ID = 0
INMP441_SCK_PIN = 10  # INMP441 SCK / BCLK
INMP441_WS_PIN = 11   # INMP441 WS / LRCL
INMP441_SD_PIN = 12   # INMP441 SD / DOUT
INMP441_SAMPLE_RATE = 16000
INMP441_BUFFER_SIZE = 1024
INMP441_SAMPLE_SHIFT = 14
INMP441_NOISE_FLOOR = 8
INMP441_LEVEL_SCALE = 450


WIFI_STATUS_MESSAGES = {
    network.STAT_IDLE: "idle",
    network.STAT_CONNECTING: "connecting",
    network.STAT_WRONG_PASSWORD: "wrong password",
    network.STAT_NO_AP_FOUND: "Wi-Fi network not found",
    network.STAT_CONNECT_FAIL: "connection failed",
    network.STAT_GOT_IP: "connected",
}

microphone_i2s = None
noise_window = []


def read_signed_32_le(buffer, offset):
    value = int.from_bytes(buffer[offset : offset + 4], "little")
    if value & 0x80000000:
        value -= 0x100000000
    return value


def connect_wifi():
    rp2.country("TW")

    wlan = network.WLAN(network.STA_IF)
    wlan.active(False)
    time.sleep(1)
    wlan.active(True)
    time.sleep(2)

    try:
        wlan.config(pm=0xA11140)
    except Exception:
        pass

    print("Scanning Wi-Fi networks...")
    scanned_ssids = []
    for item in wlan.scan():
        ssid = item[0].decode("utf-8", "ignore")
        scanned_ssids.append(ssid)
        channel = item[2]
        rssi = item[3]
        print("  SSID: {!r}, channel: {}, RSSI: {}".format(ssid, channel, rssi))

    ssid_candidates = []
    for candidate in (SSID, SSID.strip()):
        if candidate and candidate not in ssid_candidates:
            ssid_candidates.append(candidate)

    for target_ssid in ssid_candidates:
        if scanned_ssids and target_ssid not in scanned_ssids:
            print("SSID not seen in scan, trying anyway: {!r}".format(target_ssid))

        print("Connecting to Wi-Fi SSID: {!r}".format(target_ssid))
        wlan.disconnect()
        time.sleep(1)
        wlan.connect(target_ssid, PASSWORD)

        for _ in range(WIFI_CONNECT_TIMEOUT_SECONDS):
            if wlan.isconnected():
                break
            status = wlan.status()
            print("Waiting for Wi-Fi...", WIFI_STATUS_MESSAGES.get(status, status))
            time.sleep(1)

        if wlan.isconnected():
            break

        status = wlan.status()
        message = WIFI_STATUS_MESSAGES.get(status, status)
        print("Failed to connect to {!r}: {}".format(target_ssid, message))

    if not wlan.isconnected():
        raise RuntimeError("Wi-Fi connection failed for all scanned SSID candidates")

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
    estimated_db = 55 + (counter % 30)

    return {
        "peak_decibel": estimated_db,
        "estimated_db": estimated_db,
        "noise_level": 45 + (counter % 40),
        "duration_seconds": POST_INTERVAL_SECONDS,
        "source": "simulation",
        "raw_peak_i2s": 0,
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

    raw_peak = 0
    shifted_sum = 0
    sample_count = 0

    for offset in range(0, bytes_read - 3, 4):
        raw_sample = read_signed_32_le(sample_bytes, offset)
        raw_absolute = abs(raw_sample)
        if raw_absolute > raw_peak:
            raw_peak = raw_absolute

        shifted_sample = raw_sample >> INMP441_SAMPLE_SHIFT
        shifted_sum += shifted_sample
        sample_count += 1

    if sample_count == 0:
        return {
            "peak_decibel": 0,
            "estimated_db": 0,
            "noise_level": 0,
            "duration_seconds": 1,
            "source": "inmp441",
            "raw_peak_i2s": 0,
        }

    mean = shifted_sum / sample_count
    squared_sum = 0
    centered_peak = 0

    for offset in range(0, bytes_read - 3, 4):
        raw_sample = read_signed_32_le(sample_bytes, offset)
        shifted_sample = raw_sample >> INMP441_SAMPLE_SHIFT
        centered = shifted_sample - mean
        centered_absolute = abs(centered)
        if centered_absolute > centered_peak:
            centered_peak = centered_absolute
        squared_sum += centered * centered

    rms = (squared_sum / sample_count) ** 0.5
    adjusted_rms = max(rms - INMP441_NOISE_FLOOR, 0)
    noise_level = int(min((adjusted_rms / INMP441_LEVEL_SCALE) * 100, 100))

    # Rough, uncalibrated mapping for demo thresholding. Calibrate this with a
    # real sound meter before treating it as dB SPL.
    estimated_db = int(35 + noise_level * 0.65)

    return {
        "peak_decibel": estimated_db,
        "estimated_db": estimated_db,
        "noise_level": noise_level,
        "duration_seconds": 1,
        "source": "inmp441",
        "raw_peak_i2s": raw_peak,
        "centered_peak": int(centered_peak),
        "rms": int(rms),
    }


def get_noise_reading(counter):
    if SENSOR_MODE == "simulation":
        return get_simulated_noise_reading(counter)

    if SENSOR_MODE == "inmp441":
        return get_inmp441_noise_reading()

    raise ValueError("Unknown SENSOR_MODE: {}".format(SENSOR_MODE))


def update_noise_window(reading, now):
    noise_window.append(
        {
            "timestamp": now,
            "estimated_db": reading["estimated_db"],
            "noise_level": reading["noise_level"],
            "raw_peak_i2s": reading["raw_peak_i2s"],
        }
    )

    cutoff = now - VIOLATION_REQUIRED_SECONDS
    while noise_window and noise_window[0]["timestamp"] < cutoff:
        noise_window.pop(0)


def sustained_violation_ready(now):
    if len(noise_window) < 2:
        return False

    duration = noise_window[-1]["timestamp"] - noise_window[0]["timestamp"]
    if duration < VIOLATION_REQUIRED_SECONDS:
        return False

    for item in noise_window:
        if item["estimated_db"] < VIOLATION_DECIBEL_THRESHOLD:
            return False

    return True


def build_violation_payload(counter):
    reading = get_noise_reading(counter)
    now = int(time.time())
    update_noise_window(reading, now)

    should_report_violation = sustained_violation_ready(now)
    display_db = reading["estimated_db"]

    if should_report_violation:
        report_db = reading["estimated_db"]
        duration_seconds = VIOLATION_REQUIRED_SECONDS
        event_type = "violation"
        noise_window.clear()
    else:
        # Keep live sensor data visible, but stay below the contract threshold so
        # a short spike does not create an on-chain penalty.
        report_db = min(reading["estimated_db"], VIOLATION_DECIBEL_THRESHOLD - 1)
        duration_seconds = POST_INTERVAL_SECONDS
        event_type = "monitoring"

    return {
        "device_id": DEVICE_ID,
        "timestamp": now,
        "violation_details": {
            "culprit_room": CULPRIT_ROOM,
            "peak_decibel": report_db,
            "estimated_db": display_db,
            "noise_level": reading["noise_level"],
            "raw_peak_i2s": reading["raw_peak_i2s"],
            "duration_seconds": duration_seconds,
            "source": reading["source"],
            "event_type": event_type,
            "violation_required_seconds": VIOLATION_REQUIRED_SECONDS,
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
