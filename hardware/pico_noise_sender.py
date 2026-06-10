import sys
import time
import ubinascii
import ujson
from machine import I2S, Pin

# ????????????????sb = ??? USB ????????????????????? Mac ??????????????
#            wifi = ??? WiFi ????? POST ??Oracle
TRANSPORT_MODE = "wifi"

SSID = "RyderPhone"
PASSWORD = "harry123"
ORACLE_URL = "http://172.20.10.2:8000/noise/ingest"
AUDIO_UPLOAD_URL = "http://172.20.10.2:8000/api/audio/upload"
MIC_TEST_UPLOAD_URL = "http://172.20.10.2:8000/api/mic-test/upload"
WIFI_CONNECT_TIMEOUT_SECONDS = 35

DEVICE_ID = "pico-w-001"
CULPRIT_ROOM = "Room A"
PICO_SCRIPT_VERSION = "i2s-mono-9khz-live-20260609"
POST_INTERVAL_SECONDS = 0.1
SENSOR_MODE = "inmp441"  # Use "simulation" when testing without the microphone.
VIOLATION_DECIBEL_THRESHOLD = 75
VIOLATION_REQUIRED_SECONDS = 5
ENABLE_AUDIO_UPLOAD = False
AUDIO_UPLOAD_INTERVAL_SECONDS = 5
AUDIO_BUFFER_DURATION_MS = 250
AUDIO_UPLOAD_TEST_MODE = False
ENABLE_MIC_TEST_UPLOAD = True
MIC_TEST_START_DECIBEL_THRESHOLD = 75
MIC_TEST_CHUNK_DURATION_MS = 500
MIC_TEST_WAV_SAMPLE_RATE = 9000
MIC_TEST_CONTINUE_DECIBEL_THRESHOLD = 70
MIC_TEST_SILENCE_STOP_SECONDS = 3
MIC_TEST_FORCE_RECORD_SECONDS = 0

# INMP441 I2S wiring. Change these pins if your Pico W wiring is different.
INMP441_I2S_ID = 0
INMP441_SCK_PIN = 10  # INMP441 SCK / BCLK
INMP441_WS_PIN = 11   # INMP441 WS / LRCL
INMP441_SD_PIN = 12   # INMP441 SD / DOUT
INMP441_SD_PIN_CANDIDATES = (12, 13, 9, 8, 6, 7, 16, 17, 18, 19, 20, 21, 22, 2, 3, 4, 5)
INMP441_SAMPLE_RATE = 9000
INMP441_BUFFER_SIZE = 1024
INMP441_SAMPLE_SHIFT = 14
INMP441_NOISE_FLOOR = 8
INMP441_LEVEL_SCALE = 450
INMP441_USE_STEREO_SLOTS = False
INMP441_ACTIVE_CHANNEL = "auto"  # auto, left, or right. INMP441 L/R->GND normally uses left.
INMP441_STARTUP_DIAGNOSTIC = False
INMP441_RAW_DEBUG = False
INMP441_ZERO_REINIT_SECONDS = 6


WIFI_STATUS_MESSAGES = {
    0: "idle",
    1: "connecting",
    -3: "wrong password",
    -2: "Wi-Fi network not found",
    -1: "connection failed",
    3: "connected",
}

microphone_i2s = None
noise_window = []
last_audio_upload_at = 0
mic_test_recording_active = False
mic_test_session_id = None
mic_test_chunk_index = 0
mic_test_last_loud_at = 0
last_mic_test_idle_log_at = 0
mic_test_force_recording_until = 0
mic_test_force_recording_done = False
last_i2s_zero_log_at = 0
last_i2s_nonzero_at = 0
last_i2s_raw_debug_at = 0


def read_signed_32_le(buffer, offset):
    value = int.from_bytes(buffer[offset : offset + 4], "little")
    if value & 0x80000000:
        value -= 0x100000000
    return value


def create_microphone_i2s(i2s_id=None, use_stereo_slots=None, sck_pin=None, ws_pin=None, sd_pin=None):
    if i2s_id is None:
        i2s_id = INMP441_I2S_ID
    if use_stereo_slots is None:
        use_stereo_slots = INMP441_USE_STEREO_SLOTS
    if sck_pin is None:
        sck_pin = INMP441_SCK_PIN
    if ws_pin is None:
        ws_pin = INMP441_WS_PIN
    if sd_pin is None:
        sd_pin = INMP441_SD_PIN

    audio_format = I2S.STEREO if use_stereo_slots else I2S.MONO
    return I2S(
        i2s_id,
        sck=Pin(sck_pin),
        ws=Pin(ws_pin),
        sd=Pin(sd_pin),
        mode=I2S.RX,
        bits=32,
        format=audio_format,
        rate=INMP441_SAMPLE_RATE,
        ibuf=INMP441_BUFFER_SIZE * (2 if use_stereo_slots else 1),
    )


