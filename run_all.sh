#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
PICO_PORT="${PICO_PORT:-auto}"
WIFI_SSID="${PICO_WIFI_SSID:-}"
WIFI_PASSWORD="${PICO_WIFI_PASSWORD:-}"
HOST_IP=""
BACKEND_PORT=8000
FRONTEND_PORT=5173
NO_OPEN=0
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
PIDS=()
PICO_RUNTIME="$(mktemp "${TMPDIR:-/tmp}/pico_noise_sender.XXXXXX")"

usage() {
  cat <<'EOF'
Usage:
  ./run_all.sh --port /dev/cu.usbmodemXXXX --wifi-ssid "SSID" --wifi-password "PASSWORD"

Options:
  --port PORT              Pico serial port; defaults to PICO_PORT or auto
  --wifi-ssid SSID         Wi-Fi SSID; defaults to PICO_WIFI_SSID
  --wifi-password PASSWORD Wi-Fi password; defaults to PICO_WIFI_PASSWORD
  --host-ip IP             Computer LAN IP visible to Pico W
  --backend-port PORT      Backend port, default 8000
  --frontend-port PORT     Frontend port, default 5173
  --no-open                Do not open browser pages
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --port) PICO_PORT="$2"; shift 2 ;;
    --wifi-ssid) WIFI_SSID="$2"; shift 2 ;;
    --wifi-password) WIFI_PASSWORD="$2"; shift 2 ;;
    --host-ip) HOST_IP="$2"; shift 2 ;;
    --backend-port) BACKEND_PORT="$2"; shift 2 ;;
    --frontend-port) FRONTEND_PORT="$2"; shift 2 ;;
    --no-open) NO_OPEN=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

cleanup() {
  local code=$?
  trap - EXIT INT TERM
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  rm -f "$PICO_RUNTIME"
  exit "$code"
}
trap cleanup EXIT INT TERM

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

wait_http() {
  local url="$1"
  local attempts="${2:-40}"
  for ((i = 0; i < attempts; i++)); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 0.5
  done
  return 1
}

detect_host_ip() {
  if [[ -n "$HOST_IP" ]]; then
    printf '%s' "$HOST_IP"
    return
  fi

  if [[ "$(uname -s)" == "Darwin" ]]; then
    local iface
    iface="$(route -n get default 2>/dev/null | awk '/interface:/{print $2; exit}')"
    if [[ -n "$iface" ]]; then
      ipconfig getifaddr "$iface" 2>/dev/null && return
    fi
  fi

  hostname -I 2>/dev/null | awk '{print $1}'
}

for command in anvil forge node npm python3 curl; do
  require_command "$command"
done

if [[ -z "$WIFI_SSID" || -z "$WIFI_PASSWORD" ]]; then
  echo "Wi-Fi credentials are required. Use --wifi-ssid/--wifi-password or PICO_WIFI_SSID/PICO_WIFI_PASSWORD." >&2
  exit 1
fi

HOST_IP="$(detect_host_ip)"
if [[ -z "$HOST_IP" ]]; then
  echo "Could not detect the LAN IP. Pass --host-ip manually." >&2
  exit 1
fi

if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  npm install --prefix "$ROOT/frontend"
fi

if ! python3 -c "import eth_account, joblib, mpremote, numpy, sklearn, web3" >/dev/null 2>&1; then
  python3 -m pip install -r "$ROOT/requirements.txt"
fi

for port in 8545 "$BACKEND_PORT" "$FRONTEND_PORT"; do
  if command -v lsof >/dev/null 2>&1 && lsof -ti :"$port" >/dev/null 2>&1; then
    echo "Port $port is already in use. Stop the existing process and run again." >&2
    exit 1
  fi
done

export PRIVATE_KEY
export ORACLE_SUBMIT_ONCHAIN=1
export ORACLE_RPC_URL="http://127.0.0.1:8545"
export ORACLE_PORT="$BACKEND_PORT"

