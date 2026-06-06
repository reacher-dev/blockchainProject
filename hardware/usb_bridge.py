"""
usb_bridge.py — 讀取 Pico W USB 序列埠的 JSON，轉發給本地 Oracle

Usage:
    python3 hardware/usb_bridge.py
    python3 hardware/usb_bridge.py --port /dev/cu.usbmodem101
"""
import argparse
import glob
import json
import sys
import time
import urllib.request
import urllib.error

ORACLE_URL = "http://127.0.0.1:8000/noise/ingest"
BAUD_RATE  = 115200


def find_pico_port():
    candidates = glob.glob("/dev/cu.usbmodem*") + glob.glob("/dev/tty.usbmodem*")
    if not candidates:
        return None
    return candidates[0]


def post_json(payload: dict):
    body = json.dumps(payload).encode("utf-8")
    req  = urllib.request.Request(
        ORACLE_URL, data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    global ORACLE_URL
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", default=None, help="序列埠路徑，例如 /dev/cu.usbmodem101")
    parser.add_argument("--oracle", default=ORACLE_URL, help="Oracle ingest URL")
    args = parser.parse_args()

    ORACLE_URL = args.oracle

    port = args.port or find_pico_port()
    if not port:
        print("找不到 Pico W，請確認 USB 已插上")
        sys.exit(1)

    print(f"連接序列埠：{port}")
    print(f"轉發至 Oracle：{ORACLE_URL}")
    print("等待 Pico W 資料...\n")

    try:
        import serial
    except ImportError:
        print("請先安裝 pyserial：pip3 install pyserial --break-system-packages")
        sys.exit(1)

    with serial.Serial(port, BAUD_RATE, timeout=2) as ser:
        while True:
            try:
                line = ser.readline().decode("utf-8", errors="ignore").strip()
                if not line:
                    continue

                # 只處理 DATA: 前綴的資料行
                if not line.startswith("DATA:"):
                    print(f"[pico] {line}")
                    continue

                raw = line[5:]
                payload = json.loads(raw)

                details = payload.get("violation_details", {})
                db      = details.get("estimated_db", "?")
                event   = details.get("event_type", "?")
                print(f"[{time.strftime('%H:%M:%S')}] {db} dB  ({event})", end="  ")

                result = post_json(payload)
                onchain = result.get("data", {}).get("onchain", {})
                sound   = result.get("data", {}).get("soundType")

                if onchain.get("submitted"):
                    print(f"✓ 上鏈  tx={onchain.get('txHash','')[:10]}...", end="")
                if sound:
                    print(f"  [{sound}]", end="")
                print()

            except json.JSONDecodeError:
                print(f"[橋接] JSON 解析失敗：{line[:80]}")
            except urllib.error.URLError as e:
                print(f"[橋接] Oracle 無法連線：{e}")
            except KeyboardInterrupt:
                print("\n停止橋接。")
                break
            except Exception as e:
                print(f"[橋接] 錯誤：{e}")


if __name__ == "__main__":
    main()