def iter_i2s_mic_samples(sample_bytes, bytes_read):
    if not INMP441_USE_STEREO_SLOTS:
        for offset in range(0, bytes_read - 3, 4):
            yield read_signed_32_le(sample_bytes, offset)
        return

    left_peak = 0
    right_peak = 0
    for offset in range(0, bytes_read - 7, 8):
        left_sample = read_signed_32_le(sample_bytes, offset)
        right_sample = read_signed_32_le(sample_bytes, offset + 4)
        left_abs = abs(left_sample)
        right_abs = abs(right_sample)
        if left_abs > left_peak:
            left_peak = left_abs
        if right_abs > right_peak:
            right_peak = right_abs

    if INMP441_ACTIVE_CHANNEL == "left":
        channel_offset = 0
    elif INMP441_ACTIVE_CHANNEL == "right":
        channel_offset = 4
    else:
        channel_offset = 0 if left_peak >= right_peak else 4

    for offset in range(channel_offset, bytes_read - 3, 8):
        yield read_signed_32_le(sample_bytes, offset)


def i2s_buffer_stats(sample_bytes, bytes_read, use_stereo_slots):
    nonzero_bytes = 0
    for value in sample_bytes[:bytes_read]:
        if value:
            nonzero_bytes += 1

    mono_peak = 0
    left_peak = 0
    right_peak = 0

    if use_stereo_slots:
        for offset in range(0, bytes_read - 7, 8):
            left_abs = abs(read_signed_32_le(sample_bytes, offset))
            right_abs = abs(read_signed_32_le(sample_bytes, offset + 4))
            if left_abs > left_peak:
                left_peak = left_abs
            if right_abs > right_peak:
                right_peak = right_abs
        mono_peak = left_peak if left_peak >= right_peak else right_peak
    else:
        for offset in range(0, bytes_read - 3, 4):
            sample_abs = abs(read_signed_32_le(sample_bytes, offset))
            if sample_abs > mono_peak:
                mono_peak = sample_abs

    return mono_peak, left_peak, right_peak, nonzero_bytes


