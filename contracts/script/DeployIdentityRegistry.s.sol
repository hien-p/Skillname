// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/IdentityRegistry.sol";

/// @notice Deploys IdentityRegistry to whatever chain `--rpc-url` points at.
///
/// Usage:
///   SEPOLIA_PRIVATE_KEY=0x... \
///   forge script contracts/script/DeployIdentityRegistry.s.sol \
///     --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast
contract DeployIdentityRegistry is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("SEPOLIA_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        IdentityRegistry registry = new IdentityRegistry();
        console.log("IdentityRegistry deployed at:", address(registry));
        vm.stopBroadcast();
    }
}
