import os
import time
import json
import base64
import csv
import shutil
import struct
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse


HOST = "0.0.0.0"
PORT = int(os.getenv("ORACLE_PORT", "8000"))
NOISE_THRESHOLD_DB = 75
AUTO_SUBMIT_ONCHAIN = os.getenv("ORACLE_SUBMIT_ONCHAIN", "0") == "1"
RPC_URL = os.getenv("ORACLE_RPC_URL", "http://127.0.0.1:8545")
ORACLE_PRIVATE_KEY = os.getenv(
    "ORACLE_PRIVATE_KEY",
    # Anvil account #1, matching script/Deploy.s.sol's default oracle address.
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
CONTRACT_JSON_PATH = Path(
    os.getenv("CONTRACT_JSON_PATH", PROJECT_ROOT / "frontend" / "src" / "contract.json")
)
EVENT_LOG_PATH = Path(
    os.getenv("ORACLE_EVENT_LOG_PATH", Path(__file__).resolve().parent / "noise_events.jsonl")
)
HISTORY_LIMIT = int(os.getenv("ORACLE_HISTORY_LIMIT", "200"))
DEVICE_OFFLINE_SECONDS = int(os.getenv("ORACLE_DEVICE_OFFLINE_SECONDS", "30"))

ROOM_ALIASES = {
    "0": 0,
    "a": 0,
    "room a": 0,
    "林": 0,
    "1": 1,
    "b": 1,
    "room b": 1,
    "劉": 1,
    "2": 2,
    "c": 2,
    "room c": 2,
    "鄭": 2,
    "3": 3,
    "d": 3,
    "room d": 3,
    "吳": 3,
    "4": 4,
    "e": 4,
    "room e": 4,
    "許": 4,
}

ROOM_DISPLAY = ["林", "劉", "鄭", "吳", "許"]

STATE = {
    "latest": None,
    "history": [],
    "devices": {},
    "event_count": 0,
    "last_error": None,
    "latest_fft": None,
}

MIC_TEST_SESSIONS = {}

FFT_CHART_POINT_LIMIT = int(os.getenv("ORACLE_FFT_CHART_POINT_LIMIT", "600"))
FFT_SAMPLE_LIMIT = int(os.getenv("ORACLE_FFT_SAMPLE_LIMIT", "8192"))
TRAINING_DATA_DIR = PROJECT_ROOT / "training_data"
NOISE_MODEL_PATH = Path(os.getenv("ORACLE_NOISE_MODEL_PATH", TRAINING_DATA_DIR / "noise_model.joblib"))
NOISE_MODEL_CACHE = {"mtime": None, "payload": None}
TRAINING_LABELS = {
    "human_voice",
    "music",
    "rain",
    "car",
    "other_noise",
    "background",
}

# Runtime contract address — overrides the value in contract.json.
# Set via POST /contract/address after frontend deploys the contract.
RUNTIME_CONTRACT_ADDRESS = None


def calculate_fft_demo(sample_values, sample_rate, wav_filename=None):
    """Run a backend-only FFT demo for the latest uploaded PCM buffer.

    FFT is used here only to show a simple frequency spectrum. This is not
    speech recognition and not reliable AI classification.
    """
    result_base = {
        "available": False,
        "demo_only": True,
        "message": "FFT demo only. This is not reliable AI classification.",
        "classification_notice": "Rule-based FFT demo only, not YAMNet or speech recognition.",
        "sample_rate": sample_rate,
        "wav_filename": wav_filename,
        "wav_url": f"/mic_test_audio/{wav_filename}" if wav_filename else None,
        "created_at": int(time.time()),
    }

    try:
        import numpy as np
    except ImportError:
        result_base["message"] = (
            "FFT demo is unavailable because numpy is not installed. "
            "Install it on the backend machine with: pip install numpy"
        )
        return result_base

    if not sample_values or sample_rate <= 0:
        result_base["message"] = "FFT demo needs non-empty samples and a valid sample_rate."
        return result_base

    usable_samples = sample_values[-FFT_SAMPLE_LIMIT:]
    waveform = np.asarray(usable_samples, dtype=np.float32) / 32768.0
    waveform = waveform - np.mean(waveform)

    if len(waveform) < 8:
        result_base["message"] = "FFT demo needs at least 8 samples."
        return result_base

    # A window reduces edge discontinuities before FFT, which makes the plotted
    # spectrum easier to read for short chunks.
    windowed = waveform * np.hamming(len(waveform))

    # rfft returns bins from 0 Hz up to Nyquist. Each bin index maps to Hz using
    # rfftfreq(sample_count, 1 / sample_rate).
    spectrum = np.fft.rfft(windowed)
    frequencies = np.fft.rfftfreq(len(windowed), d=1.0 / sample_rate)
    magnitudes = np.abs(spectrum) / len(windowed)

    audible_peak_bins = np.where(frequencies >= 20)[0]
    if len(audible_peak_bins) > 0:
        peak_index = int(audible_peak_bins[np.argmax(magnitudes[audible_peak_bins])])
    elif len(magnitudes) > 1:
        peak_index = int(np.argmax(magnitudes[1:]) + 1)
    else:
        peak_index = 0

    def band_energy(low_hz, high_hz):
        upper = min(high_hz, sample_rate / 2)
        if upper <= low_hz:
            return 0.0
        band = (frequencies >= low_hz) & (frequencies <= upper)
        # Band energy is more stable than a single peak because real sounds
        # spread power across neighboring frequency bins.
        return float(np.sum(np.square(magnitudes[band])))

    low_band_energy = band_energy(20, 250)
    speech_band_energy = band_energy(300, 3400)
    high_band_energy = band_energy(3400, 8000)
    spectrum_sum = float(np.sum(magnitudes)) + 1e-12
    spectral_centroid_hz = float(np.sum(frequencies * magnitudes) / spectrum_sum)
    geometric_mean = float(np.exp(np.mean(np.log(magnitudes[1:] + 1e-12))))
    arithmetic_mean = float(np.mean(magnitudes[1:] + 1e-12))
    spectral_flatness = geometric_mean / arithmetic_mean if arithmetic_mean else 0.0
    audible_mean_magnitude = float(np.mean(magnitudes[audible_peak_bins])) if len(audible_peak_bins) else 0.0
    tonal_peak_ratio = (
        float(magnitudes[peak_index]) / audible_mean_magnitude if audible_mean_magnitude > 0 else 0.0
    )
    zero_crossing_rate = float(np.mean(np.abs(np.diff(np.signbit(waveform)))))

    energies = {
        "low": low_band_energy,
        "speech": speech_band_energy,
        "high": high_band_energy,
    }
    strongest_band = max(energies, key=energies.get)
    total_energy = low_band_energy + speech_band_energy + high_band_energy
    if total_energy > 0:
        low_percent = low_band_energy / total_energy * 100
        speech_percent = speech_band_energy / total_energy * 100
        high_percent = high_band_energy / total_energy * 100
    else:
        low_percent = 0.0
        speech_percent = 0.0
        high_percent = 0.0

    music_core = (
        speech_percent >= 80
        and low_percent <= 12
        and spectral_flatness <= 0.455
        and zero_crossing_rate >= 0.18
        and float(frequencies[peak_index]) >= 430
    )
    music_possible = (
        speech_percent >= 70
        and low_percent <= 18
        and spectral_flatness <= 0.455
        and zero_crossing_rate >= 0.17
        and float(frequencies[peak_index]) >= 380
    )
    music_tonal = (
        speech_percent >= 45
        and low_percent <= 35
        and high_percent <= 20
        and spectral_flatness <= 0.55
        and tonal_peak_ratio >= 20
        and 90 <= float(frequencies[peak_index]) <= 2500
    )
    speech_peak_like = 80 <= float(frequencies[peak_index]) <= 450
    voice_like = (
        strongest_band == "speech"
        and speech_percent >= 40
        and high_percent <= 8
        and 250 <= spectral_centroid_hz <= 1800
        and zero_crossing_rate < 0.24
        and (low_percent >= 12 or speech_peak_like)
    )

    if music_core or music_possible or music_tonal:
        sound_type = "possible_music"
    elif voice_like:
        sound_type = "possible_human_voice"
    elif speech_band_energy > 0 and high_band_energy > speech_band_energy * 0.35:
        sound_type = "possible_instrument_or_music"
    else:
        sound_type = "other_noise"

    rule_sound_type = sound_type
    feature_values = {
        "peak_frequency_hz": float(frequencies[peak_index]),
        "peak_magnitude": float(magnitudes[peak_index]),
        "low_band_energy": low_band_energy,
        "speech_band_energy": speech_band_energy,
        "high_band_energy": high_band_energy,
        "low_percent": low_percent,
        "speech_percent": speech_percent,
        "high_percent": high_percent,
        "spectral_centroid_hz": spectral_centroid_hz,
        "spectral_flatness": spectral_flatness,
        "tonal_peak_ratio": tonal_peak_ratio,
        "zero_crossing_rate": zero_crossing_rate,
    }
    model_prediction = predict_noise_model(feature_values)
    if model_prediction:
        sound_type = model_prediction["sound_type"]

    chart_indices = np.arange(len(frequencies))
    if len(chart_indices) > FFT_CHART_POINT_LIMIT:
        chart_indices = np.linspace(0, len(frequencies) - 1, FFT_CHART_POINT_LIMIT).astype(int)

    return {
        **result_base,
        "available": True,
        "message": "FFT demo calculated from the latest uploaded audio chunk.",
        "sample_count": len(usable_samples),
        "fft_size": len(windowed),
        "nyquist_hz": sample_rate / 2,
        "peak_frequency_hz": round(float(frequencies[peak_index]), 2),
        "peak_magnitude": round(float(magnitudes[peak_index]), 8),
        "low_band_energy": round(low_band_energy, 10),
        "speech_band_energy": round(speech_band_energy, 10),
        "high_band_energy": round(high_band_energy, 10),
        "low_percent": round(low_percent, 2),
        "speech_percent": round(speech_percent, 2),
        "high_percent": round(high_percent, 2),
        "spectral_centroid_hz": round(spectral_centroid_hz, 2),
        "spectral_flatness": round(spectral_flatness, 4),
        "tonal_peak_ratio": round(tonal_peak_ratio, 2),
        "zero_crossing_rate": round(zero_crossing_rate, 4),
        "sound_type": sound_type,
        "rule_sound_type": rule_sound_type,
        "model_sound_type": model_prediction["sound_type"] if model_prediction else None,
        "model_confidence": model_prediction["confidence"] if model_prediction else None,
        "frequencies_hz": [round(float(frequencies[i]), 2) for i in chart_indices],
        "magnitudes": [round(float(magnitudes[i]), 8) for i in chart_indices],
    }


def save_fft_training_label(label, note=""):
    if label not in TRAINING_LABELS:
        raise ValueError(f"label must be one of: {', '.join(sorted(TRAINING_LABELS))}")

    latest_fft = STATE.get("latest_fft")
    if not latest_fft:
        raise ValueError("No FFT result is available yet")

    created_at = int(time.time())
    source_wav = latest_fft.get("wav_filename")
    saved_wav_name = ""

    label_dir = TRAINING_DATA_DIR / label
    label_dir.mkdir(parents=True, exist_ok=True)

    if source_wav:
        source_path = PROJECT_ROOT / "mic_test_audio" / source_wav
        if source_path.exists() and source_path.is_file():
            safe_source_name = "".join(
                char if char.isalnum() or char in ("-", "_", ".") else "_"
                for char in source_wav
            )
            saved_wav_name = f"{created_at}_{safe_source_name}"
            shutil.copy2(source_path, label_dir / saved_wav_name)

    csv_path = TRAINING_DATA_DIR / "labels.csv"
    csv_path.parent.mkdir(parents=True, exist_ok=True)
    fieldnames = [
        "created_at",
        "label",
        "source_wav",
        "saved_wav",
        "note",
        "predicted_sound_type",
        "sample_rate",
        "sample_count",
        "fft_size",
        "peak_frequency_hz",
        "peak_magnitude",
        "low_band_energy",
        "speech_band_energy",
        "high_band_energy",
        "low_percent",
        "speech_percent",
        "high_percent",
        "spectral_centroid_hz",
        "spectral_flatness",
        "tonal_peak_ratio",
        "zero_crossing_rate",
    ]
    row = {
        "created_at": created_at,
        "label": label,
        "source_wav": source_wav or "",
        "saved_wav": saved_wav_name,
        "note": note,
        "predicted_sound_type": latest_fft.get("sound_type", ""),
        "sample_rate": latest_fft.get("sample_rate", ""),
        "sample_count": latest_fft.get("sample_count", ""),
        "fft_size": latest_fft.get("fft_size", ""),
        "peak_frequency_hz": latest_fft.get("peak_frequency_hz", ""),
        "peak_magnitude": latest_fft.get("peak_magnitude", ""),
        "low_band_energy": latest_fft.get("low_band_energy", ""),
        "speech_band_energy": latest_fft.get("speech_band_energy", ""),
        "high_band_energy": latest_fft.get("high_band_energy", ""),
        "low_percent": latest_fft.get("low_percent", ""),
        "speech_percent": latest_fft.get("speech_percent", ""),
        "high_percent": latest_fft.get("high_percent", ""),
        "spectral_centroid_hz": latest_fft.get("spectral_centroid_hz", ""),
        "spectral_flatness": latest_fft.get("spectral_flatness", ""),
        "tonal_peak_ratio": latest_fft.get("tonal_peak_ratio", ""),
        "zero_crossing_rate": latest_fft.get("zero_crossing_rate", ""),
    }

    write_header = not csv_path.exists()
    with csv_path.open("a", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        if write_header:
            writer.writeheader()
        writer.writerow(row)

    return {
        "label": label,
        "csv_path": str(csv_path),
        "saved_wav": saved_wav_name,
        "saved_wav_path": str(label_dir / saved_wav_name) if saved_wav_name else "",
    }


def load_noise_model():
    if not NOISE_MODEL_PATH.exists():
        return None

    try:
        mtime = NOISE_MODEL_PATH.stat().st_mtime
        if NOISE_MODEL_CACHE["payload"] is not None and NOISE_MODEL_CACHE["mtime"] == mtime:
            return NOISE_MODEL_CACHE["payload"]

        import joblib

        payload = joblib.load(NOISE_MODEL_PATH)
        NOISE_MODEL_CACHE["mtime"] = mtime
        NOISE_MODEL_CACHE["payload"] = payload
        print(f"Loaded noise model: {NOISE_MODEL_PATH}")
        return payload
    except Exception as exc:
        print(f"Could not load noise model {NOISE_MODEL_PATH}: {exc}")
        return None


def predict_noise_model(feature_values):
    payload = load_noise_model()
    if not payload:
        return None

    try:
        import numpy as np

        feature_columns = payload["feature_columns"]
        model = payload["model"]
        vector = np.asarray([[float(feature_values[column]) for column in feature_columns]], dtype=np.float64)
        predicted = str(model.predict(vector)[0])
        confidence = None
        if hasattr(model, "predict_proba"):
            probabilities = model.predict_proba(vector)[0]
            confidence = float(max(probabilities))
        return {
            "sound_type": predicted,
            "confidence": round(confidence, 4) if confidence is not None else None,
            "model_path": str(NOISE_MODEL_PATH),
        }
    except Exception as exc:
        print(f"Noise model prediction failed: {exc}")
        return None


def room_to_index(room_name):
    key = str(room_name).strip().lower()
    if key not in ROOM_ALIASES:
        raise ValueError(
            "violation_details.culprit_room must be one of Room A-E, A-E, 0-4, or 林/劉/鄭/吳/許"
        )
    return ROOM_ALIASES[key]


def normalize_violation(validated_data):
    details = validated_data["violation_details"]
    decibels = int(round(details["peak_decibel"]))
    room_index = room_to_index(details["culprit_room"])
    report_allowed = decibels > NOISE_THRESHOLD_DB

    return {
        "deviceId": validated_data["device_id"],
        "timestamp": validated_data["timestamp"],
        "receivedAt": int(time.time()),
        "roomIndex": room_index,
        "roomLabel": ROOM_DISPLAY[room_index],
        "decibels": decibels,
        "estimatedDb": details.get("estimated_db", decibels),
        "noiseLevel": details.get("noise_level"),
        "rawPeakI2s": details.get("raw_peak_i2s"),
        "eventType": details.get("event_type", "violation" if report_allowed else "monitoring"),
        "violationRequiredSeconds": details.get("violation_required_seconds"),
        "durationSeconds": details["duration_seconds"],
        "source": details["source"],
        "reportAllowed": report_allowed,
        "reason": "above threshold" if report_allowed else "below threshold",
        "raw": validated_data,
    }


def append_event_log(noise_event):
    EVENT_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with EVENT_LOG_PATH.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(noise_event, ensure_ascii=False, sort_keys=True))
        handle.write("\n")


def update_device_state(noise_event):
    now = int(time.time())
    device_id = noise_event["deviceId"]
    device_state = STATE["devices"].get(device_id, {})
    device_state.update(
        {
            "deviceId": device_id,
            "lastSeen": now,
            "lastPayloadTimestamp": noise_event["timestamp"],
            "roomIndex": noise_event["roomIndex"],
            "roomLabel": noise_event["roomLabel"],
            "decibels": noise_event["decibels"],
            "estimatedDb": noise_event["estimatedDb"],
            "noiseLevel": noise_event["noiseLevel"],
            "source": noise_event["source"],
            "eventType": noise_event["eventType"],
            "reportAllowed": noise_event["reportAllowed"],
            "eventCount": device_state.get("eventCount", 0) + 1,
            "online": True,
        }
    )
    STATE["devices"][device_id] = device_state


def get_device_snapshot():
    now = int(time.time())
    devices = []
    for device in STATE["devices"].values():
        snapshot = dict(device)
        snapshot["secondsSinceLastSeen"] = now - snapshot["lastSeen"]
        snapshot["online"] = snapshot["secondsSinceLastSeen"] <= DEVICE_OFFLINE_SECONDS
        devices.append(snapshot)
    return sorted(devices, key=lambda item: item["deviceId"])


def remember_noise_event(noise_event):
    STATE["latest"] = noise_event
    STATE["history"].append(noise_event)
    STATE["history"] = STATE["history"][-HISTORY_LIMIT:]
    STATE["event_count"] += 1
    update_device_state(noise_event)
    append_event_log(noise_event)


def load_contract_config():
    with CONTRACT_JSON_PATH.open("r", encoding="utf-8") as handle:
        data = json.load(handle)
    address = RUNTIME_CONTRACT_ADDRESS or data.get("address")
    if not address:
        raise RuntimeError(
            "合約地址尚未設定。請先透過前端建立公寓，或呼叫 POST /contract/address。"
        )
    return address, data["abi"]


def submit_onchain(noise_event):
    from eth_account import Account
    from eth_account.messages import encode_defunct
    from web3 import Web3

    contract_address, abi = load_contract_config()
    web3 = Web3(Web3.HTTPProvider(RPC_URL))
    if not web3.is_connected():
        raise RuntimeError(f"Cannot connect to RPC node at {RPC_URL}")

    account = Account.from_key(ORACLE_PRIVATE_KEY)
    contract = web3.eth.contract(address=Web3.to_checksum_address(contract_address), abi=abi)
    chain_id = web3.eth.chain_id
    report_nonce = contract.functions.reportNonce().call()

    digest = Web3.solidity_keccak(
        ["uint256", "address", "uint8", "uint256", "uint256"],
        [
            chain_id,
            Web3.to_checksum_address(contract_address),
            noise_event["roomIndex"],
            noise_event["decibels"],
            report_nonce,
        ],
    )
    signature = Account.sign_message(
        encode_defunct(primitive=digest),
        private_key=ORACLE_PRIVATE_KEY,
    ).signature

    tx = contract.functions.reportNoise(
        noise_event["roomIndex"],
        noise_event["decibels"],
        report_nonce,
        signature,
    ).build_transaction(
        {
            "from": account.address,
            "chainId": chain_id,
            "nonce": web3.eth.get_transaction_count(account.address),
            "gas": 500000,
            "gasPrice": web3.eth.gas_price,
        }
    )

    signed_tx = account.sign_transaction(tx)
    raw_transaction = getattr(signed_tx, "raw_transaction", None)
    if raw_transaction is None:
        raw_transaction = signed_tx.rawTransaction
    tx_hash = web3.eth.send_raw_transaction(raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash)

    if receipt.status == 0:
        raise RuntimeError(
            f"Transaction reverted (txHash: {tx_hash.hex()}). "
            "可能原因：押金不足、房客未登記、或 nonce 衝突。"
        )

    return {
        "submitted": True,
        "chainId": chain_id,
        "contractAddress": contract_address,
        "oracleAddress": account.address,
        "reportNonce": report_nonce,
        "signature": signature.hex(),
        "txHash": tx_hash.hex(),
        "blockNumber": receipt.blockNumber,
        "status": receipt.status,
    }


def validate_noise_violation(data):
    if not isinstance(data, dict):
        raise ValueError("JSON body must be an object")

    device_id = data.get("device_id")
    timestamp = data.get("timestamp")
    details = data.get("violation_details")

    if not isinstance(device_id, str) or not device_id:
        raise ValueError("device_id must be a non-empty string")

    if not isinstance(timestamp, int):
        raise ValueError("timestamp must be an integer")

    if not isinstance(details, dict):
        raise ValueError("violation_details must be an object")

    culprit_room = details.get("culprit_room")
    peak_decibel = details.get("peak_decibel")
    duration_seconds = details.get("duration_seconds")
    source = details.get("source", "unknown")
    estimated_db = details.get("estimated_db", peak_decibel)
    noise_level = details.get("noise_level")
    raw_peak_i2s = details.get("raw_peak_i2s")
    event_type = details.get("event_type", "unknown")
    violation_required_seconds = details.get("violation_required_seconds")

    if not isinstance(culprit_room, str) or not culprit_room:
        raise ValueError("violation_details.culprit_room must be a non-empty string")

    if not isinstance(peak_decibel, (int, float)):
        raise ValueError("violation_details.peak_decibel must be a number")

    if not isinstance(duration_seconds, (int, float)):
        raise ValueError("violation_details.duration_seconds must be a number")

    if not isinstance(source, str):
        raise ValueError("violation_details.source must be a string when provided")

    if not isinstance(estimated_db, (int, float)):
        raise ValueError("violation_details.estimated_db must be a number when provided")

    if noise_level is not None and not isinstance(noise_level, (int, float)):
        raise ValueError("violation_details.noise_level must be a number when provided")

    if raw_peak_i2s is not None and not isinstance(raw_peak_i2s, int):
        raise ValueError("violation_details.raw_peak_i2s must be an integer when provided")

    if not isinstance(event_type, str):
        raise ValueError("violation_details.event_type must be a string when provided")

    if violation_required_seconds is not None and not isinstance(violation_required_seconds, (int, float)):
        raise ValueError("violation_details.violation_required_seconds must be a number when provided")

    return {
        "device_id": device_id,
        "timestamp": timestamp,
        "violation_details": {
            "culprit_room": culprit_room,
            "peak_decibel": peak_decibel,
            "estimated_db": estimated_db,
            "noise_level": noise_level,
            "raw_peak_i2s": raw_peak_i2s,
            "event_type": event_type,
            "violation_required_seconds": violation_required_seconds,
            "duration_seconds": duration_seconds,
            "source": source,
        },
    }


def validate_audio_upload(data):
    if not isinstance(data, dict):
        raise ValueError("JSON body must be an object")

    room_id = data.get("room_id")
    device_id = data.get("device_id")
    timestamp = data.get("timestamp")
    sample_rate = data.get("sample_rate")
    duration_ms = data.get("duration_ms")
    audio_format = data.get("audio_format")
    samples = data.get("samples")
    current_db = data.get("current_db")
    average_db = data.get("average_db")
    max_db = data.get("max_db")
    violation = data.get("violation", False)
    event_id = data.get("event_id")

    if not isinstance(room_id, str) or not room_id:
        raise ValueError("room_id must be a non-empty string")

    if not isinstance(device_id, str) or not device_id:
        raise ValueError("device_id must be a non-empty string")

    if not isinstance(timestamp, int):
        raise ValueError("timestamp must be an integer")

    if not isinstance(sample_rate, int) or sample_rate <= 0:
        raise ValueError("sample_rate must be a positive integer")

    if not isinstance(duration_ms, (int, float)) or duration_ms <= 0:
        raise ValueError("duration_ms must be a positive number")

    if not isinstance(audio_format, str) or not audio_format:
        raise ValueError("audio_format must be a non-empty string")

    if not isinstance(samples, list) or not samples:
        raise ValueError("samples must be a non-empty list")

    for index, sample in enumerate(samples[:20]):
        if not isinstance(sample, int) or sample < -32768 or sample > 32767:
            raise ValueError(f"samples[{index}] must be an int16 value")

    if current_db is not None and not isinstance(current_db, (int, float)):
        raise ValueError("current_db must be a number when provided")

    if average_db is not None and not isinstance(average_db, (int, float)):
        raise ValueError("average_db must be a number when provided")

    if max_db is not None and not isinstance(max_db, (int, float)):
        raise ValueError("max_db must be a number when provided")

    if not isinstance(violation, bool):
        raise ValueError("violation must be a boolean")

    expected_samples = int(round(sample_rate * (duration_ms / 1000)))

    return {
        "room_id": room_id,
        "device_id": device_id,
        "timestamp": timestamp,
        "sample_rate": sample_rate,
        "duration_ms": duration_ms,
        "audio_format": audio_format,
        "samples": samples,
        "current_db": current_db,
        "average_db": average_db,
        "max_db": max_db,
        "violation": violation,
        "event_id": event_id,
        "sample_count": len(samples),
        "expected_sample_count": expected_samples,
    }


class OracleRequestHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")

    def _send_json(self, status_code, body):
        response = json.dumps(body).encode("utf-8")

        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self._send_cors_headers()
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.end_headers()

    def do_GET(self):
        parsed_url = urlparse(self.path)
        query = parse_qs(parsed_url.query)
        path = parsed_url.path

        if path == "/health":
            self._send_json(
                200,
                {
                    "status": "ok",
                    "submitOnchain": AUTO_SUBMIT_ONCHAIN,
                    "rpcUrl": RPC_URL,
                    "contractJson": str(CONTRACT_JSON_PATH),
                    "eventLogPath": str(EVENT_LOG_PATH),
                    "historyLimit": HISTORY_LIMIT,
                    "eventCount": STATE["event_count"],
                    "deviceCount": len(STATE["devices"]),
                    "lastError": STATE["last_error"],
                },
            )
            return

        if path == "/devices":
            self._send_json(200, {"status": "success", "data": get_device_snapshot()})
            return

        if path == "/noise/latest":
            self._send_json(200, {"status": "success", "data": STATE["latest"]})
            return

        if path == "/noise/history":
            history = STATE["history"]
            device_filter = query.get("device_id", [None])[0]
            if device_filter:
                history = [item for item in history if item["deviceId"] == device_filter]
            self._send_json(200, {"status": "success", "data": history[-50:]})
            return

        if path == "/api/fft/latest":
            latest_fft = STATE.get("latest_fft")
            if latest_fft is None:
                self._send_json(
                    200,
                    {
                        "ok": False,
                        "message": "No FFT result yet. Upload mic-test audio first.",
                        "data": None,
                    },
                )
                return
            self._send_json(200, {"ok": True, "data": latest_fft})
            return

        if path == "/fft_demo" or path == "/fft_demo/":
            html = """<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Backend FFT Demo</title>
    <style>
        :root {
            --bg: #101418;
            --panel: #171d24;
            --panel-2: #1f2832;
            --text: #eef2f6;
            --muted: #9aa8b5;
            --accent: #4fb3ff;
            --line: #78d27b;
            --border: #2b3642;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
            font-family: Arial, "Noto Sans TC", sans-serif;
            padding: 24px;
        }
        main {
            max-width: 1100px;
            margin: 0 auto;
        }
        header {
            display: flex;
            align-items: flex-start;
            justify-content: space-between;
            gap: 16px;
            margin-bottom: 18px;
        }
        h1 {
            font-size: 28px;
            margin: 0 0 8px;
        }
        p {
            color: var(--muted);
            margin: 0;
            line-height: 1.5;
        }
        button {
            background: var(--accent);
            border: 0;
            color: #071018;
            padding: 10px 14px;
            border-radius: 6px;
            font-weight: 700;
            cursor: pointer;
        }
        .metrics {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
            gap: 10px;
            margin-bottom: 14px;
        }
        .metric {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 12px;
            min-height: 76px;
        }
        .label {
            color: var(--muted);
            font-size: 13px;
            margin-bottom: 7px;
        }
        .value {
            font-size: 20px;
            font-weight: 700;
            overflow-wrap: anywhere;
        }
        .chart-wrap {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 14px;
        }
        canvas {
            width: 100%;
            height: 420px;
            display: block;
            background: var(--panel-2);
            border-radius: 6px;
        }
        audio {
            width: 100%;
            margin-top: 14px;
        }
        .label-panel {
            background: var(--panel);
            border: 1px solid var(--border);
            border-radius: 8px;
            padding: 14px;
            margin-bottom: 14px;
        }
        .label-actions {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-top: 10px;
        }
        .label-actions button {
            background: #263442;
            color: var(--text);
            border: 1px solid var(--border);
        }
        .label-actions button:hover {
            background: #314255;
        }
        #labelStatus {
            color: var(--muted);
            margin-top: 10px;
            min-height: 20px;
        }
        #status {
            margin: 12px 0;
            color: var(--muted);
        }
        .live-dot {
            display: inline-block;
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: #78d27b;
            margin-right: 8px;
        }
        @media (max-width: 640px) {
            body { padding: 14px; }
            header { flex-direction: column; }
            canvas { height: 300px; }
        }
    </style>
</head>
<body>
<main>
    <header>
        <div>
            <h1>Backend FFT Demo</h1>
            <p>FFT runs only on the backend from the latest uploaded PCM chunk. This is a simple demo, not reliable AI classification.</p>
        </div>
        <button onclick="loadFFT(true)">Refresh</button>
    </header>

    <div id="status"><span class="live-dot"></span>Waiting for latest FFT result...</div>

    <section class="label-panel">
        <p>Choose the correct label for the latest audio chunk. This saves a training row and copies the latest WAV when available.</p>
        <div class="label-actions">
            <button onclick="saveLabel('human_voice')">human_voice</button>
            <button onclick="saveLabel('music')">music</button>
            <button onclick="saveLabel('rain')">rain</button>
            <button onclick="saveLabel('car')">car</button>
            <button onclick="saveLabel('other_noise')">other_noise</button>
            <button onclick="saveLabel('background')">background</button>
        </div>
        <div id="labelStatus"></div>
    </section>

    <section class="metrics">
        <div class="metric"><div class="label">sound_type</div><div class="value" id="soundType">-</div></div>
        <div class="metric"><div class="label">model_confidence</div><div class="value" id="modelConfidence">-</div></div>
        <div class="metric"><div class="label">rule_sound_type</div><div class="value" id="ruleSoundType">-</div></div>
        <div class="metric"><div class="label">peak_frequency_hz</div><div class="value" id="peakFrequency">-</div></div>
        <div class="metric"><div class="label">low_band_energy</div><div class="value" id="lowEnergy">-</div></div>
        <div class="metric"><div class="label">speech_band_energy</div><div class="value" id="speechEnergy">-</div></div>
        <div class="metric"><div class="label">high_band_energy</div><div class="value" id="highEnergy">-</div></div>
        <div class="metric"><div class="label">low_percent</div><div class="value" id="lowPercent">-</div></div>
        <div class="metric"><div class="label">speech_percent</div><div class="value" id="speechPercent">-</div></div>
        <div class="metric"><div class="label">spectral_flatness</div><div class="value" id="spectralFlatness">-</div></div>
        <div class="metric"><div class="label">tonal_peak_ratio</div><div class="value" id="tonalPeakRatio">-</div></div>
        <div class="metric"><div class="label">zero_crossing_rate</div><div class="value" id="zeroCrossing">-</div></div>
        <div class="metric"><div class="label">last_update</div><div class="value" id="lastUpdate">-</div></div>
    </section>

    <section class="chart-wrap">
        <canvas id="fftChart" width="1100" height="420"></canvas>
        <audio id="latestAudio" controls style="display:none"></audio>
    </section>
</main>

<script>
const canvas = document.getElementById("fftChart");
const ctx = canvas.getContext("2d");
let latestResultKey = null;
let latestAudioUrl = null;
let latestFFTData = null;
let loading = false;

function setText(id, value) {
    document.getElementById(id).textContent = value === undefined || value === null ? "-" : value;
}

function drawChart(freqs, mags) {
    const width = canvas.width;
    const height = canvas.height;
    const padLeft = 56;
    const padRight = 18;
    const padTop = 18;
    const padBottom = 42;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = "#1f2832";
    ctx.fillRect(0, 0, width, height);

    ctx.strokeStyle = "#3a4652";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(padLeft, padTop);
    ctx.lineTo(padLeft, height - padBottom);
    ctx.lineTo(width - padRight, height - padBottom);
    ctx.stroke();

    ctx.fillStyle = "#9aa8b5";
    ctx.font = "13px Arial";
    ctx.fillText("Magnitude", 10, 18);
    ctx.fillText("Frequency (Hz)", width - 130, height - 12);

    if (!freqs || !mags || freqs.length === 0 || mags.length === 0) {
        ctx.fillText("No FFT points available", padLeft + 20, padTop + 35);
        return;
    }

    const maxFreq = Math.max(...freqs);
    const maxMag = Math.max(...mags);
    if (maxFreq <= 0 || maxMag <= 0) {
        ctx.fillText("FFT magnitudes are too small to draw", padLeft + 20, padTop + 35);
        return;
    }

    ctx.strokeStyle = "#78d27b";
    ctx.lineWidth = 2;
    ctx.beginPath();
    freqs.forEach((freq, index) => {
        const x = padLeft + (freq / maxFreq) * (width - padLeft - padRight);
        const y = height - padBottom - (mags[index] / maxMag) * (height - padTop - padBottom);
        if (index === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    });
    ctx.stroke();
}

function formatTimestamp(epochSeconds) {
    if (!epochSeconds) return "-";
    return new Date(epochSeconds * 1000).toLocaleTimeString();
}

async function saveLabel(label) {
    const labelStatus = document.getElementById("labelStatus");
    if (!latestFFTData) {
        labelStatus.textContent = "No latest FFT result to label yet.";
        return;
    }

    labelStatus.textContent = `Saving ${label}...`;
    try {
        const response = await fetch("/api/fft/label", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ label }),
        });
        const payload = await response.json();
        if (!payload.ok) {
            labelStatus.textContent = payload.detail || payload.message || "Failed to save label.";
            return;
        }
        labelStatus.textContent = `Saved ${payload.label}. CSV: ${payload.csv_path}`;
    } catch (error) {
        labelStatus.textContent = `Error saving label: ${error}`;
    }
}

async function loadFFT(forceStatus) {
    if (loading) return;
    loading = true;
    const status = document.getElementById("status");
    if (forceStatus) status.textContent = "Loading latest FFT result...";
    try {
        const response = await fetch("/api/fft/latest", { cache: "no-store" });
        const payload = await response.json();
        if (!payload.ok || !payload.data) {
            status.textContent = payload.message || "No FFT result yet.";
            drawChart([], []);
            return;
        }

        const data = payload.data;
        latestFFTData = data;
        status.textContent = data.message || "FFT result loaded.";
        if (!data.available) {
            setText("soundType", "unavailable");
            setText("modelConfidence", "-");
            setText("ruleSoundType", "-");
            setText("peakFrequency", "-");
            setText("lowEnergy", "-");
            setText("speechEnergy", "-");
            setText("highEnergy", "-");
            setText("lowPercent", "-");
            setText("speechPercent", "-");
            setText("spectralFlatness", "-");
            setText("tonalPeakRatio", "-");
            setText("zeroCrossing", "-");
            setText("lastUpdate", formatTimestamp(data.created_at));
            drawChart([], []);
            return;
        }
        setText("soundType", data.sound_type || "unavailable");
        setText("modelConfidence", data.model_confidence !== undefined && data.model_confidence !== null ? data.model_confidence : "-");
        setText("ruleSoundType", data.rule_sound_type || "-");
        setText("peakFrequency", data.peak_frequency_hz ? `${data.peak_frequency_hz} Hz` : "-");
        setText("lowEnergy", data.low_band_energy);
        setText("speechEnergy", data.speech_band_energy);
        setText("highEnergy", data.high_band_energy);
        setText("lowPercent", data.low_percent !== undefined ? `${data.low_percent}%` : "-");
        setText("speechPercent", data.speech_percent !== undefined ? `${data.speech_percent}%` : "-");
        setText("spectralFlatness", data.spectral_flatness);
        setText("tonalPeakRatio", data.tonal_peak_ratio);
        setText("zeroCrossing", data.zero_crossing_rate);
        setText("lastUpdate", formatTimestamp(data.created_at));

        const resultKey = `${data.created_at || 0}:${data.wav_filename || ""}:${data.peak_frequency_hz || ""}:${data.sound_type || ""}`;
        if (forceStatus || resultKey !== latestResultKey) {
            latestResultKey = resultKey;
            drawChart(data.frequencies_hz || [], data.magnitudes || []);
        }

        const player = document.getElementById("latestAudio");
        if (data.wav_url) {
            const audioUrl = `${data.wav_url}?t=${data.created_at || Date.now()}`;
            if (audioUrl !== latestAudioUrl) {
                latestAudioUrl = audioUrl;
                player.src = audioUrl;
            }
            player.style.display = "block";
        } else {
            player.style.display = "none";
        }
    } catch (error) {
        status.textContent = `Error loading FFT result: ${error}`;
        drawChart([], []);
    } finally {
        loading = false;
    }
}

loadFFT(true);
setInterval(() => loadFFT(false), 1000);
</script>
</body>
</html>
"""
            response = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._send_cors_headers()
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            return

        if path == "/mic_test_audio" or path == "/mic_test_audio/":
            output_dir = PROJECT_ROOT / "mic_test_audio"
            wav_files = []
            if output_dir.exists() and output_dir.is_dir():
                for f in output_dir.glob("*.wav"):
                    stat = f.stat()
                    mtime = time.strftime('%Y-%m-%d %H:%M:%S', time.localtime(stat.st_mtime))
                    size_kb = round(stat.st_size / 1024, 2)
                    wav_files.append({
                        "name": f.name,
                        "time": mtime,
                        "size": f"{size_kb} KB",
                        "mtime_raw": stat.st_mtime
                    })
            wav_files.sort(key=lambda x: x["mtime_raw"], reverse=True)

            cards_html = ""
            if not wav_files:
                cards_html = '<div class="empty-state">目前尚未收到任何錄音檔案。請讓 Pico W 觸發錄音後重新整理此頁面。</div>'
            else:
                for f in wav_files:
                    cards_html += f"""
                    <div class="card">
                        <div class="card-header">
                            <div class="file-name">{f['name']}</div>
                            <div class="file-meta">
                                <span>時間: {f['time']}</span>
                                <span>大小: {f['size']}</span>
                            </div>
                        </div>
                        <audio controls src="/mic_test_audio/{f['name']}"></audio>
                    </div>
                    """

            html = f"""<!DOCTYPE html>
<html lang="zh-TW">
<head>
    <meta charset="UTF-8">
    <title>麥克風測試音訊列表</title>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
    <style>
        :root {{
            --bg: #0f172a;
            --card-bg: rgba(30, 41, 59, 0.7);
            --text: #f8fafc;
            --text-secondary: #94a3b8;
            --accent: #3b82f6;
            --accent-hover: #2563eb;
            --border: rgba(255, 255, 255, 0.1);
        }}
        body {{
            font-family: 'Inter', system-ui, sans-serif;
            background-color: var(--bg);
            color: var(--text);
            margin: 0;
            padding: 40px 20px;
            display: flex;
            flex-direction: column;
            align-items: center;
        }}
        .container {{
            max-width: 800px;
            width: 100%;
        }}
        h1 {{
            font-size: 2.2rem;
            font-weight: 800;
            margin: 0;
            background: linear-gradient(to right, #60a5fa, #3b82f6);
            -webkit-background-clip: text;
            -webkit-text-fill-color: transparent;
        }}
        .subtitle {{
            color: var(--text-secondary);
            margin-top: 8px;
            margin-bottom: 32px;
        }}
        .card {{
            background: var(--card-bg);
            backdrop-filter: blur(12px);
            border: 1px solid var(--border);
            border-radius: 16px;
            padding: 20px;
            margin-bottom: 16px;
            display: flex;
            flex-direction: column;
            gap: 12px;
            transition: transform 0.2s, box-shadow 0.2s;
        }}
        .card:hover {{
            transform: translateY(-2px);
            box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
        }}
        .card-header {{
            display: flex;
            justify-content: space-between;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
        }}
        .file-name {{
            font-weight: 600;
            font-size: 1.05rem;
            color: #60a5fa;
            word-break: break-all;
        }}
        .file-meta {{
            font-size: 0.85rem;
            color: var(--text-secondary);
            display: flex;
            gap: 16px;
        }}
        audio {{
            width: 100%;
            border-radius: 8px;
            outline: none;
        }}
        .empty-state {{
            text-align: center;
            padding: 48px;
            color: var(--text-secondary);
            border: 2px dashed var(--border);
            border-radius: 16px;
            font-size: 1.1rem;
        }}
        .btn {{
            background-color: var(--accent);
            color: white;
            border: none;
            padding: 10px 20px;
            border-radius: 8px;
            font-weight: 600;
            cursor: pointer;
            transition: background-color 0.2s;
            text-decoration: none;
            display: inline-block;
        }}
        .btn:hover {{
            background-color: var(--accent-hover);
        }}
    </style>
</head>
<body>
    <div class="container">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <h1>麥克風錄音試聽</h1>
            <button class="btn" onclick="window.location.reload()">重新整理</button>
        </div>
        <p class="subtitle">點擊下方播放器可直接線上試聽 Pico W 傳送的噪音測試檔案（新檔案顯示在最上方）</p>
        
        <div class="list-container">
            {cards_html}
        </div>
    </div>
</body>
</html>
"""
            response = html.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._send_cors_headers()
            self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            self.wfile.write(response)
            return

        if path.startswith("/mic_test_audio/"):
            filename = os.path.basename(path)
            filepath = PROJECT_ROOT / "mic_test_audio" / filename
            if filepath.exists() and filepath.is_file():
                self.send_response(200)
                self.send_header("Content-Type", "audio/wav")
                self._send_cors_headers()
                self.send_header("Content-Length", str(filepath.stat().st_size))
                self.end_headers()
                with filepath.open("rb") as f:
                    self.wfile.write(f.read())
                return
            else:
                self._send_json(404, {"status": "error", "message": "File not found"})
                return

        self._send_json(404, {"status": "error", "message": "Not found"})

    def do_POST(self):
        try:
            if self.path == "/contract/address":
                global RUNTIME_CONTRACT_ADDRESS
                content_length = int(self.headers.get("Content-Length", "0"))
                raw_body = self.rfile.read(content_length) if content_length > 0 else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except json.JSONDecodeError:
                    self._send_json(400, {"status": "error", "message": "Invalid JSON"})
                    return
                addr = body.get("address", "").strip()
                if not addr or not addr.startswith("0x") or len(addr) != 42:
                    self._send_json(400, {"status": "error", "message": "address must be a 42-char 0x hex string"})
                    return
                RUNTIME_CONTRACT_ADDRESS = addr
                print(f"[oracle] contract address updated to {addr}")
                self._send_json(200, {"status": "success", "address": addr})
                return

            if self.path == "/noise/mock":
                content_length = int(self.headers.get("Content-Length", "0"))
                raw_body = self.rfile.read(content_length) if content_length > 0 else b""
                try:
                    body = json.loads(raw_body.decode("utf-8")) if raw_body else {}
                except json.JSONDecodeError:
                    self._send_json(400, {"status": "error", "message": "Invalid JSON"})
                    return
                room = body.get("room")
                decibels = body.get("decibels")
                if not isinstance(room, int) or not (0 <= room <= 4):
                    self._send_json(400, {"status": "error", "message": "room must be integer 0-4"})
                    return
                if not isinstance(decibels, (int, float)):
                    self._send_json(400, {"status": "error", "message": "decibels must be a number"})
                    return
                noise_event = {
                    "roomIndex": room,
                    "roomLabel": ROOM_DISPLAY[room],
                    "decibels": int(decibels),
                    "reportAllowed": True,
                }
                try:
                    onchain = submit_onchain(noise_event)
                    self._send_json(200, {"status": "success", "data": onchain})
                except Exception as exc:
                    STATE["last_error"] = str(exc)
                    self._send_json(500, {"status": "error", "message": str(exc)})
                return

            if self.path == "/api/audio/upload":
                # Raw audio is accepted only as a future FFT/AI input pipeline.
                # It is intentionally not stored by default for privacy reasons.
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0:
                    self._send_json(400, {"ok": False, "message": "Empty request body"})
                    return

                raw_body = self.rfile.read(content_length)
                try:
                    incoming_data = json.loads(raw_body.decode("utf-8"))
                except json.JSONDecodeError as exc:
                    self._send_json(
                        400,
                        {
                            "ok": False,
                            "message": "Invalid JSON",
                            "detail": str(exc),
                        },
                    )
                    return

                try:
                    audio_data = validate_audio_upload(incoming_data)
                except ValueError as exc:
                    self._send_json(
                        400,
                        {
                            "ok": False,
                            "message": "Invalid audio payload",
                            "detail": str(exc),
                        },
                    )
                    return

                sample_count = audio_data["sample_count"]
                expected_count = audio_data["expected_sample_count"]
                size_ratio = sample_count / expected_count if expected_count else 0
                looks_reasonable = 0.5 <= size_ratio <= 1.5

                print("\nReceived audio buffer:")
                print(f"  room_id: {audio_data['room_id']}")
                print(f"  device_id: {audio_data['device_id']}")
                print(f"  sample_rate: {audio_data['sample_rate']}")
                print(f"  duration_ms: {audio_data['duration_ms']}")
                print(f"  audio_format: {audio_data['audio_format']}")
                print(f"  sample_count: {sample_count}")
                print(f"  expected_sample_count: {expected_count}")
                print(f"  payload_size_reasonable: {looks_reasonable}")
                print(f"  current_db: {audio_data['current_db']}")
                print(f"  average_db: {audio_data['average_db']}")
                print(f"  max_db: {audio_data['max_db']}")
                print(f"  violation: {audio_data['violation']}")
                print(f"  event_id: {audio_data['event_id']}")

                STATE["latest_fft"] = calculate_fft_demo(
                    sample_values=audio_data["samples"],
                    sample_rate=audio_data["sample_rate"],
                    wav_filename=None,
                )

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "received_samples": sample_count,
                        "expected_samples": expected_count,
                        "payload_size_reasonable": looks_reasonable,
                        "fft_demo_available": STATE["latest_fft"].get("available", False),
                        "fft_demo_url": "/fft_demo/",
                        "message": "audio buffer received",
                    },
                )
                return

            if self.path == "/api/fft/label":
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0:
                    self._send_json(400, {"ok": False, "message": "Empty request body"})
                    return

                raw_body = self.rfile.read(content_length)
                try:
                    incoming_data = json.loads(raw_body.decode("utf-8"))
                except json.JSONDecodeError as exc:
                    self._send_json(400, {"ok": False, "message": "Invalid JSON", "detail": str(exc)})
                    return

                try:
                    label = incoming_data.get("label")
                    note = incoming_data.get("note", "")
                    if not isinstance(label, str):
                        raise ValueError("label must be a string")
                    if not isinstance(note, str):
                        raise ValueError("note must be a string")
                    result = save_fft_training_label(label, note)
                except ValueError as exc:
                    self._send_json(400, {"ok": False, "message": "Invalid label payload", "detail": str(exc)})
                    return
                except Exception as exc:
                    print(f"Error saving FFT training label: {exc}")
                    self._send_json(500, {"ok": False, "message": "Server error saving training label", "detail": str(exc)})
                    return

                self._send_json(
                    200,
                    {
                        "ok": True,
                        "message": "training label saved",
                        **result,
                    },
                )
                return

            if self.path == "/api/mic-test/upload":
                content_length = int(self.headers.get("Content-Length", "0"))
                if content_length <= 0:
                    self._send_json(400, {"ok": False, "message": "Empty request body"})
                    return

                raw_body = self.rfile.read(content_length)
                try:
                    incoming_data = json.loads(raw_body.decode("utf-8"))
                except json.JSONDecodeError as exc:
                    self._send_json(400, {"ok": False, "message": "Invalid JSON", "detail": str(exc)})
                    return

                try:
                    device_id = incoming_data.get("device_id")
                    timestamp = incoming_data.get("timestamp")
                    sample_rate = incoming_data.get("sample_rate")
                    hardware_sample_rate = incoming_data.get("hardware_sample_rate")
                    measured_capture_sample_rate = incoming_data.get("measured_capture_sample_rate")
                    duration_ms = incoming_data.get("duration_ms")
                    audio_format = incoming_data.get("audio_format")
                    channels = incoming_data.get("channels")
                    samples = incoming_data.get("samples")
                    pcm_base64 = incoming_data.get("pcm_base64")
                    session_id = incoming_data.get("session_id")
                    chunk_index = incoming_data.get("chunk_index")
                    is_final = incoming_data.get("is_final", False)
                    capture_started_ms = incoming_data.get("capture_started_ms")
                    capture_ended_ms = incoming_data.get("capture_ended_ms")

                    if not device_id:
                        raise ValueError("device_id must be provided")
                    if sample_rate is None or not isinstance(sample_rate, int):
                        raise ValueError("sample_rate must be an integer")
                    if hardware_sample_rate is not None and not isinstance(hardware_sample_rate, int):
                        raise ValueError("hardware_sample_rate must be an integer when provided")
                    if measured_capture_sample_rate is not None and not isinstance(measured_capture_sample_rate, int):
                        raise ValueError("measured_capture_sample_rate must be an integer when provided")
                    if duration_ms is None or not isinstance(duration_ms, int):
                        raise ValueError("duration_ms must be an integer")
                    if audio_format not in ("int16_pcm", "int16_pcm_base64"):
                        raise ValueError("audio_format must be 'int16_pcm' or 'int16_pcm_base64'")
                    if channels != 1:
                        raise ValueError("channels must be 1")
                    if session_id is not None and not isinstance(session_id, str):
                        raise ValueError("session_id must be a string when provided")
                    if chunk_index is not None and not isinstance(chunk_index, int):
                        raise ValueError("chunk_index must be an integer when provided")
                    if not isinstance(is_final, bool):
                        raise ValueError("is_final must be a boolean")
                    if capture_started_ms is not None and not isinstance(capture_started_ms, int):
                        raise ValueError("capture_started_ms must be an integer when provided")
                    if capture_ended_ms is not None and not isinstance(capture_ended_ms, int):
                        raise ValueError("capture_ended_ms must be an integer when provided")

                    expected_samples = int((sample_rate * duration_ms) / 1000)

                    if audio_format == "int16_pcm_base64":
                        if not isinstance(pcm_base64, str) or not pcm_base64:
                            raise ValueError("pcm_base64 must be a non-empty string")
                        raw_audio = base64.b64decode(pcm_base64)
                        if len(raw_audio) == 0 or len(raw_audio) % 2 != 0:
                            raise ValueError("pcm_base64 must decode to non-empty int16 PCM bytes")
                        received_sample_count = len(raw_audio) // 2
                        sample_values = list(struct.unpack(f"<{received_sample_count}h", raw_audio))
                    else:
                        if not isinstance(samples, list) or not samples:
                            raise ValueError("samples must be a non-empty list")
                        sample_values = [max(-32768, min(32767, int(s))) for s in samples]
                        received_sample_count = len(sample_values)
                        raw_audio = struct.pack(f"<{received_sample_count}h", *sample_values)

                    min_val = min(sample_values) if sample_values else 0
                    max_val = max(sample_values) if sample_values else 0

                    output_dir = PROJECT_ROOT / "mic_test_audio"
                    output_dir.mkdir(parents=True, exist_ok=True)

                    current_time = timestamp
                    session_key = session_id or device_id
                    session = MIC_TEST_SESSIONS.get(session_key)

                    if session_id:
                        safe_session_id = "".join(
                            char if char.isalnum() or char in ("-", "_") else "_"
                            for char in session_id
                        )
                        filename = f"mic_test_{safe_session_id}.wav"
                        filepath = output_dir / filename
                        should_append = filepath.exists()
                    else:
                        # Backward-compatible behavior for older one-shot uploads.
                        should_append = bool(session and (current_time - session["last_timestamp"] <= 10))

                    if should_append:
                        if session:
                            filename = session["filename"]
                            filepath = session["filepath"]
                            wav_sample_rate = session.get("sample_rate", sample_rate)
                        else:
                            wav_sample_rate = sample_rate
                        existing_audio = b""
                        try:
                            with wave.open(str(filepath), "rb") as wav_in:
                                n_frames = wav_in.getnframes()
                                existing_audio = wav_in.readframes(n_frames)
                        except Exception as e:
                            print(f"Error reading existing WAV for append: {e}")
                            existing_audio = b""

                        combined_audio = existing_audio + raw_audio
                        with wave.open(str(filepath), "wb") as wav_file:
                            wav_file.setnchannels(1)
                            wav_file.setsampwidth(2)
                            wav_file.setframerate(wav_sample_rate)
                            wav_file.writeframes(combined_audio)

                        total_samples = len(combined_audio) // 2
                        total_duration_ms = int((total_samples * 1000) / wav_sample_rate)
                        MIC_TEST_SESSIONS[session_key] = {
                            "filename": filename,
                            "filepath": filepath,
                            "last_timestamp": current_time,
                            "duration_ms": total_duration_ms,
                            "sample_count": total_samples,
                            "sample_rate": wav_sample_rate,
                            "capture_ended_ms": capture_ended_ms,
                        }
                        appended = True
                    else:
                        if session_id:
                            safe_session_id = "".join(
                                char if char.isalnum() or char in ("-", "_") else "_"
                                for char in session_id
                            )
                            filename = f"mic_test_{safe_session_id}.wav"
                            filepath = output_dir / filename
                        else:
                            filename = f"mic_test_{device_id}_{timestamp}.wav"
                            filepath = output_dir / filename

                        with wave.open(str(filepath), "wb") as wav_file:
                            wav_file.setnchannels(1)
                            wav_file.setsampwidth(2)
                            wav_file.setframerate(sample_rate)
                            wav_file.writeframes(raw_audio)

                        total_samples = received_sample_count
                        total_duration_ms = int((total_samples * 1000) / sample_rate)
                        MIC_TEST_SESSIONS[session_key] = {
                            "filename": filename,
                            "filepath": filepath,
                            "last_timestamp": current_time,
                            "duration_ms": total_duration_ms,
                            "sample_count": total_samples,
                            "sample_rate": sample_rate,
                            "capture_ended_ms": capture_ended_ms,
                        }
                        appended = False

                    if is_final:
                        MIC_TEST_SESSIONS.pop(session_key, None)

                    STATE["latest_fft"] = calculate_fft_demo(
                        sample_values=sample_values,
                        sample_rate=sample_rate,
                        wav_filename=filename,
                    )

                    print("\n--- Mic Test Audio Upload Received ---")
                    print(f"  Device ID: {device_id}")
                    print(f"  Session ID: {session_id}")
                    print(f"  Chunk Index: {chunk_index}")
                    print(f"  Final Chunk: {is_final}")
                    print(f"  Capture Started ms: {capture_started_ms}")
                    print(f"  Capture Ended ms: {capture_ended_ms}")
                    print(f"  Timestamp: {timestamp}")
                    print(f"  Sample Rate: {sample_rate} Hz")
                    print(f"  Hardware Sample Rate: {hardware_sample_rate}")
                    print(f"  Measured Capture Sample Rate: {measured_capture_sample_rate}")
                    print(f"  Duration (This chunk): {duration_ms} ms")
                    print(f"  Total Duration: {total_duration_ms} ms")
                    print(f"  Expected chunk sample count: {expected_samples}")
                    print(f"  Received chunk sample count: {received_sample_count}")
                    print(f"  Total combined sample count: {total_samples}")
                    print(f"  Min sample value: {min_val}")
                    print(f"  Max sample value: {max_val}")
                    print(f"  Saved WAV path: {filepath}")
                    print(f"  Appended to continuous stream: {appended}")
                    if STATE["latest_fft"].get("available"):
                        print(f"  FFT peak frequency: {STATE['latest_fft']['peak_frequency_hz']} Hz")
                        print(f"  FFT demo sound type: {STATE['latest_fft']['sound_type']}")
                    else:
                        print(f"  FFT demo status: {STATE['latest_fft']['message']}")
                    print("---------------------------------------\n")

                    self._send_json(
                        200,
                        {
                            "ok": True,
                            "message": "mic test WAV saved",
                            "filename": filename,
                            "sample_rate": sample_rate,
                            "hardware_sample_rate": hardware_sample_rate,
                            "measured_capture_sample_rate": measured_capture_sample_rate,
                            "duration_ms": total_duration_ms,
                            "received_samples": received_sample_count,
                            "expected_samples": expected_samples,
                            "total_samples": total_samples,
                            "appended": appended,
                            "session_id": session_id,
                            "chunk_index": chunk_index,
                            "is_final": is_final,
                            "capture_started_ms": capture_started_ms,
                            "capture_ended_ms": capture_ended_ms,
                            "fft_demo_available": STATE["latest_fft"].get("available", False),
                            "fft_demo_url": "/fft_demo/"
                        }
                    )
                except ValueError as exc:
                    self._send_json(400, {"ok": False, "message": "Invalid mic test payload", "detail": str(exc)})
                except Exception as exc:
                    print(f"Error handling mic test upload: {exc}")
                    self._send_json(500, {"ok": False, "message": "Server error saving WAV file", "detail": str(exc)})
                return

            if self.path not in ("/", "/noise/ingest"):
                self._send_json(404, {"status": "error", "message": "Not found"})
                return

            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length <= 0:
                self._send_json(400, {"status": "error", "message": "Empty request body"})
                return

            raw_body = self.rfile.read(content_length)

            try:
                incoming_data = json.loads(raw_body.decode("utf-8"))
            except json.JSONDecodeError as exc:
                self._send_json(
                    400,
                    {
                        "status": "error",
                        "message": "Invalid JSON",
                        "detail": str(exc),
                    },
                )
                return

            try:
                validated_data = validate_noise_violation(incoming_data)
                noise_event = normalize_violation(validated_data)
            except ValueError as exc:
                self._send_json(
                    400,
                    {
                        "status": "error",
                        "message": "Invalid noise payload",
                        "detail": str(exc),
                    },
                )
                return

            onchain = {
                "submitted": False,
                "reason": "ORACLE_SUBMIT_ONCHAIN is not enabled",
            }

            if AUTO_SUBMIT_ONCHAIN and noise_event["reportAllowed"]:
                try:
                    onchain = submit_onchain(noise_event)
                    STATE["last_error"] = None
                except Exception as exc:
                    STATE["last_error"] = str(exc)
                    onchain = {
                        "submitted": False,
                        "error": str(exc),
                    }

            noise_event["onchain"] = onchain
            remember_noise_event(noise_event)

            details = validated_data["violation_details"]
            print("\nReceived noise violation:")
            print(f"  device_id: {validated_data['device_id']}")
            print(f"  timestamp: {validated_data['timestamp']}")
            print(f"  culprit_room: {details['culprit_room']}")
            print(f"  peak_decibel: {details['peak_decibel']}")
            print(f"  estimated_db: {details['estimated_db']}")
            print(f"  noise_level: {details['noise_level']}")
            print(f"  raw_peak_i2s: {details['raw_peak_i2s']}")
            print(f"  event_type: {details['event_type']}")
            print(f"  duration_seconds: {details['duration_seconds']}")
            print(f"  source: {details['source']}")
            print(f"  normalized_room_index: {noise_event['roomIndex']}")
            print(f"  report_allowed: {noise_event['reportAllowed']}")
            print(f"  onchain: {onchain}")

            self._send_json(
                200,
                {
                    "status": "success",
                    "message": "Oracle received Pico W noise payload",
                    "data": noise_event,
                },
            )

        except Exception as exc:
            print(f"Unexpected server error: {exc}")
            self._send_json(
                500,
                {
                    "status": "error",
                    "message": "Internal server error",
                },
            )

    def log_message(self, format, *args):
        print(f"{self.client_address[0]} - {format % args}")


def main():
    server = ThreadingHTTPServer((HOST, PORT), OracleRequestHandler)
    print(f"Web3 oracle relay listening on http://{HOST}:{PORT}")
    print("Waiting for Pico W HTTP POST requests...")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down oracle relay...")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