def print_i2s_raw_probe():
    global microphone_i2s
    global INMP441_I2S_ID
    global INMP441_SD_PIN
    global INMP441_USE_STEREO_SLOTS
    global INMP441_ACTIVE_CHANNEL

    print("I2S diagnostic start")
    print(
        "Pins: SCK=GP{}, WS=GP{}, SD=GP{}, sample_rate={}".format(
            INMP441_SCK_PIN,
            INMP441_WS_PIN,
            INMP441_SD_PIN,
            INMP441_SAMPLE_RATE,
        )
    )

    best = None
    sd_candidates = []
    for candidate in INMP441_SD_PIN_CANDIDATES:
        if candidate not in sd_candidates and candidate not in (INMP441_SCK_PIN, INMP441_WS_PIN):
            sd_candidates.append(candidate)

    for sd_pin in sd_candidates:
        for i2s_id in (INMP441_I2S_ID, 1 - INMP441_I2S_ID):
            for use_stereo in (True, False):
                test_i2s = None
                try:
                    test_i2s = create_microphone_i2s(
                        i2s_id=i2s_id,
                        use_stereo_slots=use_stereo,
                        sd_pin=sd_pin,
                    )
                    sample_bytes = bytearray(INMP441_BUFFER_SIZE)
                    time.sleep_ms(100)
                    bytes_read = 0
                    for _ in range(4):
                        bytes_read = test_i2s.readinto(sample_bytes)
                        time.sleep_ms(20)
                    peak, left_peak, right_peak, nonzero_bytes = i2s_buffer_stats(
                        sample_bytes,
                        bytes_read,
                        use_stereo,
                    )
                    first_bytes = " ".join("{:02x}".format(b) for b in sample_bytes[: min(bytes_read, 16)])
                    print(
                        "I2S probe sd=GP{} id={} format={} bytes={} peak={} left={} right={} nonzero_bytes={} first={}".format(
                            sd_pin,
                            i2s_id,
                            "stereo" if use_stereo else "mono",
                            bytes_read,
                            peak,
                            left_peak,
                            right_peak,
                            nonzero_bytes,
                            first_bytes,
                        )
                    )
                    if peak > 0 and (best is None or peak > best["peak"]):
                        best = {
                            "i2s_id": i2s_id,
                            "sd_pin": sd_pin,
                            "use_stereo": use_stereo,
                            "peak": peak,
                            "active_channel": "auto",
                        }
                except Exception as exc:
                    print(
                        "I2S probe failed sd=GP{} id={} format={}: {}".format(
                            sd_pin,
                            i2s_id,
                            "stereo" if use_stereo else "mono",
                            exc,
                        )
                    )
                finally:
                    if test_i2s is not None:
                        try:
                            test_i2s.deinit()
                        except Exception:
                            pass

    if best:
        INMP441_I2S_ID = best["i2s_id"]
        INMP441_SD_PIN = best["sd_pin"]
        INMP441_USE_STEREO_SLOTS = best["use_stereo"]
        INMP441_ACTIVE_CHANNEL = best["active_channel"]
        print(
            "I2S diagnostic selected sd=GP{} id={} format={} peak={}".format(
                best["sd_pin"],
                best["i2s_id"],
                "stereo" if best["use_stereo"] else "mono",
                best["peak"],
            )
        )
        microphone_i2s = create_microphone_i2s(
            i2s_id=best["i2s_id"],
            use_stereo_slots=best["use_stereo"],
            sd_pin=best["sd_pin"],
        )
    else:
        print("I2S diagnostic found no non-zero samples on any SD candidate.")
        print("If SCK is not GP{} or WS is not GP{}, update INMP441_SCK_PIN/INMP441_WS_PIN.".format(INMP441_SCK_PIN, INMP441_WS_PIN))
        print("Also check VDD=3V3, GND, L/R=GND, and INMP441 DOUT connected to a scanned GP pin.")
        microphone_i2s = create_microphone_i2s()


def connect_wifi():
    import network, rp2
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
    import ntptime
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
        "audio_samples": [],
        "audio_duration_ms": 0,
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
    global last_i2s_zero_log_at
    global last_i2s_nonzero_at
    global last_i2s_raw_debug_at

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

    debug_now = time.time()
    if INMP441_RAW_DEBUG and debug_now - last_i2s_raw_debug_at >= 2:
        preview = " ".join("{:02x}".format(b) for b in sample_bytes[: min(bytes_read, 16)])
        print(
            "I2S raw debug version={} rate={} bytes_read={} first={}".format(
                PICO_SCRIPT_VERSION,
                INMP441_SAMPLE_RATE,
                bytes_read,
                preview,
            )
        )
        last_i2s_raw_debug_at = debug_now

    raw_peak = 0
    shifted_sum = 0
    sample_count = 0
    audio_samples = []
    max_audio_samples = int((INMP441_SAMPLE_RATE * AUDIO_BUFFER_DURATION_MS) / 1000)

    raw_samples = []
    for offset in range(0, bytes_read - 3, 4):
        raw_sample = read_signed_32_le(sample_bytes, offset)
        raw_samples.append(raw_sample)
        raw_absolute = abs(raw_sample)
        if raw_absolute > raw_peak:
            raw_peak = raw_absolute

        shifted_sample = raw_sample >> INMP441_SAMPLE_SHIFT
        shifted_sum += shifted_sample
        if len(audio_samples) < max_audio_samples:
            audio_samples.append(max(-32768, min(32767, shifted_sample)))
        sample_count += 1

    now = time.time()
    if raw_peak > 0:
        last_i2s_nonzero_at = now
    elif raw_peak == 0 and now - last_i2s_zero_log_at >= 3:
        print(
            "I2S warning: all-zero samples. bytes_read={}, stereo_slots={}, active_channel={}".format(
                bytes_read,
                INMP441_USE_STEREO_SLOTS,
                INMP441_ACTIVE_CHANNEL,
            )
        )
        last_i2s_zero_log_at = now

    if raw_peak == 0 and last_i2s_nonzero_at and now - last_i2s_nonzero_at >= INMP441_ZERO_REINIT_SECONDS:
        print("I2S warning: reinitializing microphone after continuous zero samples")
        try:
            microphone_i2s.deinit()
        except Exception:
            pass
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
        last_i2s_nonzero_at = now

    if sample_count == 0:
        return {
            "peak_decibel": 0,
            "estimated_db": 0,
            "noise_level": 0,
            "duration_seconds": 1,
            "source": "inmp441",
            "raw_peak_i2s": 0,
            "audio_samples": [],
            "audio_duration_ms": 0,
        }

    mean = shifted_sum / sample_count
    squared_sum = 0
    centered_peak = 0

    for raw_sample in raw_samples:
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
        "audio_samples": audio_samples,
        "audio_duration_ms": int((len(audio_samples) * 1000) / INMP441_SAMPLE_RATE),
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

    avg_db = sum(item["estimated_db"] for item in noise_window) / len(noise_window)
    return avg_db > VIOLATION_DECIBEL_THRESHOLD


