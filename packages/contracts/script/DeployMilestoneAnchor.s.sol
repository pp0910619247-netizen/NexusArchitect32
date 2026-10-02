// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {MilestoneAnchor} from "../src/MilestoneAnchor.sol";

/// @dev Deploys MilestoneAnchor on Polygon Amoy testnet (chainId 80002) only.
///      Env: PRIVATE_KEY (anchor wallet, becomes the owner). Optional:
///      ANCHOR_OWNER to hand ownership to a different address.
contract DeployMilestoneAnchor is Script {
    uint256 public constant AMOY_CHAIN_ID = 80002;

    function run() external {
        require(block.chainid == AMOY_CHAIN_ID, "Amoy only");
        uint256 key = vm.envUint("PRIVATE_KEY");
        address owner = vm.envOr("ANCHOR_OWNER", vm.addr(key));
        vm.startBroadcast(key);
        MilestoneAnchor anchor = new MilestoneAnchor(owner);
        vm.stopBroadcast();
        // forge prints the deployment address in the broadcast log; echo it
        // explicitly so the value can be pasted into the node's env directly.
        console2.log("MilestoneAnchor:", address(anchor));
        console2.log("Owner:", owner);
    }
}
