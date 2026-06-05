import argparse
import json
import math
import time
import urllib.error
import urllib.request


def build_samples(sample_rate, duration_ms):
    sample_count = int(sample_rate * duration_ms / 1000)
    samples = []

    for index in range(sample_count):
        value = int(1200 * math.sin(2 * math.pi * 440 * index / sample_rate))
        samples.append(value)

    return samples


def build_payload(device_id, room_id, sample_rate, duration_ms, current_db, violation):
    samples = build_samples(sample_rate, duration_ms)

    return {
        "room_id": room_id,
        "device_id": device_id,
        "timestamp": int(time.time()),
        "sample_rate": sample_rate,
        "duration_ms": duration_ms,
        "audio_format": "mono_s16le_pcm_json",
        "samples": samples,
        "current_db": current_db,
        "average_db": current_db,
        "max_db": current_db,
        "violation": violation,
        "event_id": None,
    }


def post_json(url, payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(request, timeout=10) as response:
        return response.status, response.read().decode("utf-8")


def main():
    parser = argparse.ArgumentParser(description="Send a sample audio buffer to the oracle backend.")
    parser.add_argument("--url", default="http://127.0.0.1:8000/api/audio/upload")
    parser.add_argument("--device-id", default="pico-w-001")
    parser.add_argument("--room-id", default="Room A")
    parser.add_argument("--sample-rate", type=int, default=16000)
    parser.add_argument("--duration-ms", type=int, default=250)
    parser.add_argument("--current-db", type=float, default=82)
    parser.add_argument("--violation", action="store_true")
    args = parser.parse_args()

    payload = build_payload(
        args.device_id,
        args.room_id,
        args.sample_rate,
        args.duration_ms,
        args.current_db,
        args.violation,
    )
    expected_count = int(args.sample_rate * args.duration_ms / 1000)

    print("Sending audio upload payload:")
    print(f"  samples: {len(payload['samples'])}")
    print(f"  expected samples: {expected_count}")
    print(f"  approx JSON bytes: {len(json.dumps(payload))}")

    try:
        status, text = post_json(args.url, payload)
    except urllib.error.URLError as exc:
        raise SystemExit(f"POST failed: {exc}") from exc

    print(f"\nHTTP {status}")
    print(text)


if __name__ == "__main__":
    main()
