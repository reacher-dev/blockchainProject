import { ethers } from "ethers";
import contractData from "./contract.json";

export const ABI      = contractData.abi;
export const BYTECODE = contractData.bytecode; // for ContractFactory

export const ROOM_NAMES = ["林", "劉", "鄭", "吳", "許"];

// Default oracle = Anvil Account #1 (matches web3_oracle.py default key)
const DEFAULT_ORACLE = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";

const CONTRACT_STORAGE_KEY = "depin_contract";

// ── localStorage helpers ──────────────────────────────────────────────────────

export function getStoredContractAddress() {
  try {
    const raw = localStorage.getItem(CONTRACT_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed.address) return parsed.address;
    }
  } catch { /* ignore */ }
  // fallback: 使用 go.cjs 從最新 broadcast 寫入的地址
  return contractData.address || null;
}

export function storeContractAddress(address) {
  localStorage.setItem(CONTRACT_STORAGE_KEY, JSON.stringify({ address }));
}

export function clearStoredContract() {
  localStorage.removeItem(CONTRACT_STORAGE_KEY);
}

// ── Wallet connection (no contract creation here) ─────────────────────────────

export async function connectWallet(selectedAddress = null) {
  if (!window.ethereum) throw new Error("請安裝 MetaMask");
  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = selectedAddress
    ? [selectedAddress]
    : await provider.send("eth_requestAccounts", []);
  const signer  = await provider.getSigner(accounts[0]);
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  return { provider, signer, address, chainId: network.chainId };
}

// ── Contract instance creation ────────────────────────────────────────────────

export function createContractInstance(contractAddress, signer) {
  return new ethers.Contract(contractAddress, ABI, signer);
}

// ── Dynamic deployment via MetaMask ──────────────────────────────────────────

export async function deployContract(signer, oracleAddress = DEFAULT_ORACLE) {
  const factory  = new ethers.ContractFactory(ABI, BYTECODE, signer);
  const contract = await factory.deploy(oracleAddress);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  storeContractAddress(address);
  return { contract, address };
}

// ── Utility ───────────────────────────────────────────────────────────────────

export const fmt = (wei) => parseFloat(ethers.formatEther(wei)).toFixed(4);
