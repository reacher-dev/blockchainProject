# DePIN 租屋噪音治理系統

一個將物聯網感測器、區塊鏈智能合約與 DAO 投票機制結合的去中心化租屋管理平台。房客的噪音行為由 Raspberry Pi Pico W 感測器即時偵測，透過 Python Oracle 上鏈，自動從押金扣罰款；若房客對違規不服，可在 5 分鐘窗口內發起申訴，由所有房客與房東以 Quadratic Voting 決定是否退款。

**核心概念**

| 層面 | 技術 | 說明 |
|------|------|------|
| DePIN | Raspberry Pi Pico W + INMP441 麥克風 | 實體感測器量測分貝，將噪音數據送往 Oracle |
| DeFi | `RentEscrow.sol` 押金托管 | 押金鎖在合約，觸發違規自動扣款，申訴通過自動退款 |
| DAO | Quadratic Voting 提案投票 | 房客與房東共同決議申訴案，防止多數暴力 |

---

## 系統架構

```mermaid
flowchart LR
    Mic["INMP441 麥克風"]
    Pico["Raspberry Pi Pico W\n(MicroPython)"]
    Oracle["Python Oracle 後端\nweb3_oracle.py\n:8000"]
    Contract["RentEscrow.sol\nAnvil :8545"]
    Frontend["React 前端\nVite :5173"]

    Mic -->|I2S| Pico
    Pico -->|HTTP POST JSON\n每 0.1 秒| Oracle
    Oracle -->|GET /noise/latest\nGET /noise/history| Frontend
    Oracle -->|reportNoise() tx\n持續 5 秒 ≥ 75 dB| Contract
    Frontend -->|ethers.js| Contract
```

**各層技術棧**

- **智能合約**：Solidity ^0.8.24、Foundry（forge / anvil）、OpenZeppelin（ECDSA、ReentrancyGuard）
- **前端**：React 18、Vite、ethers.js，元件化角色分流（房東 / 房客 / 訪客）
- **硬體 / Oracle**：Raspberry Pi Pico W、MicroPython、Python 3（`web3.py`）、INMP441 I2S 麥克風

**後端 API 端點**

```
GET  http://127.0.0.1:8000/health
GET  http://127.0.0.1:8000/noise/latest
GET  http://127.0.0.1:8000/noise/history
POST http://127.0.0.1:8000/noise/ingest
POST http://127.0.0.1:8000/contract/address
```

---

## 專案結構

```
blockchainProject/
├── src/
│   └── RentEscrow.sol          # 核心智能合約（押金、違規、DAO）
├── script/
│   └── Deploy.s.sol            # Foundry 部署腳本
├── test/
│   └── RentEscrow.t.sol        # Forge 單元測試（含 QV 測試）
├── frontend/
│   ├── src/
│   │   ├── App.jsx             # 根元件、錢包連接、角色判斷
│   │   ├── Web3.js             # ethers.js 合約互動封裝
│   │   ├── contract.json       # ABI + 合約地址（由 go.cjs 自動產生）
│   │   └── components/
│   │       ├── Dashboard.jsx   # 房東：系統總覽（房間卡、事件日誌）
│   │       ├── AdminPanel.jsx  # 房東：登記房客、觸發噪音
│   │       ├── MockControl.jsx # 即時分貝圖表 + 手動觸發面板
│   │       ├── MyRoom.jsx      # 房客：我的房間、補押金、發起申訴
│   │       └── DAOPanel.jsx    # DAO 提案列表、Quadratic Voting 滑桿
│   └── package.json
├── hardware/
│   ├── pico_noise_sender.py    # Pico W 主程式（MicroPython，需設定 Wi-Fi）
│   ├── web3_oracle.py          # Python Oracle 後端（HTTP 伺服器 + 上鏈）
│   ├── send_sample_payload.py  # 模擬噪音測試工具（無需實體硬體）
│   ├── noise_monitor.html      # 即時分貝折線圖（瀏覽器獨立頁面）
│   └── blink.py                # Pico W LED 測試
├── go.cjs                      # 部署後自動更新 contract.json
├── start.sh                    # 一鍵啟動腳本
└── foundry.toml                # Foundry 設定
```

---

## 快速啟動

### 環境需求

