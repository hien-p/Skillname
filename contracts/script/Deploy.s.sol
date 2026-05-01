// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "forge-std/Script.sol";
import "../src/SkillLink.sol";

contract DeploySkillLink is Script {
    function run() external {
        uint256 deployerKey = vm.envUint("SEPOLIA_PRIVATE_KEY");
        vm.startBroadcast(deployerKey);

        SkillLink registry = new SkillLink();
        console.log("SkillLink deployed at:", address(registry));

        vm.stopBroadcast();
    }
}
