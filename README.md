# 🏘️ DePIN Rental Noise Governance System

去中心化租屋噪音治理系統 — DePIN + DeFi + DAO

## 概述

解決分租公寓深夜噪音糾紛的 Web3 自治系統。透過 IoT 感測器客觀記錄分貝，智慧合約自動扣款補償，DAO 投票處理申訴。

## 系統架構

- **DePIN**：Raspberry Pi Pico W + INMP441 I2S 麥克風監聽噪音，透過 HTTP 傳送事件到後端 Oracle Relay
- **Backend Oracle Relay**：Python HTTP server 接收 Pico W payload，驗證/正規化資料，保留 latest/history 狀態，必要時簽章並送出 `reportNoise` 交易
- **DeFi**：RentEscrow 智慧合約管理保證金，自動扣款與 1/N 補償
- **DAO**：房客投票決定申訴是否成立，超過 60% 贊成則退款

## 技術

| 層 | 技術 |
|----|------|
| 智慧合約 | Solidity, Foundry, Anvil |
| 前端 | React, Vite, ethers.js |
| Backend / Oracle | Python HTTP server, Web3.py / eth-account（on-chain 模式） |
| IoT | Raspberry Pi Pico W, MicroPython, INMP441 I2S microphone |

## 快速開始

### 1. 啟動本地鏈

```bash
anvil
```

### 2. 部署合約

```bash
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
```

### 3. 更新合約地址

把部署出來的地址與 ABI 寫入 `frontend/src/contract.json`：

```bash
node go.cjs
```

### 4. 啟動前端

```bash
cd frontend
npm install
npm run dev
```

### 5. 啟動 Backend Oracle Relay

Relay 會接收 Pico W 傳來的 JSON，也提供 `GET /noise/latest` 和 `GET /noise/history` 給前後端整合測試。

```bash
python3 hardware/web3_oracle.py
```

沒有硬體時，可以用同樣格式的 payload 模擬 Pico W：

```bash
python3 hardware/send_sample_payload.py --room "Room A" --decibels 82
curl http://127.0.0.1:8000/noise/latest
```

若要讓 Relay 直接送出 oracle-signed `reportNoise` 交易到本地鏈：

```bash
pip install web3 eth-account
ORACLE_SUBMIT_ONCHAIN=1 ORACLE_RPC_URL=http://127.0.0.1:8545 python3 hardware/web3_oracle.py
```

### 6. Pico W / INMP441 設定

在 `hardware/pico_noise_sender.py` 設定 Wi-Fi 與後端位置：

```python
SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"
ORACLE_URL = "http://YOUR_BACKEND_IP:8000/"
```

沒有接麥克風時維持：

```python
SENSOR_MODE = "simulation"
```

接上 INMP441 後改成：

```python
SENSOR_MODE = "inmp441"
```

預設接線：

```text
INMP441 VDD -> Pico 3V3(OUT)
INMP441 GND -> Pico GND
INMP441 SCK -> Pico GP10
INMP441 WS  -> Pico GP11
INMP441 SD  -> Pico GP12
INMP441 L/R -> GND
```

### 7. MetaMask 設定

新增 Anvil 本地網路：
- RPC URL：`http://127.0.0.1:8545`
- Chain ID：`31337`

匯入測試帳號（Anvil Account #0，Landlord）：
```
0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

## 角色說明

| 角色 | Anvil 帳號 | 說明 |
|------|-----------|------|
| Landlord | Account #0 | 部署者，負責登記房客 |
| Oracle | Account #1 | 感測器簽章帳號（不需匯入 MetaMask）|
| 房客 | Account #2 以後 | 需登記並存入保證金 |

## Demo 流程

1. Landlord 登記房客（管理頁）
2. 各房客存入保證金（≥ 0.4 ETH）
3. Pico W + INMP441 偵測噪音，或用 `send_sample_payload.py` 模擬同樣 payload
4. Backend Oracle Relay 接收 payload，轉成 room index / decibels，並可送出 `reportNoise`
5. 合約自動扣款，補償金先鎖定到其他房客帳戶
6. 被扣款者可發起 DAO 申訴，其他人投票決定

## 專案結構

```
├── src/                  # Solidity 合約
│   └── RentEscrow.sol
├── test/                 # Foundry 測試
├── script/               # 部署腳本
├── frontend/             # React 前端
│   └── src/
│       ├── App.jsx
│       ├── web3.js
│       └── contract.json
└── hardware/             # Pico W / INMP441 / Backend Oracle Relay
    ├── pico_noise_sender.py
    ├── web3_oracle.py
    ├── send_sample_payload.py
    └── README.md
```
