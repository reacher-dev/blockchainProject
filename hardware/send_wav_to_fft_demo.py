import argparse
import base64
import json
import time
import urllib.error
import urllib.request
import wave
from pathlib import Path


def clamp_int16(value):
    return max(-32768, min(32767, int(value)))


def read_wav_as_int16(path, max_duration_ms):
    with wave.open(str(path), "rb") as wav_file:
        channels = wav_file.getnchannels()
        sample_width = wav_file.getsampwidth()
        sample_rate = wav_file.getframerate()
        total_frames = wav_file.getnframes()

        if channels < 1:
            raise ValueError("WAV file must have at least one channel")
        if sample_width not in (1, 2, 4):
            raise ValueError("Only 8-bit, 16-bit, or 32-bit PCM WAV files are supported")

        max_frames = total_frames
        if max_duration_ms:
            max_frames = min(total_frames, int(sample_rate * max_duration_ms / 1000))

        raw = wav_file.readframes(max_frames)

    frame_size = channels * sample_width
    samples = []

    for offset in range(0, len(raw) - frame_size + 1, frame_size):
        channel_values = []
        for channel in range(channels):
            start = offset + channel * sample_width
            chunk = raw[start : start + sample_width]

            if sample_width == 1:
                # 8-bit PCM WAV is unsigned. Convert it to signed int16.
                value = (chunk[0] - 128) << 8
            elif sample_width == 2:
                value = int.from_bytes(chunk, "little", signed=True)
            else:
                # Keep the high 16 bits from signed 32-bit PCM.
                value = int.from_bytes(chunk, "little", signed=True) >> 16

            channel_values.append(value)

        # Mix stereo/multi-channel files down to mono because the backend demo
        # expects mono int16 PCM samples.
        samples.append(clamp_int16(sum(channel_values) / len(channel_values)))

    duration_ms = int(len(samples) * 1000 / sample_rate) if sample_rate else 0
    return samples, sample_rate, duration_ms, channels, sample_width, total_frames


def build_payload(path, samples, sample_rate, duration_ms, device_id, current_db):
    pcm = b"".join(sample.to_bytes(2, "little", signed=True) for sample in samples)
    session_name = path.stem.replace(" ", "_")
    session_id = f"wav_test_{session_name}_{int(time.time())}"

    return {
        "device_id": device_id,
        "timestamp": int(time.time()),
        "sample_rate": sample_rate,
        "duration_ms": duration_ms,
        "audio_format": "int16_pcm_base64",
        "channels": 1,
        "pcm_base64": base64.b64encode(pcm).decode("ascii"),
        "session_id": session_id,
        "chunk_index": 0,
        "is_final": True,
        "capture_started_ms": None,
        "capture_ended_ms": None,
        "current_db": current_db,
        "average_db": current_db,
        "max_db": current_db,
        "violation": current_db >= 75,
    }


def post_json(url, payload):
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=20) as response:
        return response.status, response.read().decode("utf-8")


def main():
    parser = argparse.ArgumentParser(
        description="Upload a local WAV file to the backend FFT demo endpoint."
    )
    parser.add_argument("wav_path", help="Path to a PCM WAV test file")
    parser.add_argument("--url", default="http://127.0.0.1:8000/api/mic-test/upload")
    parser.add_argument("--device-id", default="wav-fft-test")
    parser.add_argument("--current-db", type=float, default=80)
    parser.add_argument(
        "--max-duration-ms",
        type=int,
        default=1000,
        help="Limit upload size by sending only the first N ms. Use 0 for full file.",
    )
    args = parser.parse_args()

    wav_path = Path(args.wav_path).resolve()
    if not wav_path.exists():
        raise SystemExit(f"WAV file not found: {wav_path}")

    try:
        samples, sample_rate, duration_ms, channels, sample_width, total_frames = read_wav_as_int16(
            wav_path,
            args.max_duration_ms,
        )
    except (wave.Error, ValueError) as exc:
        raise SystemExit(f"Cannot read WAV file: {exc}") from exc

    if not samples:
        raise SystemExit("WAV file did not produce any samples")

    payload = build_payload(wav_path, samples, sample_rate, duration_ms, args.device_id, args.current_db)
    approx_json_bytes = len(json.dumps(payload))

    print("Uploading WAV to backend FFT demo:")
    print(f"  file: {wav_path}")
    print(f"  original channels: {channels}")
    print(f"  original sample width: {sample_width * 8} bit")
    print(f"  original frames: {total_frames}")
    print(f"  uploaded sample rate: {sample_rate} Hz")
    print(f"  uploaded duration: {duration_ms} ms")
    print(f"  uploaded mono samples: {len(samples)}")
    print(f"  approx JSON bytes: {approx_json_bytes}")

    try:
        status, text = post_json(args.url, payload)
    except urllib.error.URLError as exc:
        raise SystemExit(f"POST failed: {exc}") from exc

    print(f"\nHTTP {status}")
    print(text)
    print("\nOpen the FFT graph:")
    print("  http://127.0.0.1:8000/fft_demo/")


if __name__ == "__main__":
    main()
