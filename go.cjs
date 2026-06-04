const fs   = require("fs");
const path = require("path");

// 讀 Foundry 編譯輸出（只需要 abi + bytecode，地址由前端部署後存 localStorage）
const artifactPath = path.join(__dirname, "out/RentEscrow.sol/RentEscrow.json");
const artifact     = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

const output = {
  abi:      artifact.abi,
  bytecode: artifact.bytecode.object, // 用於 ethers ContractFactory
};

const outDir = path.join(__dirname, "frontend/src");
fs.writeFileSync(path.join(outDir, "contract.json"), JSON.stringify(output, null, 2));
console.log("contract.json 已產生（abi + bytecode，無寫死地址）");
