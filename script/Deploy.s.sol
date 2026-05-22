// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RentEscrow.sol";

/**
 * @notice Deploy RentEscrow to a local Anvil node.
 *
 * Usage:
 *   anvil                         # start local node in another terminal
 *   forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 */
contract DeployScript is Script {
    // Anvil default account #0 (landlord) and #1 (oracle public key)
    // Replace with real addresses for testnet/mainnet
    address constant ORACLE = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        RentEscrow escrow = new RentEscrow(ORACLE);

        console.log("RentEscrow deployed at:", address(escrow));
        console.log("Landlord:", escrow.landlord());
        console.log("Oracle  :", escrow.oracle());

        vm.stopBroadcast();
    }
}
