import argparse
import json
import wave
from pathlib import Path


FFT_SAMPLE_LIMIT = 8192
FFT_WINDOW_SIZE = 2048


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

        frame_count = total_frames
        if max_duration_ms:
            frame_count = min(total_frames, int(sample_rate * max_duration_ms / 1000))

        raw = wav_file.readframes(frame_count)

    frame_size = channels * sample_width
    samples = []

    for offset in range(0, len(raw) - frame_size + 1, frame_size):
        channel_values = []
        for channel in range(channels):
            start = offset + channel * sample_width
            chunk = raw[start : start + sample_width]
            if sample_width == 1:
                value = (chunk[0] - 128) << 8
            elif sample_width == 2:
                value = int.from_bytes(chunk, "little", signed=True)
            else:
                value = int.from_bytes(chunk, "little", signed=True) >> 16
            channel_values.append(value)
        samples.append(clamp_int16(sum(channel_values) / len(channel_values)))

    return {
        "samples": samples,
        "sample_rate": sample_rate,
        "channels": channels,
        "sample_width_bits": sample_width * 8,
        "total_frames": total_frames,
        "analyzed_frames": len(samples),
        "duration_ms": int(len(samples) * 1000 / sample_rate) if sample_rate else 0,
    }


def analyze_samples(sample_values, sample_rate):
    try:
        import numpy as np
    except ImportError as exc:
        raise RuntimeError("numpy is required. Install it with: python -m pip install numpy") from exc

    if not sample_values or sample_rate <= 0:
        raise ValueError("Need non-empty samples and a valid sample_rate")

    waveform = np.asarray(sample_values, dtype=np.float32) / 32768.0
    waveform = waveform - np.mean(waveform)

    if len(waveform) < 8:
        raise ValueError("Need at least 8 samples for FFT analysis")

    window_size = min(FFT_WINDOW_SIZE, len(waveform))
    hop_size = max(1, window_size // 2)
    if len(waveform) <= FFT_SAMPLE_LIMIT:
        window_size = len(waveform)
        hop_size = len(waveform)

    frame_results = []
    peak_frequency_hz = 0.0
    peak_magnitude = 0.0

    for start in range(0, max(1, len(waveform) - window_size + 1), hop_size):
        frame = waveform[start : start + window_size]
        if len(frame) < window_size:
            break

        frame = frame - np.mean(frame)
        rms = float(np.sqrt(np.mean(np.square(frame))))
        if rms < 1e-5:
            continue

        # FFT converts time-domain samples into frequency bins. Windowing
        # reduces edge artifacts in short frames.
        windowed = frame * np.hamming(len(frame))
        spectrum = np.fft.rfft(windowed)

        # Each FFT bin maps to Hz from sample_rate and FFT size.
        frequencies = np.fft.rfftfreq(len(windowed), d=1.0 / sample_rate)
        magnitudes = np.abs(spectrum) / len(windowed)

        audible_peak_bins = np.where(frequencies >= 20)[0]
        if len(audible_peak_bins) > 0:
            frame_peak_index = int(audible_peak_bins[np.argmax(magnitudes[audible_peak_bins])])
        else:
            frame_peak_index = int(np.argmax(magnitudes[1:]) + 1) if len(magnitudes) > 1 else 0

        frame_peak_magnitude = float(magnitudes[frame_peak_index])
        if frame_peak_magnitude > peak_magnitude:
            peak_magnitude = frame_peak_magnitude
            peak_frequency_hz = float(frequencies[frame_peak_index])

        def band_energy(low_hz, high_hz):
            upper = min(high_hz, sample_rate / 2)
            if upper <= low_hz:
                return 0.0
            band = (frequencies >= low_hz) & (frequencies <= upper)
            # Band energy is more useful than one peak for noisy real-world
            # sounds because speech/music/claps spread energy across bins.
            return float(np.sum(np.square(magnitudes[band])))

        spectrum_sum = float(np.sum(magnitudes)) + 1e-12
        spectral_centroid_hz = float(np.sum(frequencies * magnitudes) / spectrum_sum)
        geometric_mean = float(np.exp(np.mean(np.log(magnitudes[1:] + 1e-12))))
        arithmetic_mean = float(np.mean(magnitudes[1:] + 1e-12))
        spectral_flatness = geometric_mean / arithmetic_mean if arithmetic_mean else 0.0
        audible_mean_magnitude = float(np.mean(magnitudes[audible_peak_bins])) if len(audible_peak_bins) else 0.0
        tonal_peak_ratio = (
            frame_peak_magnitude / audible_mean_magnitude if audible_mean_magnitude > 0 else 0.0
        )
        zero_crossing_rate = float(np.mean(np.abs(np.diff(np.signbit(frame)))))

        frame_results.append(
            {
                "low": band_energy(20, 250),
                "speech": band_energy(300, 3400),
                "high": band_energy(3400, 8000),
                "centroid": spectral_centroid_hz,
                "flatness": spectral_flatness,
                "tonal_peak_ratio": tonal_peak_ratio,
                "zcr": zero_crossing_rate,
                "rms": rms,
            }
        )

    if not frame_results:
        raise ValueError("No non-silent frames found for FFT analysis")

    low_band_energy = sum(item["low"] for item in frame_results) / len(frame_results)
    speech_band_energy = sum(item["speech"] for item in frame_results) / len(frame_results)
    high_band_energy = sum(item["high"] for item in frame_results) / len(frame_results)
    spectral_centroid_hz = sum(item["centroid"] for item in frame_results) / len(frame_results)
    spectral_flatness = sum(item["flatness"] for item in frame_results) / len(frame_results)
    tonal_peak_ratio = sum(item["tonal_peak_ratio"] for item in frame_results) / len(frame_results)
    zero_crossing_rate = sum(item["zcr"] for item in frame_results) / len(frame_results)
    rms = sum(item["rms"] for item in frame_results) / len(frame_results)

    energies = {
        "low": low_band_energy,
        "speech": speech_band_energy,
        "high": high_band_energy,
    }
    dominant_band = max(energies, key=energies.get)

    total_energy = low_band_energy + speech_band_energy + high_band_energy
    if total_energy > 0:
        percentages = {
            "low_percent": low_band_energy / total_energy * 100,
            "speech_percent": speech_band_energy / total_energy * 100,
            "high_percent": high_band_energy / total_energy * 100,
        }
    else:
        percentages = {"low_percent": 0.0, "speech_percent": 0.0, "high_percent": 0.0}

    music_core = (
        percentages["speech_percent"] >= 80
        and percentages["low_percent"] <= 12
        and spectral_flatness <= 0.455
        and zero_crossing_rate >= 0.18
        and peak_frequency_hz >= 430
    )
    music_possible = (
        percentages["speech_percent"] >= 70
        and percentages["low_percent"] <= 18
        and spectral_flatness <= 0.455
        and zero_crossing_rate >= 0.17
        and peak_frequency_hz >= 380
    )
    music_tonal = (
        percentages["speech_percent"] >= 45
        and percentages["low_percent"] <= 35
        and percentages["high_percent"] <= 20
        and spectral_flatness <= 0.55
        and tonal_peak_ratio >= 20
        and 90 <= peak_frequency_hz <= 2500
    )
    speech_peak_like = 80 <= peak_frequency_hz <= 450
    voice_like = (
        dominant_band == "speech"
        and percentages["speech_percent"] >= 40
        and percentages["high_percent"] <= 8
        and 250 <= spectral_centroid_hz <= 1800
        and zero_crossing_rate < 0.24
        and (percentages["low_percent"] >= 12 or speech_peak_like)
    )

    if music_core or music_possible or music_tonal:
        sound_type = "possible_music"
    elif voice_like:
        sound_type = "possible_human_voice"
    elif speech_band_energy > 0 and high_band_energy > speech_band_energy * 0.35:
        sound_type = "possible_instrument_or_music"
    else:
        sound_type = "other_noise"

    return {
        "demo_only": True,
        "classification_notice": "Rule-based FFT demo only, not reliable AI classification.",
        "fft_size": window_size,
        "analyzed_fft_frames": len(frame_results),
        "sample_rate": sample_rate,
        "nyquist_hz": sample_rate / 2,
        "peak_frequency_hz": round(peak_frequency_hz, 2),
        "peak_magnitude": round(peak_magnitude, 8),
        "dominant_band": dominant_band,
        "low_band_energy": round(low_band_energy, 10),
        "speech_band_energy": round(speech_band_energy, 10),
        "high_band_energy": round(high_band_energy, 10),
        "low_percent": round(percentages["low_percent"], 2),
        "speech_percent": round(percentages["speech_percent"], 2),
        "high_percent": round(percentages["high_percent"], 2),
        "spectral_centroid_hz": round(spectral_centroid_hz, 2),
        "spectral_flatness": round(spectral_flatness, 4),
        "tonal_peak_ratio": round(tonal_peak_ratio, 2),
        "zero_crossing_rate": round(zero_crossing_rate, 4),
        "rms": round(rms, 6),
        "sound_type": sound_type,
    }


def print_summary(path, wav_info, analysis):
    print(f"\nFile: {path}")
    print(f"  sample_rate: {wav_info['sample_rate']} Hz")
    print(f"  channels: {wav_info['channels']}")
    print(f"  sample_width: {wav_info['sample_width_bits']} bit")
    print(f"  analyzed_duration: {wav_info['duration_ms']} ms")
    print(f"  fft_size: {analysis['fft_size']}")
    print(f"  analyzed_fft_frames: {analysis['analyzed_fft_frames']}")
    print(f"  peak_frequency_hz: {analysis['peak_frequency_hz']}")
    print(f"  peak_magnitude: {analysis['peak_magnitude']}")
    print(f"  dominant_band: {analysis['dominant_band']}")
    print(f"  low_band_energy: {analysis['low_band_energy']} ({analysis['low_percent']}%)")
    print(f"  speech_band_energy: {analysis['speech_band_energy']} ({analysis['speech_percent']}%)")
    print(f"  high_band_energy: {analysis['high_band_energy']} ({analysis['high_percent']}%)")
    print(f"  spectral_centroid_hz: {analysis['spectral_centroid_hz']}")
    print(f"  spectral_flatness: {analysis['spectral_flatness']}")
    print(f"  tonal_peak_ratio: {analysis['tonal_peak_ratio']}")
    print(f"  zero_crossing_rate: {analysis['zero_crossing_rate']}")
    print(f"  sound_type: {analysis['sound_type']}")
    print("  note: FFT demo only, not reliable AI classification.")


def main():
    parser = argparse.ArgumentParser(description="Analyze one or more WAV files with numpy FFT.")
    parser.add_argument("wav_paths", nargs="+", help="PCM WAV files to analyze")
    parser.add_argument(
        "--max-duration-ms",
        type=int,
        default=1000,
        help="Analyze only the first N ms. Use 0 for the full file.",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    results = []
    for wav_path_text in args.wav_paths:
        path = Path(wav_path_text).resolve()
        if not path.exists():
            raise SystemExit(f"WAV file not found: {path}")

        try:
            wav_info = read_wav_as_int16(path, args.max_duration_ms)
            analysis = analyze_samples(wav_info["samples"], wav_info["sample_rate"])
        except (wave.Error, ValueError, RuntimeError) as exc:
            raise SystemExit(f"Cannot analyze {path}: {exc}") from exc

        result = {
            "file": str(path),
            **{key: value for key, value in wav_info.items() if key != "samples"},
            **analysis,
        }
        results.append(result)

        if not args.json:
            print_summary(path, wav_info, analysis)

    if args.json:
        print(json.dumps(results, indent=2))


if __name__ == "__main__":
    main()
