import os
import time
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


HOST = "0.0.0.0"
PORT = int(os.getenv("ORACLE_PORT", "8000"))
NOISE_THRESHOLD_DB = 70
AUTO_SUBMIT_ONCHAIN = os.getenv("ORACLE_SUBMIT_ONCHAIN", "0") == "1"
LATEST_TTL = float(os.getenv("ORACLE_LATEST_TTL", "5"))  # 秒；0 = 不過期
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
NOISE_MODEL_PATH = Path(
    os.getenv("ORACLE_NOISE_MODEL_PATH", PROJECT_ROOT / "training_data" / "noise_model.joblib")
)
FFT_SAMPLE_LIMIT = int(os.getenv("ORACLE_FFT_SAMPLE_LIMIT", "8192"))

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
    "last_error": None,
}

NOISE_MODEL_CACHE = {"mtime": None, "payload": None}

# 每個裝置的滑動視窗（用於 Oracle 端違規判斷）
DEVICE_WINDOWS = {}    # device_id -> [{"timestamp": t, "db": db}, ...]
DEVICE_COOLDOWN = {}   # device_id -> last_violation_timestamp

VIOLATION_WINDOW_SECONDS = int(os.getenv("ORACLE_VIOLATION_WINDOW", "5"))
VIOLATION_COOLDOWN_SECONDS = int(os.getenv("ORACLE_VIOLATION_COOLDOWN", "30"))

# Runtime contract address — overrides the value in contract.json.
# Set via POST /contract/address after frontend deploys the contract.
RUNTIME_CONTRACT_ADDRESS = None


# ─── ML 聲音分類 ──────────────────────────────────────────────────────────────

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
        return payload
    except Exception as exc:
        print(f"[ml] 無法載入模型 {NOISE_MODEL_PATH}: {exc}")
        return None


def predict_noise_type(sample_values, sample_rate):
    """對 PCM 音訊樣本執行 FFT 特徵提取並呼叫 ML 模型分類。
    回傳 dict 或 None（無模型或無法分類時）。
    """
    try:
        import numpy as np
    except ImportError:
        return None

    if not sample_values or sample_rate <= 0:
        return None

    usable = sample_values[-FFT_SAMPLE_LIMIT:]
    waveform = np.asarray(usable, dtype=np.float32) / 32768.0
    waveform = waveform - np.mean(waveform)
    if len(waveform) < 8:
        return None

    windowed = waveform * np.hamming(len(waveform))
    spectrum = np.fft.rfft(windowed)
    frequencies = np.fft.rfftfreq(len(windowed), d=1.0 / sample_rate)
    magnitudes = np.abs(spectrum) / len(windowed)

    def band_energy(lo, hi):
        band = (frequencies >= lo) & (frequencies <= min(hi, sample_rate / 2))
        return float(np.sum(np.square(magnitudes[band])))

    audible = np.where(frequencies >= 20)[0]
    peak_idx = int(audible[np.argmax(magnitudes[audible])]) if len(audible) else 0

    low_e    = band_energy(20, 250)
    speech_e = band_energy(300, 3400)
    high_e   = band_energy(3400, 8000)
    total_e  = low_e + speech_e + high_e + 1e-12

    spectrum_sum = float(np.sum(magnitudes)) + 1e-12
    centroid = float(np.sum(frequencies * magnitudes) / spectrum_sum)
    geo_mean = float(np.exp(np.mean(np.log(magnitudes[1:] + 1e-12))))
    ari_mean = float(np.mean(magnitudes[1:] + 1e-12))
    flatness = geo_mean / ari_mean if ari_mean else 0.0
    aud_mean = float(np.mean(magnitudes[audible])) if len(audible) else 0.0
    tonal_ratio = float(magnitudes[peak_idx]) / aud_mean if aud_mean else 0.0
    zcr = float(np.mean(np.abs(np.diff(np.signbit(waveform)))))

    features = {
        "peak_frequency_hz":  float(frequencies[peak_idx]),
        "peak_magnitude":     float(magnitudes[peak_idx]),
        "low_band_energy":    low_e,
        "speech_band_energy": speech_e,
        "high_band_energy":   high_e,
        "low_percent":        low_e / total_e * 100,
        "speech_percent":     speech_e / total_e * 100,
        "high_percent":       high_e / total_e * 100,
        "spectral_centroid_hz": centroid,
        "spectral_flatness":  flatness,
        "tonal_peak_ratio":   tonal_ratio,
        "zero_crossing_rate": zcr,
    }

    payload = load_noise_model()
    if not payload:
        return None

    try:
        import numpy as np
        cols = payload["feature_columns"]
        model = payload["model"]
        vec = np.asarray([[features[c] for c in cols]], dtype=np.float64)
        predicted = str(model.predict(vec)[0])
        confidence = None
        if hasattr(model, "predict_proba"):
            proba = model.predict_proba(vec)[0]
            confidence = round(float(max(proba)), 4)
        return {"soundType": predicted, "soundTypeConfidence": confidence}
    except Exception as exc:
        print(f"[ml] 分類失敗: {exc}")
        return None


