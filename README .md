# 🏘️ DePIN Rental Noise Governance System

去中心化租屋噪音治理系統 — DePIN + DeFi + DAO

## 概述

解決分租公寓深夜噪音糾紛的 Web3 自治系統。透過 IoT 感測器客觀記錄分貝，智慧合約自動扣款補償，DAO 投票處理申訴。

## 系統架構

- **DePIN**：Raspberry Pi 麥克風監聽，FFT 分析，ECDSA 簽章送鏈
- **DeFi**：RentEscrow 智慧合約管理保證金，自動扣款與 1/N 補償
- **DAO**：房客投票決定申訴是否成立，超過 60% 贊成則退款

## 技術

| 層 | 技術 |
|----|------|
| 智慧合約 | Solidity, Foundry, Anvil |
| 前端 | React, Vite, ethers.js |
| IoT | Raspberry Pi, Python, PyAudio |

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

把部署出來的地址填入 `frontend/src/contract.json` 的 `address` 欄位。

### 4. 啟動前端

```bash
cd frontend
npm install
npm run dev
```

### 5. MetaMask 設定

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
3. MockControl 觸發噪音違規
4. 合約自動扣款，補償金分給其他房客
5. 被扣款者可發起 DAO 申訴，其他人投票決定

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
└── hardware/             # Raspberry Pi (Phase 2)
```