def build_violation_payload(counter):
    reading = get_noise_reading(counter)
    now = int(time.time())
    event_type = "monitoring"
    # Pico ???????????????????????????????????????????Oracle
    audio_samples = reading.get("audio_samples", [])[:128]

    telemetry_payload = {
        "device_id": DEVICE_ID,
        "timestamp": now,
        "violation_details": {
            "culprit_room": CULPRIT_ROOM,
            "peak_decibel": reading["estimated_db"],
            "estimated_db": reading["estimated_db"],
            "noise_level": reading["noise_level"],
            "raw_peak_i2s": reading["raw_peak_i2s"],
            "duration_seconds": POST_INTERVAL_SECONDS,
            "source": reading["source"],
            "event_type": "monitoring",
            "violation_required_seconds": VIOLATION_REQUIRED_SECONDS,
            "audio_samples": audio_samples,
            "audio_sample_rate": INMP441_SAMPLE_RATE,
        },
    }

    return telemetry_payload, reading, event_type


def build_audio_upload_payload(reading, event_type, now):
    samples = reading.get("audio_samples") or []
    if noise_window:
        average_db = sum(item["estimated_db"] for item in noise_window) / len(noise_window)
        max_db = max(item["estimated_db"] for item in noise_window)
    else:
        average_db = reading["estimated_db"]
        max_db = reading["estimated_db"]

    return {
        "room_id": CULPRIT_ROOM,
        "device_id": DEVICE_ID,
        "timestamp": now,
        "sample_rate": INMP441_SAMPLE_RATE,
        "duration_ms": reading.get("audio_duration_ms", 0),
        "audio_format": "mono_s16le_pcm_json",
        "samples": samples,
        "current_db": reading["estimated_db"],
        "average_db": average_db,
        "max_db": max_db,
        "violation": event_type == "violation",
        "event_id": None,
    }


def should_upload_audio(reading, event_type, now):
    global last_audio_upload_at

    if not ENABLE_AUDIO_UPLOAD:
        return False

    samples = reading.get("audio_samples") or []
    if not samples:
        return False

    if not AUDIO_UPLOAD_TEST_MODE and event_type != "violation":
        return False

    if now - last_audio_upload_at < AUDIO_UPLOAD_INTERVAL_SECONDS:
        return False

    last_audio_upload_at = now
    return True


def send_via_usb(payload):
    # DATA: ??????Mac ????????????????????????????????????debug print ????
    sys.stdout.write("DATA:" + ujson.dumps(payload) + "\n")


def send_via_wifi(payload):
    import urequests
    headers = {"Content-Type": "application/json"}
    response = None
    try:
        response = urequests.post(ORACLE_URL, data=ujson.dumps(payload), headers=headers)
        print("POST status:", response.status_code)
    finally:
        if response is not None:
            response.close()


def post_audio_upload(payload):
    import urequests

    # Raw audio is only for future FFT/AI work. It is sent separately from dB
    # telemetry so the normal monitoring flow remains small and unchanged.
    headers = {"Content-Type": "application/json"}
    response = None

    try:
        response = urequests.post(
            AUDIO_UPLOAD_URL,
            data=ujson.dumps(payload),
            headers=headers,
        )
        print("Audio POST status:", response.status_code)
        print("Audio POST response:", response.text)
    finally:
        if response is not None:
            response.close()


