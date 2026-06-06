"""
Simulate Pico W noise monitoring without hardware.

Streams noise readings to the Oracle every INTERVAL seconds.
When noise stays above THRESHOLD for VIOLATION_SECONDS continuously,
sends a violation event (which the Oracle submits on-chain).
After the violation, continues streaming — just like real hardware.

Usage:
  python3 hardware/simulate_noise.py                        # default: Room A, 82 dB
  python3 hardware/simulate_noise.py --room "Room B" --db 85
  python3 hardware/simulate_noise.py --db 65                # below threshold, no violation
"""

import argparse
import json
import time
import urllib.request
import urllib.error

ORACLE_URL = "http://127.0.0.1:8000"
THRESHOLD_DB = 70
VIOLATION_SECONDS = 5
INTERVAL = 0.5  # seconds between readings


def post_json(url, payload):
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return resp.status, json.loads(resp.read().decode("utf-8"))


def _make_sine_samples(freq=440, duration_ms=250, sample_rate=16000):
    """產生正弦波樣本，模擬音訊用於 ML 分類測試。"""
    import math
    n = int(sample_rate * duration_ms / 1000)
    return [int(16000 * math.sin(2 * math.pi * freq * i / sample_rate)) for i in range(n)]


def send_reading(room, decibels, duration_seconds, oracle_url=ORACLE_URL,
                 device_id="sim-001", include_audio=False):
    is_violation = decibels > THRESHOLD_DB
    # violation 時附帶模擬音訊樣本，讓 Oracle 跑 ML 分類
    audio_samples = _make_sine_samples() if (include_audio and is_violation) else []

    payload = {
        "device_id": device_id,
        "timestamp": int(time.time()),
        "violation_details": {
            "culprit_room": room,
            "peak_decibel": decibels,
            "estimated_db": decibels,
            "duration_seconds": duration_seconds,
            "event_type": "violation" if is_violation else "monitoring",
            "source": "simulation",
            "audio_samples": audio_samples,
            "audio_sample_rate": 16000,
        },
    }
    return post_json(f"{oracle_url}/noise/ingest", payload)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--room", default="Room A")
    parser.add_argument("--db", type=float, default=82)
    parser.add_argument("--url", default=ORACLE_URL)
    parser.add_argument("--audio", action="store_true", help="violation 時附帶模擬音訊樣本做 ML 分類")
    args = parser.parse_args()

    oracle_url = args.url
    room = args.room
    db = args.db
    include_audio = args.audio
    above_since = None
    violation_sent = False

    print(f"Simulating noise for {room} at {db} dB (threshold {THRESHOLD_DB} dB)")
    print(f"Violation will trigger after {VIOLATION_SECONDS}s above threshold")
    if include_audio:
        print("ML classification: ON (violation events will include audio samples)")
    print("Press Ctrl+C to stop\n")

    try:
        while True:
            now = time.time()

            if db > THRESHOLD_DB:
                if above_since is None:
                    above_since = now
                    violation_sent = False
                    print(f"[{time.strftime('%H:%M:%S')}] Above threshold — accumulating...")

                elapsed = now - above_since

                if elapsed >= VIOLATION_SECONDS and not violation_sent:
                    # Trigger on-chain violation
                    print(f"[{time.strftime('%H:%M:%S')}] {VIOLATION_SECONDS}s elapsed — sending violation on-chain...")
                    status, resp = send_reading(room, db, duration_seconds=VIOLATION_SECONDS,
                                               oracle_url=oracle_url, include_audio=include_audio)
                    data = resp.get("data", {})
                    onchain = data.get("onchain", {})
                    if onchain.get("submitted"):
                        print(f"[{time.strftime('%H:%M:%S')}] On-chain! tx={onchain.get('txHash','')[:12]}...")
                    else:
                        print(f"[{time.strftime('%H:%M:%S')}] Not submitted: {onchain.get('error') or onchain.get('reason')}")
                    sound_type = data.get("soundType")
                    confidence = data.get("soundTypeConfidence")
                    if sound_type:
                        print(f"[{time.strftime('%H:%M:%S')}] ML 分類: {sound_type} (confidence={confidence})")
                    violation_sent = True
                    print(f"\n[{time.strftime('%H:%M:%S')}] 完成，停止模擬。")
                    return
                else:
                    # Send monitoring reading to keep frontend alive
                    send_reading(room, db, duration_seconds=round(elapsed, 1), oracle_url=oracle_url)
                    print(f"[{time.strftime('%H:%M:%S')}] {db:.0f} dB (+{elapsed:.1f}s)", end="\r")
            else:
                if above_since is not None:
                    print(f"\n[{time.strftime('%H:%M:%S')}] Back below threshold")
                above_since = None
                violation_sent = False
                send_reading(room, db, duration_seconds=0, oracle_url=oracle_url)
                print(f"[{time.strftime('%H:%M:%S')}] {db:.0f} dB (monitoring)", end="\r")

            time.sleep(INTERVAL)

    except KeyboardInterrupt:
        print("\nStopped.")
    except urllib.error.URLError as e:
        print(f"\nCannot reach Oracle at {oracle_url}: {e}")
        print("Make sure ./start.sh is running.")


if __name__ == "__main__":
    main()
