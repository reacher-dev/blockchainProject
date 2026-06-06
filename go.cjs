const fs   = require("fs");
const path = require("path");
const glob = require("fs");

// 讀 Foundry 編譯輸出
const artifactPath = path.join(__dirname, "out/RentEscrow.sol/RentEscrow.json");
const artifact     = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

// 從最新的 broadcast 取得部署地址
function getLatestDeployedAddress() {
  const broadcastDir = path.join(__dirname, "broadcast/Deploy.s.sol/31337");
  if (!fs.existsSync(broadcastDir)) return null;
  const files = fs.readdirSync(broadcastDir)
    .filter(f => f.endsWith(".json"))
    .map(f => ({ f, t: Number(f.replace("run-", "").replace(".json", "")) }))
    .sort((a, b) => b.t - a.t);
  if (!files.length) return null;
  const latest = JSON.parse(fs.readFileSync(path.join(broadcastDir, files[0].f), "utf8"));
  const tx = latest.transactions?.find(t => t.contractAddress);
  return tx?.contractAddress || null;
}

const contractAddress = getLatestDeployedAddress();

const output = {
  abi:      artifact.abi,
  bytecode: artifact.bytecode.object,
  address:  contractAddress || null,
};

const outDir = path.join(__dirname, "frontend/src");
fs.writeFileSync(path.join(outDir, "contract.json"), JSON.stringify(output, null, 2));
console.log("contract.json 已產生（abi + bytecode" + (contractAddress ? ` + address: ${contractAddress}` : "") + "）");
