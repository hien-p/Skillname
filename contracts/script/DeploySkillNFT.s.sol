// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/SkillNFT.sol";

/// @notice Deploys SkillNFT to Sepolia. No constructor args.
///
/// Usage:
///   SEPOLIA_PRIVATE_KEY=0x... \
///   forge script contracts/script/DeploySkillNFT.s.sol \
///     --rpc-url https://ethereum-sepolia-rpc.publicnode.com --broadcast
contract DeploySkillNFT is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("SEPOLIA_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);
        SkillNFT nft = new SkillNFT();
        console.log("SkillNFT deployed at:", address(nft));
        console.log("name:", nft.name());
        console.log("symbol:", nft.symbol());
        vm.stopBroadcast();
    }
}