def check_violation_window(device_id, db, now):
    """維護每個裝置的滑動視窗，回傳 (should_submit, avg_db, window_secs)。"""
    window = DEVICE_WINDOWS.setdefault(device_id, [])
    window.append({"timestamp": now, "db": db})

    # 移除超過視窗範圍的舊資料
    cutoff = now - VIOLATION_WINDOW_SECONDS
    DEVICE_WINDOWS[device_id] = [e for e in window if e["timestamp"] >= cutoff]
    window = DEVICE_WINDOWS[device_id]

    avg_db = round(sum(e["db"] for e in window) / len(window), 1) if window else db
    window_secs = round(window[-1]["timestamp"] - window[0]["timestamp"], 1) if len(window) >= 2 else 0

    if len(window) < 2 or window_secs < VIOLATION_WINDOW_SECONDS:
        return False, avg_db, window_secs

    if avg_db <= NOISE_THRESHOLD_DB:
        return False, avg_db, window_secs

    # 冷卻期：避免同一事件重複上鏈
    last = DEVICE_COOLDOWN.get(device_id, 0)
    if now - last < VIOLATION_COOLDOWN_SECONDS:
        return False, avg_db, window_secs

    DEVICE_COOLDOWN[device_id] = now
    DEVICE_WINDOWS[device_id] = []  # 重置視窗
    print(f"[violation] device={device_id} avg={avg_db:.1f}dB > {NOISE_THRESHOLD_DB}dB for {VIOLATION_WINDOW_SECONDS}s")
    return True, avg_db, window_secs


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

    # 可選：音訊樣本（用於 ML 分類）
    audio_samples = details.get("audio_samples")
    audio_sample_rate = details.get("audio_sample_rate")
    if audio_samples is not None and not isinstance(audio_samples, list):
        raise ValueError("violation_details.audio_samples must be a list when provided")

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
            "audio_samples": audio_samples or [],
            "audio_sample_rate": int(audio_sample_rate) if audio_sample_rate else 16000,
        },
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
        if self.path == "/health":
            self._send_json(
                200,
                {
                    "status": "ok",
                    "submitOnchain": AUTO_SUBMIT_ONCHAIN,
                    "rpcUrl": RPC_URL,
                    "contractJson": str(CONTRACT_JSON_PATH),
                    "lastError": STATE["last_error"],
                },
            )
            return

        if self.path == "/noise/latest":
            latest = STATE["latest"]
            if latest and LATEST_TTL > 0 and time.time() - latest.get("receivedAt", 0) > LATEST_TTL:
                latest = None
            self._send_json(200, {"status": "success", "data": latest})
            return

        if self.path == "/noise/history":
            self._send_json(200, {"status": "success", "data": STATE["history"][-50:]})
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

            # ML 聲音分類（有 audio_samples 時執行）
            details_validated = validated_data["violation_details"]
            audio_samples = details_validated.get("audio_samples") or []
            audio_sample_rate = details_validated.get("audio_sample_rate", 16000)
            if audio_samples:
                ml_result = predict_noise_type(audio_samples, audio_sample_rate)
                if ml_result:
                    noise_event["soundType"] = ml_result["soundType"]
                    noise_event["soundTypeConfidence"] = ml_result["soundTypeConfidence"]
                    print(f"  sound_type: {ml_result['soundType']} (confidence={ml_result['soundTypeConfidence']})")
                else:
                    noise_event["soundType"] = None
                    noise_event["soundTypeConfidence"] = None
            else:
                noise_event["soundType"] = None
                noise_event["soundTypeConfidence"] = None

            # Oracle 端違規判斷（滑動視窗平均分貝）
            should_submit_raw, avg_db, window_secs = check_violation_window(
                noise_event["deviceId"],
                noise_event["estimatedDb"],
                noise_event["receivedAt"],
            )
            should_submit = AUTO_SUBMIT_ONCHAIN and should_submit_raw
            noise_event["reportAllowed"] = should_submit
            noise_event["avgDb"] = avg_db
            noise_event["windowSecs"] = window_secs

            onchain = {
                "submitted": False,
                "reason": "below threshold or cooldown" if AUTO_SUBMIT_ONCHAIN else "ORACLE_SUBMIT_ONCHAIN is not enabled",
            }

            if should_submit:
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
            STATE["latest"] = noise_event
            STATE["history"].append(noise_event)
            STATE["history"] = STATE["history"][-200:]

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
