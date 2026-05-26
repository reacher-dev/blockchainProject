import argparse
import json
import time
import urllib.error
import urllib.request


def build_payload(device_id, room, decibels, source):
    return {
        "device_id": device_id,
        "timestamp": int(time.time()),
        "violation_details": {
            "culprit_room": room,
            "peak_decibel": decibels,
            "duration_seconds": 5,
            "source": source,
        },
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
    parser = argparse.ArgumentParser(description="Send a Pico W-shaped noise payload to the oracle backend.")
    parser.add_argument("--url", default="http://127.0.0.1:8000/noise/ingest")
    parser.add_argument("--device-id", default="pico-w-001")
    parser.add_argument("--room", default="Room A")
    parser.add_argument("--decibels", type=float, default=82)
    parser.add_argument("--source", default="simulation")
    args = parser.parse_args()

    payload = build_payload(args.device_id, args.room, args.decibels, args.source)
    print("Sending:")
    print(json.dumps(payload, indent=2))

    try:
        status, text = post_json(args.url, payload)
    except urllib.error.URLError as exc:
        raise SystemExit(f"POST failed: {exc}") from exc

    print(f"\nHTTP {status}")
    print(text)


if __name__ == "__main__":
    main()