def capture_mic_test_buffer(duration_ms=500):
    """
    Captures a contiguous audio buffer (default 500ms).
    Uses array.array with pre-allocation to prevent heap fragmentation and MemoryError.
    """
    import gc
    import array
    gc.collect()

    global microphone_i2s
    total_samples_needed = int((INMP441_SAMPLE_RATE * duration_ms) / 1000)
    
    # Pre-allocate array of signed 16-bit integers ('h') using a byte string
    # 2 bytes per sample
    try:
        audio_samples = array.array('h', b'\x00' * (total_samples_needed * 2))
    except MemoryError:
        print("Failed to pre-allocate array, falling back to 250ms")
        duration_ms = 250
        total_samples_needed = int((INMP441_SAMPLE_RATE * duration_ms) / 1000)
        audio_samples = array.array('h', b'\x00' * (total_samples_needed * 2))

    if SENSOR_MODE == "simulation":
        import math
        print("Simulating mic test audio capture...")
        capture_started_ms = time.ticks_ms()
        for i in range(total_samples_needed):
            val = int(8000 * math.sin(2 * math.pi * 440 * i / INMP441_SAMPLE_RATE) + 
                      4000 * math.sin(2 * math.pi * 880 * i / INMP441_SAMPLE_RATE))
            audio_samples[i] = max(-32768, min(32767, val))
            if i % 1600 == 0:
                time.sleep_ms(1)
        capture_ended_ms = time.ticks_ms()
        elapsed_ms = max(time.ticks_diff(capture_ended_ms, capture_started_ms), 1)
        effective_sample_rate = int((len(audio_samples) * 1000) / elapsed_ms)
        return audio_samples, elapsed_ms, effective_sample_rate, capture_started_ms, capture_ended_ms

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
    index = 0
    capture_started_ms = time.ticks_ms()
    while index < total_samples_needed:
        bytes_read = microphone_i2s.readinto(sample_bytes)
        if bytes_read == 0:
            time.sleep_ms(1)
            continue
        for offset in range(0, bytes_read - 3, 4):
            raw_sample = read_signed_32_le(sample_bytes, offset)
            shifted_sample = raw_sample >> INMP441_SAMPLE_SHIFT
            audio_samples[index] = max(-32768, min(32767, shifted_sample))
            index += 1
            if index >= total_samples_needed:
                break
    capture_ended_ms = time.ticks_ms()
    elapsed_ms = max(time.ticks_diff(capture_ended_ms, capture_started_ms), 1)
    effective_sample_rate = int((len(audio_samples) * 1000) / elapsed_ms)
    return (
        audio_samples,
        elapsed_ms,
        effective_sample_rate,
        capture_started_ms,
        capture_ended_ms,
    )


def encode_pcm_base64(audio_samples):
    try:
        raw_pcm = audio_samples.tobytes()
    except AttributeError:
        raw_pcm = bytes(audio_samples)

    encoded = ubinascii.b2a_base64(raw_pcm).strip()
    try:
        return encoded.decode("ascii")
    except AttributeError:
        return encoded


def build_mic_test_payload(audio_samples, duration_ms, effective_sample_rate, session_id, chunk_index, is_final, capture_started_ms, capture_ended_ms):
    return {
        "device_id": DEVICE_ID,
        "timestamp": int(time.time()),
        "sample_rate": MIC_TEST_WAV_SAMPLE_RATE,
        "hardware_sample_rate": INMP441_SAMPLE_RATE,
        "measured_capture_sample_rate": effective_sample_rate,
        "duration_ms": duration_ms,
        "audio_format": "int16_pcm_base64",
        "channels": 1,
        "session_id": session_id,
        "chunk_index": chunk_index,
        "is_final": is_final,
        "capture_started_ms": capture_started_ms,
        "capture_ended_ms": capture_ended_ms,
        "sample_count": len(audio_samples),
        "pcm_base64": encode_pcm_base64(audio_samples),
    }


def post_mic_test(payload):
    import urequests

    headers = {"Content-Type": "application/json"}
    response = None
    try:
        response = urequests.post(
            MIC_TEST_UPLOAD_URL,
            data=ujson.dumps(payload),
            headers=headers,
        )
        print("Mic test POST status:", response.status_code)
        print("Mic test POST response:", response.text)
    finally:
        if response is not None:
            response.close()