echo "Starting Anvil..."
anvil --host 127.0.0.1 --port 8545 >"$ROOT/hardware/anvil.full.out.log" 2>"$ROOT/hardware/anvil.full.err.log" &
PIDS+=("$!")
sleep 2

echo "Deploying RentEscrow..."
(
  cd "$ROOT"
  forge script script/Deploy.s.sol --rpc-url "$ORACLE_RPC_URL" --broadcast
  node go.cjs
)

echo "Starting backend..."
python3 "$ROOT/hardware/web3_oracle.py" >"$ROOT/hardware/web3_oracle.full.out.log" 2>"$ROOT/hardware/web3_oracle.full.err.log" &
PIDS+=("$!")
wait_http "http://127.0.0.1:$BACKEND_PORT/health" || {
  echo "Backend failed to start. Check hardware/web3_oracle.full.err.log." >&2
  exit 1
}

echo "Starting frontend..."
npm run dev --prefix "$ROOT/frontend" -- --host 127.0.0.1 --port "$FRONTEND_PORT" >"$ROOT/hardware/frontend.full.out.log" 2>"$ROOT/hardware/frontend.full.err.log" &
PIDS+=("$!")
wait_http "http://127.0.0.1:$FRONTEND_PORT/" 60 || {
  echo "Frontend failed to start. Check hardware/frontend.full.err.log." >&2
  exit 1
}

PICO_WIFI_SSID="$WIFI_SSID" \
PICO_WIFI_PASSWORD="$WIFI_PASSWORD" \
PICO_HOST_IP="$HOST_IP" \
PICO_BACKEND_PORT="$BACKEND_PORT" \
PICO_TEMPLATE="$ROOT/hardware/pico_noise_sender.py" \
PICO_RUNTIME="$PICO_RUNTIME" \
python3 - <<'PY'
import json
import os
import re
from pathlib import Path

source = Path(os.environ["PICO_TEMPLATE"]).read_text(encoding="utf-8")
values = {
    "SSID": os.environ["PICO_WIFI_SSID"],
    "PASSWORD": os.environ["PICO_WIFI_PASSWORD"],
    "ORACLE_URL": f"http://{os.environ['PICO_HOST_IP']}:{os.environ['PICO_BACKEND_PORT']}/noise/ingest",
    "AUDIO_UPLOAD_URL": f"http://{os.environ['PICO_HOST_IP']}:{os.environ['PICO_BACKEND_PORT']}/api/audio/upload",
    "MIC_TEST_UPLOAD_URL": f"http://{os.environ['PICO_HOST_IP']}:{os.environ['PICO_BACKEND_PORT']}/api/mic-test/upload",
}
for name, value in values.items():
    source = re.sub(rf"(?m)^{name} = .+$", f"{name} = {json.dumps(value)}", source)
source = re.sub(r"(?m)^ENABLE_MIC_TEST_UPLOAD = .+$", "ENABLE_MIC_TEST_UPLOAD = True", source)
Path(os.environ["PICO_RUNTIME"]).write_text(source, encoding="utf-8")
PY

FRONTEND_URL="http://127.0.0.1:$FRONTEND_PORT/"
INSTANT_URL="http://127.0.0.1:$BACKEND_PORT/instant_noise_test/"
echo "Frontend:      $FRONTEND_URL"
echo "Instant model: $INSTANT_URL"
echo "Backend:       http://127.0.0.1:$BACKEND_PORT/health"
echo "Pico host IP:  $HOST_IP"

if [[ "$NO_OPEN" -eq 0 ]]; then
  if [[ "$(uname -s)" == "Darwin" ]]; then
    open "$FRONTEND_URL"
    open "$INSTANT_URL"
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$FRONTEND_URL" >/dev/null 2>&1 || true
    xdg-open "$INSTANT_URL" >/dev/null 2>&1 || true
  fi
fi

echo "Running Pico W. Press Ctrl+C to stop the full project."
python3 -m mpremote connect "$PICO_PORT" run "$PICO_RUNTIME"
