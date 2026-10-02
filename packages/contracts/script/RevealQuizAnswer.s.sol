// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {QuizQuestionSet} from "../src/QuizQuestionSet.sol";

/// @dev Reveals an answer for an item that was already stored, by supplying the
///      preimage of its commitment. Polygon Amoy testnet (chainId 80002) only.
///
///      Env — required:
///        PRIVATE_KEY        the owner key used at deploy time.
///        QUIZ_REGISTRY      address printed by DeployQuizQuestionSet.
///        QUIZ_ANSWER_INDEX  the choice that was committed (0..3).
///        QUIZ_ANSWER_SALT   the same secret salt used at deploy time.
///      Env — optional:
///        QUIZ_SET_ID        default 1.
///        QUIZ_SET_FILE      default `data/quiz-set-1.json` (for the item id).
///
///      The contract recomputes keccak256(abi.encode(setId, itemId, answerIndex,
///      salt)) and reverts with AnswerMismatch unless it equals the stored
///      commitment, so a reveal can never contradict the earlier commitment.
contract RevealQuizAnswer is Script {
    uint256 public constant AMOY_CHAIN_ID = 80002;

    function run() external {
        require(block.chainid == AMOY_CHAIN_ID, "Amoy only");

        uint256 key = vm.envUint("PRIVATE_KEY");
        address registryAddress = vm.envAddress("QUIZ_REGISTRY");
        uint256 setId = vm.envOr("QUIZ_SET_ID", uint256(1));
        uint8 answerIndex = uint8(vm.envUint("QUIZ_ANSWER_INDEX"));
        bytes32 salt = bytes32(vm.envUint("QUIZ_ANSWER_SALT"));

        string memory json = vm.readFile(vm.envOr("QUIZ_SET_FILE", string("data/quiz-set-1.json")));
        string memory itemId = vm.parseJsonString(json, ".item.itemId");

        QuizQuestionSet registry = QuizQuestionSet(registryAddress);
        bytes32 expected = registry.commitFor(setId, itemId, answerIndex, salt);

        vm.startBroadcast(key);
        registry.revealAnswer(setId, itemId, answerIndex, salt);
        vm.stopBroadcast();

        console2.log("revealed:", itemId);
        console2.log("setId:", setId);
        console2.log("answerIndex:", answerIndex);
        console2.log("commitment:");
        console2.logBytes32(expected);
        console2.log("isRevealed:", registry.isRevealed(setId, itemId));
    }
}
