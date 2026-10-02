// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {NexToken} from "../src/NexToken.sol";
import {NexusMining} from "../src/NexusMining.sol";
import {ImpactTreasury} from "../src/ImpactTreasury.sol";
import {TeamVesting} from "../src/TeamVesting.sol";

/// @dev Polygon Amoy testnet only. Refuses every other chain.
contract Deploy is Script {
    uint256 public constant AMOY_CHAIN_ID = 80002;

    function run() external {
        require(block.chainid == AMOY_CHAIN_ID, "Amoy only");
        uint256 key = vm.envUint("PRIVATE_KEY");
        address owner = vm.addr(key);
        address team = vm.envAddress("TEAM_ADDRESS");
        vm.startBroadcast(key);
        NexToken token = new NexToken(owner);
        ImpactTreasury impact = new ImpactTreasury(owner, address(token));
        NexusMining mining = new NexusMining(owner, address(token), address(impact));
        TeamVesting vesting = new TeamVesting(owner, address(token), team, block.timestamp);
        bytes32 minterRole = token.MINTER_ROLE();
        token.grantRole(minterRole, address(mining));
        mining.fundTeamVesting(address(vesting));
        vm.stopBroadcast();
    }
}
