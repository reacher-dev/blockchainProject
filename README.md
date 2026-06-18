# DePIN 租屋噪音治理系統

## 專案概述
本專案是一個去中心化實體基礎設施（DePIN）的噪音治理示範，用於租屋情境。
- **硬體**：Raspberry Pi Pico W + INMP441 I2S 麥克風。
- **後端**：Python Oracle（HTTP 8000）收集噪音 telemetry、PCM 音訊、FFT + ML 分類，並可簽名上鏈。
- **區塊鏈**：Foundry + Anvil 本地鏈（31337）部署 `RentEscrow.sol`，管理房客押金、罰款、申訴與 DAO 投票。
- **前端**：React + Vite，使用 MetaMask 互動，提供即時 dB 圖表、房間管理、罰款與投票 UI。

目標：示範 IoT 感測 → 後端分析 → 智慧合約自動執行的完整流水線，適合作為 DePIN 應用的教學或原型。

## 架構圖
```mermaid
flowchart LR
    Mic["INMP441 麥克風"]
    Pico["Raspberry Pi Pico W"]
    Oracle["Python Oracle<br/>port 8000"]
    FFT["FFT + sklearn model"]
    Contract["RentEscrow.sol<br/>Anvil port 8545"]
    Frontend["React 前端<br/>Vite"]
    Mic -->|I2S| Pico
    Pico -->|Telemetry JSON| Oracle
    Pico -->|PCM 音訊| Oracle
    Oracle --> FFT
    Oracle -->|noise/latest| Frontend
    Oracle -->|signed reportNoise| Contract
    Frontend -->|ethers.js| Contract
```
說明三條資料路徑：
1. **Telemetry**：0.1 秒一筆 dB 讀值 → 前端即時圖表。
2. **音訊分析**：PCM → WAV → FFT → ML → 噪音類型（不直接罰款）。
3. **上鏈**：符合條件的 telemetry 由 Oracle 簽名並呼叫 `reportNoise()`。

## 必要環境
| 項目 | 最低版本 / 要求 |
|------|----------------|
| Foundry（forge、anvil） | `brew install foundry`（macOS）或參考 https://book.getfoundry.sh |
| Node.js | 18+ |
| Python | 3.10+ |
| MetaMask | 瀏覽器擴充套件 |
| Raspberry Pi Pico W | 需安裝 MicroPython、支援 `network`、`urequests`、`machine.I2S` |
| INMP441 麥克風 | I2S 接腳依硬體 README 配置 |

若僅想在本機模擞，硬體可略過，只跑 Telemetry simulation。

## 快速開始
### 1. 安裝前端與後端相依套件
```bash
# 前端
cd frontend
npm install
# 後端 (Python)
python3 -m pip install \
  mpremote numpy scikit-learn==1.9.0 joblib \
  web3 eth-account
```
### 2. 啟動完整 Demo（推薦）
```bash
# 找出 Pico 的串列埠 (macOS 範例)
ls /dev/cu.usbmodem*

# 以環境變數方式防止密碼寫入歷史
PICO_WIFI_SSID="YourWiFiSSID"
PICO_WIFI_PASSWORD="***"

# 執行一鍵腳本 (把 /dev/cu.usbmodemXXXX 換成實際埠號)
./run_all.sh --port /dev/cu.usbmodemXXXX
```
腳本會依序啟動 Anvil、本地鏈 `31337`、部署合約、啟動 Oracle、啟動 React 前端，最後把 `pico_noise_sender.py` 上傳至 Pico 並執行，開始傳送噪音 telemetry。
> 注意：腳本會持續印出 Pico 的噪音資料，請勿使用 `Ctrl+C` 中斷，除非想手動停止全部服務。
### 3. 若只想模擬（不接硬體）
```bash
# 啟動 Anvil、Oracle、前端（不啟動 Pico）
./run_all.sh --skip-pico
# 或手動分步驟：
anvil &
forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast &
python hardware/web3_oracle.py &
cd frontend && npm run dev
```
在瀏覽器中開啟即時 dB 圖表、房間管理、罰款與投票 UI，即可體驗完整流程。

## 使用說明
| 功能 | 操作說明 |
|------|----------|
| 即時噪音監控 | 前端每 200 ms 向 Oracle `GET /noise/latest` 拉取最新 dB。 |
| 上鏈罰款 | 當 telemetry 滿足罰款條件，Oracle 會呼叫 `reportNoise()`，MetaMask 會彈出簽名請求。 |
| 申訴流程 | 房客點「申訴」後，合約鎖定罰款，DAO Quadratic Voting 開啟投票，投票結束自動決定是否撤銷罰款。 |
| 模型預測 | PCM 音訊上傳後，Oracle 執行 FFT → sklearn model → 回傳 `confidence`、`noise_type`。 |
| 硬體設定 | 請參閱 `hardware/README.md`，包含 Pico Wi‑Fi 設定、GPIO、I2S 連接圖。 |

## 貢獻指南
1. Fork 本倉庫，在 `main` 分支上工作。
2. 建立新分支：`git checkout -b feature/xxxx`。
3. 編寫/修改程式碼，確保 `forge test`、`npm run lint && npm run build` 通過。
4. 提交：`git add . && git commit -m "your concise message"`。
5. 推送：`git push origin feature/xxxx`。
6. 建立 Pull Request，說明變更內容與測試方式。

**測試**
- 合約：`forge test`（自帶 gas 報告）
- 前端：`npm run lint && npm run build`
- Oracle：若加入測試套件，執行 `python -m pytest`

## 授權條款
此專案採用 MIT License，詳見 `LICENSE` 檔案。
