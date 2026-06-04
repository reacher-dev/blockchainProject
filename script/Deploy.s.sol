// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/RentEscrow.sol";

/**
 * @notice Deploy RentEscrow to a local Anvil node.
 *
 * Usage:
 *   anvil
 *   PRIVATE_KEY=<key> forge script script/Deploy.s.sol --rpc-url http://127.0.0.1:8545 --broadcast
 *
 * Optional env vars:
 *   ORACLE_ADDRESS  — oracle address (default: Anvil account #1)
 */
contract DeployScript is Script {
    address constant DEFAULT_ORACLE = 0x70997970C51812dc3A010C7d01b50e0d17dc79C8;

    function run() external {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");

        address oracle = DEFAULT_ORACLE;
        try vm.envAddress("ORACLE_ADDRESS") returns (address a) {
            if (a != address(0)) oracle = a;
        } catch {}

        vm.startBroadcast(deployerKey);
        RentEscrow escrow = new RentEscrow(oracle);
        vm.stopBroadcast();

        console.log("RentEscrow deployed at:", address(escrow));
        console.log("Landlord:", escrow.landlord());
        console.log("Oracle  :", oracle);
    }
}