def main():
    global mic_test_recording_active
    global mic_test_session_id
    global mic_test_chunk_index
    global mic_test_last_loud_at
    global last_mic_test_idle_log_at
    global mic_test_force_recording_until
    global mic_test_force_recording_done

    connect_wifi()
    sync_time()
    print("Pico script version:", PICO_SCRIPT_VERSION)
    print(
        "I2S config: id={}, sck=GP{}, ws=GP{}, sd=GP{}, rate={}, bits=32, format=MONO".format(
            INMP441_I2S_ID,
            INMP441_SCK_PIN,
            INMP441_WS_PIN,
            INMP441_SD_PIN,
            INMP441_SAMPLE_RATE,
        )
    )
    if SENSOR_MODE == "inmp441" and INMP441_STARTUP_DIAGNOSTIC:
        print_i2s_raw_probe()

    counter = 0
    while True:
        payload, reading, event_type = build_violation_payload(counter)
        print("Sending:", payload)

        try:
            if TRANSPORT_MODE == "usb":
                send_via_usb(payload)
            else:
                send_via_wifi(payload)
        except Exception as exc:
            print("Send failed:", exc)

        now = int(time.time())
        if should_upload_audio(reading, event_type, now):
            audio_payload = build_audio_upload_payload(reading, event_type, now)
            print("Sending audio sample count:", len(audio_payload["samples"]))
            try:
                post_audio_upload(audio_payload)
            except Exception as exc:
                print("Audio POST failed:", exc)

        if ENABLE_MIC_TEST_UPLOAD:
            starts_recording = reading["estimated_db"] >= MIC_TEST_START_DECIBEL_THRESHOLD
            still_noisy = reading["estimated_db"] >= MIC_TEST_CONTINUE_DECIBEL_THRESHOLD
            force_recording_active = (
                MIC_TEST_FORCE_RECORD_SECONDS > 0
                and not mic_test_force_recording_done
            )

            if force_recording_active and not mic_test_recording_active:
                mic_test_recording_active = True
                mic_test_session_id = "{}-background-{}".format(DEVICE_ID, now)
                mic_test_chunk_index = 0
                mic_test_force_recording_until = now + MIC_TEST_FORCE_RECORD_SECONDS
                print(
                    "Background recording mode. Recording {} seconds: {}".format(
                        MIC_TEST_FORCE_RECORD_SECONDS,
                        mic_test_session_id,
                    )
                )
            elif starts_recording:
                mic_test_last_loud_at = now
                if not mic_test_recording_active:
                    mic_test_recording_active = True
                    mic_test_session_id = "{}-{}".format(DEVICE_ID, now)
                    mic_test_chunk_index = 0
                    print("Noise threshold crossed. Starting recording session:", mic_test_session_id)
            elif mic_test_recording_active and still_noisy:
                mic_test_last_loud_at = now
            elif not mic_test_recording_active and now - last_mic_test_idle_log_at >= 2:
                print(
                    "Mic test waiting: estimated_db={} < start_threshold={}".format(
                        reading["estimated_db"],
                        MIC_TEST_START_DECIBEL_THRESHOLD,
                    )
                )
                last_mic_test_idle_log_at = now

            if mic_test_recording_active:
                if mic_test_force_recording_until > 0:
                    silence_expired = now >= mic_test_force_recording_until
                else:
                    silence_expired = (
                        not still_noisy
                        and now - mic_test_last_loud_at >= MIC_TEST_SILENCE_STOP_SECONDS
                    )
                try:
                    import gc
                    gc.collect()
                    samples, actual_duration_ms, effective_sample_rate, capture_started_ms, capture_ended_ms = capture_mic_test_buffer(MIC_TEST_CHUNK_DURATION_MS)
                    mic_test_payload = build_mic_test_payload(
                        samples,
                        actual_duration_ms,
                        effective_sample_rate,
                        mic_test_session_id,
                        mic_test_chunk_index,
                        silence_expired,
                        capture_started_ms,
                        capture_ended_ms,
                    )
                    print(
                        "Sending recording chunk {} ({} samples, wav={} Hz, measured={} Hz, final={})".format(
                            mic_test_chunk_index,
                            len(samples),
                            MIC_TEST_WAV_SAMPLE_RATE,
                            effective_sample_rate,
                            silence_expired,
                        )
                    )
                    post_mic_test(mic_test_payload)
                    mic_test_chunk_index += 1

                    mic_test_payload = None
                    samples = None
                    gc.collect()

                    if silence_expired:
                        print("Recording session finished:", mic_test_session_id)
                        mic_test_recording_active = False
                        mic_test_session_id = None
                        mic_test_chunk_index = 0
                        if mic_test_force_recording_until > 0:
                            mic_test_force_recording_until = 0
                            mic_test_force_recording_done = True
                except Exception as exc:
                    print("Mic test capture/upload failed:", exc)

        counter += 1
        if not (ENABLE_MIC_TEST_UPLOAD and mic_test_recording_active):
            time.sleep(POST_INTERVAL_SECONDS)


main()


