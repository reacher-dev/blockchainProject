import network
import ntptime
import rp2
import time
import ujson
import urequests
from machine import ADC


SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"
ORACLE_URL = "http://YOUR_WINDOWS_IP:8000/"

DEVICE_ID = "pico-w-001"
CULPRIT_ROOM = "Room A"
POST_INTERVAL_SECONDS = 5
SENSOR_MODE = "simulation"  # Use "microphone" after the MAX9814 is connected.
MICROPHONE_ADC_PIN = 26
VIOLATION_DECIBEL_THRESHOLD = 75


WIFI_STATUS_MESSAGES = {
    network.STAT_IDLE: "idle",
    network.STAT_CONNECTING: "connecting",
    network.STAT_WRONG_PASSWORD: "wrong password",
    network.STAT_NO_AP_FOUND: "Wi-Fi network not found",
    network.STAT_CONNECT_FAIL: "connection failed",
    network.STAT_GOT_IP: "connected",
}


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


def get_microphone_noise_reading():
    """
    Future MAX9814 integration point.

    Hardware wiring:
      MAX9814 VDD -> Pico 3V3(OUT)
      MAX9814 GND -> Pico GND
      MAX9814 OUT -> Pico GP26 / ADC0

    This starter implementation reads ADC values and converts them to a rough
    noise score. True decibel calibration needs a reference sound meter.
    """
    microphone = ADC(MICROPHONE_ADC_PIN)
    peak_adc = 0
    sample_count = 80

    for _ in range(sample_count):
        sample = microphone.read_u16()
        if sample > peak_adc:
            peak_adc = sample
        time.sleep_ms(10)

    rough_decibel = int(40 + (peak_adc / 65535) * 60)

    return {
        "peak_decibel": rough_decibel,
        "duration_seconds": 1,
        "source": "microphone",
        "raw_peak_adc": peak_adc,
    }


def get_noise_reading(counter):
    if SENSOR_MODE == "simulation":
        return get_simulated_noise_reading(counter)

    if SENSOR_MODE == "microphone":
        return get_microphone_noise_reading()

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
