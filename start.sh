#!/usr/bin/env bash
# 一鍵啟動: Anvil -> 部署合約 -> Oracle -> Frontend
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"

# Anvil Account #0 測試私鑰（僅用於本地開發）
PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
RPC_URL="http://127.0.0.1:8545"

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; CYAN='\033[0;36m'; NC='\033[0m'
log()  { printf "${CYAN}[start]${NC} %s\n" "$*"; }
ok()   { printf "${GREEN}[  ok ]${NC} %s\n" "$*"; }
warn() { printf "${YELLOW}[ warn]${NC} %s\n" "$*"; }
err()  { printf "${RED}[error]${NC} %s\n" "$*"; }

PIDS=()
cleanup() {
  echo ""
  warn "收到中斷訊號，正在關閉所有服務..."
  for pid in "${PIDS[@]}"; do
    kill "$pid" 2>/dev/null || true
  done
  wait 2>/dev/null || true
  ok "全部關閉完畢。"
  exit 0
}
trap cleanup INT TERM

# 清除殘留程序
for port in 8545 8000; do
  old=$(lsof -ti :"$port" 2>/dev/null || true)
  if [ -n "$old" ]; then
    warn "port $port 已被佔用，清除中... (PID $old)"
    kill $old 2>/dev/null || true
    sleep 0.3
  fi
done

# ── 1. 啟動 Anvil ────────────────────────────────────────────────────────────
log "啟動 Anvil..."
anvil --silent &
ANVIL_PID=$!
PIDS+=("$ANVIL_PID")

log "等待 Anvil 就緒..."
sleep 2
if ! curl -sf -X POST "$RPC_URL" \
    -H 'Content-Type: application/json' \
    -d '{"jsonrpc":"2.0","method":"eth_chainId","params":[],"id":1}' >/dev/null 2>&1; then
  err "Anvil 啟動失敗，請確認 anvil 是否安裝 (Foundry)"
  exit 1
fi
ok "Anvil 已就緒 (PID $ANVIL_PID)"

# ── 2. 部署合約 ──────────────────────────────────────────────────────────────
log "部署合約..."
cd "$ROOT"
PRIVATE_KEY="$PRIVATE_KEY" forge script script/Deploy.s.sol \
  --rpc-url "$RPC_URL" \
  --broadcast \
  --quiet 2>&1 | tail -3

node "$ROOT/go.cjs"
ok "合約部署完成，contract.json 已更新"

# ── 3. 啟動後端 Oracle ────────────────────────────────────────────────────────
log "啟動後端..."
ORACLE_SUBMIT_ONCHAIN=1 \
ORACLE_RPC_URL="$RPC_URL" \
python3 "$ROOT/hardware/web3_oracle.py" &
ORACLE_PID=$!
PIDS+=("$ORACLE_PID")
sleep 1
if kill -0 "$ORACLE_PID" 2>/dev/null; then
  ok "後端已就緒 (port 8000, PID $ORACLE_PID)"
else
  err "後端啟動失敗"
  cleanup
fi

# ── 4. 啟動前端 ──────────────────────────────────────────────────────────────
log "啟動前端..."
cd "$ROOT/frontend"
npm run dev
