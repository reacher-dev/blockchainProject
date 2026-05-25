import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


HOST = "0.0.0.0"
PORT = 8000


def sign_data(json_data):
    """
    Placeholder for future Web3 oracle signing.

    Future implementation idea:
    1. Install web3/eth-account on the Windows backend:
       pip install web3 eth-account
    2. Serialize json_data in a deterministic way, for example:
       payload = json.dumps(json_data, separators=(",", ":"), sort_keys=True)
    3. Compute a keccak256 hash:
       from web3 import Web3
       digest = Web3.keccak(text=payload)
    4. Sign the digest with the oracle private key:
       from eth_account import Account
       signed = Account._sign_hash(digest, private_key=ORACLE_PRIVATE_KEY)
    5. Return signed.signature.hex() and submit/store it for smart contract use.

    Never hard-code a real private key in this file. Load it from an environment
    variable or a secrets manager.
    """
    return {
        "algorithm": "simulated-keccak256-ecdsa",
        "signature": "0xSIMULATED_SIGNATURE_FOR_DEVELOPMENT_ONLY",
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

    if not isinstance(culprit_room, str) or not culprit_room:
        raise ValueError("violation_details.culprit_room must be a non-empty string")

    if not isinstance(peak_decibel, (int, float)):
        raise ValueError("violation_details.peak_decibel must be a number")

    if not isinstance(duration_seconds, (int, float)):
        raise ValueError("violation_details.duration_seconds must be a number")

    if not isinstance(source, str):
        raise ValueError("violation_details.source must be a string when provided")

    return {
        "device_id": device_id,
        "timestamp": timestamp,
        "violation_details": {
            "culprit_room": culprit_room,
            "peak_decibel": peak_decibel,
            "duration_seconds": duration_seconds,
            "source": source,
        },
    }


class OracleRequestHandler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, body):
        response = json.dumps(body).encode("utf-8")

        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

    def do_POST(self):
        try:
            if self.path != "/":
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

            validated_data = validate_noise_violation(incoming_data)
            signature_info = sign_data(validated_data)

            details = validated_data["violation_details"]
            print("\nReceived noise violation:")
            print(f"  device_id: {validated_data['device_id']}")
            print(f"  timestamp: {validated_data['timestamp']}")
            print(f"  culprit_room: {details['culprit_room']}")
            print(f"  peak_decibel: {details['peak_decibel']}")
            print(f"  duration_seconds: {details['duration_seconds']}")
            print(f"  source: {details['source']}")
            print(f"  signature: {signature_info['signature']}")

            self._send_json(
                200,
                {
                    "status": "success",
                    "message": "Oracle received and signed",
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