| 工具 | 版本 | 說明 |
|------|------|------|
| [Foundry](https://getfoundry.sh/) | 最新 | `forge`、`anvil` |
| Node.js | ≥ 18 | 前端 Vite 開發伺服器 |
| Python 3 | ≥ 3.10 | Oracle 後端 |
| web3.py | `pip install web3 eth-account` | Python 上鏈套件 |

### 一鍵啟動

```bash
bash start.sh
```

腳本會依序自動執行：

1. 清除殘留程序（port 8545、8000）
2. 啟動 Anvil 本地節點（背景，port 8545）
3. 部署 `RentEscrow.sol`（使用 Anvil Account #0 作為房東）
4. 更新 `frontend/src/contract.json`（ABI + 合約地址）
5. 啟動 Oracle 後端（背景，port 8000，自動上鏈模式）
6. 啟動 React 前端（前景，port 5173）

按 `Ctrl+C` 會自動關閉 Anvil 與 Oracle。

**服務網址**

```
Anvil    → http://127.0.0.1:8545
Oracle   → http://127.0.0.1:8000
Frontend → http://localhost:5173
```

### MetaMask 設定

在 MetaMask 新增本地測試網路：

```
網路名稱：Anvil Local
RPC URL：http://127.0.0.1:8545
Chain ID：31337
貨幣符號：ETH
```

### 帳號匯入

**房東帳號（Anvil Account #0）**

```
地址：0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
私鑰：0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
```

**房客帳號（由房東在管理頁登記後使用）**

```
#1  0x70997970C51812dc3A010C7d01b50e0d17dc79C8
#2  0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC
#3  0x90F79bf6EB2c4f870365E785982E1f101E93b906
#4  0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65
```

對應私鑰可在 `anvil` 啟動時的輸出中找到（Account #1–#4）。

### 第一次使用流程

1. 開啟 `http://localhost:5173`，連接 MetaMask（房東帳號）
2. 首次登入輸入暱稱，系統自動進入**系統總覽**
3. 切換至**管理**頁 → 登記房客（填入地址、選擇房間）
4. 切換 MetaMask 至房客帳號，重新連接 → 自動進入**我的房間**
5. 房客存入押金（至少 0.004 ETH，覆蓋最高罰款級距）
6. 用模擬工具觸發噪音（見下方「模擬測試」）

---

## 角色說明

### 房東（Landlord）

- 部署合約時自動成為房東（不可轉移）
- 在**管理**頁登記最多 5 間房（Room A–E）的房客地址
- 在**系統總覽**查看所有房間餘額、違規記錄與事件日誌
- 可管理 Oracle 白名單（`addOracle` / `removeOracle`）
- 可參與 DAO 投票（但不能自行發起申訴）

### 房客（Tenant）

- 由房東登記後，以對應地址連接錢包即可使用
- 在**我的房間**查看押金餘額（可用 / 鎖定）及個人違規歷史
- 存入押金（`deposit()`）或提領可用餘額（`withdraw()`）
- 對不服的違規，在 5 分鐘內發起申訴（需支付 0.01 ETH 手續費）
- 對他人的申訴案進行 Quadratic Voting

### Oracle

- 可以是實體 Pico W 感測器，也可以是後端模擬腳本
- 每次上鏈前用 ECDSA 私鑰簽署 `(chainId, contractAddress, roomIndex, decibels, nonce)`
- 合約以 `isOracle` mapping 驗證簽署者，防止偽造數據

---

## 模擬測試

### 模擬單次噪音事件

不需要實體硬體，直接用 Python 腳本模擬 Pico W 送出的數據：

```bash
# 模擬房間「劉」偵測到 82 dB 噪音（超過 70 dB 閾值）
python hardware/send_sample_payload.py --room "劉" --decibels 82

# 房間別名：林 / 劉 / 鄭 / 吳 / 許，或用 Room A–E，或用索引 0–4
python hardware/send_sample_payload.py --room "Room A" --decibels 90
python hardware/send_sample_payload.py --room 0 --decibels 78
```

後端收到後若數據持續 5 秒以上且 ≥ 75 dB，會自動簽署並呼叫 `reportNoise()` 上鏈。

### 即時分貝圖表

啟動 Oracle 後直接在瀏覽器開啟：

```
hardware/noise_monitor.html
```

頁面每 100 ms 輪詢後端，顯示 `estimatedDb`（即時讀值）、`decibels`（上鏈用值）、`noiseLevel` 三條曲線。

### 完整流程

1. `bash start.sh` 啟動所有服務
2. 房東帳號登入前端 → 管理頁登記房客並指定房間
3. 房客帳號登入 → 存入押金 ≥ 0.004 ETH
4. 執行 `python hardware/send_sample_payload.py --room 0 --decibels 82` 觸發違規
5. 等候約 5 秒 → 前端事件日誌出現 `NoiseReported`，房客押金自動扣款
6. 切換至房客帳號 → 我的房間頁面 → 對該違規點擊「發起申訴」
7. 所有房客與房東在**DAO 投票**頁投票（5 分鐘內）
8. 投票結束後任何人可點擊「執行提案」
   - 贊成票 > 反對票 → 押金退還給房客
   - 反對票 ≥ 贊成票 → 罰款分配給其他房客

---

## 合約規則說明

### 罰款累計制度

罰款金額依每位房客**累計違規次數**分三級，違規次數越多罰得越重：

| 累計違規次數 | 每次罰款 |
|-------------|---------|
| 第 1–5 次 | 0.001 ETH（TIER 1） |
| 第 6–10 次 | 0.002 ETH（TIER 2） |
| 第 11 次以上 | 0.004 ETH（TIER 3） |

最低押金需求為 0.004 ETH（等於最高級距罰款），押金不足時無法被記錄違規。

罰款金額均分給其他房客，但先以**鎖定狀態**存放，待申訴窗口過後（或申訴結案後）才釋放為可提領餘額。

### 申訴與 Quadratic Voting

- **申訴窗口**：違規記錄後 **5 分鐘**內（`APPEAL_WINDOW = 300` 秒，Demo 用）
- **申訴費用**：0.01 ETH（從申訴人押金扣除，不退還）
- **投票資格**：所有已登記房客（申訴人除外）＋房東
- **Quadratic Voting 規則**：

  | 投票數 | 消耗 Credits |
  |--------|-------------|
  | 1 票 | 1 credit |
  | 2 票 | 4 credits |
  | 3 票 | 9 credits |

  每位投票者每個提案有 **9 voice credits**，最多投 3 票（恰好花光 9 credits）。

- **決勝條件**：`yesVotes（票數加總）> noVotes`
- **最低法定人數**：至少需累計 3 個投票單位才能執行提案（`VOTE_QUORUM = 3`）
- **提前結案**：所有有資格的投票者都投票後，任何人可立即執行提案，不需等 5 分鐘

### Oracle 安全機制

- **Nonce 防重放**：每次 `reportNoise()` 消耗一個合約級 nonce，Oracle 必須帶入當前值，防止相同簽名被重複提交
- **多 Oracle 支援**：房東可新增／移除 Oracle 地址，至少保留 1 個
- **ECDSA 簽章驗證**：合約驗證簽署者是否在 `isOracle` 白名單內

---

## Pico W 實體硬體設定

在 `hardware/pico_noise_sender.py` 填入 Wi-Fi 與 Oracle 設定（不要 commit 真實憑證）：

```python
SSID = "YOUR_WIFI_NAME"
PASSWORD = "YOUR_WIFI_PASSWORD"
ORACLE_URL = "http://YOUR_HOST_IP:8000/"   # 使用區網 IP，不是 127.0.0.1
SENSOR_MODE = "inmp441"
```

**INMP441 接線**

```
INMP441 VDD → Pico 3V3(OUT)
INMP441 GND → Pico GND
INMP441 SCK → Pico GP10
INMP441 WS  → Pico GP11
INMP441 SD  → Pico GP12
INMP441 L/R → GND
```

**燒錄並執行**

```bash
# 透過 USB 直接執行（測試用）
python -m mpremote connect COM3 run hardware/pico_noise_sender.py

# 複製為 main.py，上電自動執行
python -m mpremote connect COM3 fs cp hardware/pico_noise_sender.py :main.py
python -m mpremote connect COM3 reset
```

---

## 手動逐步啟動（Windows / 偵錯用）

```powershell
# 1. 啟動 Anvil
anvil

# 2. 部署合約並更新 ABI
$env:PRIVATE_KEY="0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80"
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
node go.cjs

# 3. 啟動 Oracle 後端
python -m pip install web3 eth-account
$env:ORACLE_SUBMIT_ONCHAIN="1"
$env:ORACLE_RPC_URL="http://127.0.0.1:8545"
python hardware\web3_oracle.py

# 4. 啟動前端
cd frontend
npm run dev
```

---

## 注意事項

- 不要 commit 真實 Wi-Fi 密碼或區網 IP
- `broadcast/`、`cache/`、`out/` 等本地測試產物不應 commit（已列入 `.gitignore`）
- 重啟 `start.sh` 後 Anvil 會重置，舊合約地址失效；前端會顯示「合約已失效」並跳回部署頁
- 合約地址存於瀏覽器 `localStorage`；MetaMask 連接時前端自動同步給後端（`POST /contract/address`）
