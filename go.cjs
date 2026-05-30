const fs = require("fs");
const path = require("path");

// 讀 Foundry 編譯輸出
const artifactPath = path.join(__dirname, "out/RentEscrow.sol/RentEscrow.json");
const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

// 讀最新部署的合約地址
const broadcastPath = path.join(__dirname, "broadcast/Deploy.s.sol/31337/run-latest.json");
const broadcast = JSON.parse(fs.readFileSync(broadcastPath, "utf8"));
const contractAddress = broadcast.transactions[0].contractAddress;

// 輸出到前端
const output = {
  address: contractAddress,
  abi: artifact.abi,
};

const outDir = path.join(__dirname, "frontend/src");
fs.writeFileSync(path.join(outDir, "contract.json"), JSON.stringify(output, null, 2));
console.log("contract.json 已產生，合約地址：", contractAddress);
