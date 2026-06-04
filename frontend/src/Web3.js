import { ethers } from "ethers";
import contractData from "./contract.json";

export const CONTRACT_ADDRESS = contractData.address;
export const ABI = contractData.abi;

// Oracle 私鑰（Anvil Account #3，測試用）
export const ORACLE_PRIVATE_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";

export const ROOM_NAMES = ["Alice", "Bob", "Charlie", "David", "Eve"];

// MetaMask 連線
export async function connectWallet(selectedAddress = null) {
  if (!window.ethereum) throw new Error("請安裝 MetaMask");
  const provider = new ethers.BrowserProvider(window.ethereum);
  const accounts = selectedAddress
    ? [selectedAddress]
    : await provider.send("eth_requestAccounts", []);
  const signer = await provider.getSigner(accounts[0]);
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  const contract = new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
  return { provider, signer, address, contract, chainId: network.chainId };
}

// Oracle 簽章（模擬 RPi，Phase 1 用）
export async function signAsOracle(contractAddress, chainId, roomIndex, decibels, nonce) {
  const wallet = new ethers.Wallet(ORACLE_PRIVATE_KEY);
  const hash = ethers.solidityPackedKeccak256(
    ["uint256", "address", "uint8", "uint256", "uint256"],
    [BigInt(chainId), contractAddress, roomIndex, BigInt(decibels), BigInt(nonce)]
  );
  return await wallet.signMessage(ethers.getBytes(hash));
}

export const fmt = (wei) => parseFloat(ethers.formatEther(wei)).toFixed(4);
