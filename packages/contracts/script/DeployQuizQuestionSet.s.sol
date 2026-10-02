// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {console2} from "forge-std/console2.sol";
import {QuizQuestionSet} from "../src/QuizQuestionSet.sol";

/// @dev Publishes ONE quiz set (bank root + 1 full bilingual item) on Polygon
///      Amoy testnet (chainId 80002) only.
///
///      Env — required:
///        PRIVATE_KEY        deployer key, becomes the contract owner. Use a
///                           throwaway testnet key; never a key holding funds.
///        QUIZ_ANSWER_INDEX  correct choice of the item (0..3).
///        QUIZ_ANSWER_SALT   32-byte random salt (hex or uint). KEEP IT SECRET:
///                           with only 4 options, the commitment is worthless
///                           without an unguessable salt.
///      Env — optional:
///        QUIZ_SET_FILE      default `data/quiz-set-1.json` (public text only).
///        QUIZ_OWNER         owner address (defaults to the deployer).
///
///      The answer index and the salt are read from the environment and are
///      NEVER written to a tracked file (packages/contracts/README.md).
contract DeployQuizQuestionSet is Script {
    uint256 public constant AMOY_CHAIN_ID = 80002;

    function run() external {
        require(block.chainid == AMOY_CHAIN_ID, "Amoy only");

        uint256 key = vm.envUint("PRIVATE_KEY");
        address owner = vm.envOr("QUIZ_OWNER", vm.addr(key));
        uint8 answerIndex = uint8(vm.envUint("QUIZ_ANSWER_INDEX"));
        require(answerIndex < 4, "QUIZ_ANSWER_INDEX must be 0..3");
        bytes32 salt = bytes32(vm.envUint("QUIZ_ANSWER_SALT"));
        require(salt != bytes32(0), "QUIZ_ANSWER_SALT required");

        string memory json = vm.readFile(vm.envOr("QUIZ_SET_FILE", string("data/quiz-set-1.json")));
        uint256 setId = vm.parseJsonUint(json, ".setId");
        bytes32 bankRoot = vm.parseJsonBytes32(json, ".bankRoot");
        string memory schema = vm.parseJsonString(json, ".schema");
        uint256 questionCount = vm.parseJsonUint(json, ".questionCount");

        QuizQuestionSet.ItemInput memory item = _readItem(json);
        item.answerCommit = keccak256(abi.encode(setId, item.itemId, answerIndex, salt));

        vm.startBroadcast(key);
        QuizQuestionSet registry = new QuizQuestionSet(owner);
        registry.publishSet(setId, bankRoot, schema, uint32(questionCount));
        registry.storeItem(setId, item);
        vm.stopBroadcast();

        console2.log("QuizQuestionSet:", address(registry));
        console2.log("owner:", owner);
        console2.log("setId:", setId);
        console2.log("schema:", schema);
        console2.log("bankRoot:");
        console2.logBytes32(bankRoot);
        console2.log("itemId:", item.itemId);
        console2.log("sourceHash:");
        console2.logBytes32(item.sourceHash);
        console2.log("answerCommit:");
        console2.logBytes32(item.answerCommit);
        console2.log("answer index + salt stay off chain until reveal; run");
        console2.log("  QUIZ_REGISTRY=<address> forge script script/RevealQuizAnswer.s.sol --rpc-url $AMOY_RPC_URL --broadcast");
    }

    /// @dev Reads the public item text out of the generated JSON. The answer is
    ///      intentionally absent from that file.
    function _readItem(string memory json) internal pure returns (QuizQuestionSet.ItemInput memory item) {
        item.itemId = vm.parseJsonString(json, ".item.itemId");
        item.sourceHash = vm.parseJsonBytes32(json, ".item.sourceHash");
        item.promptTh = vm.parseJsonString(json, ".item.prompt.th");
        item.promptEn = vm.parseJsonString(json, ".item.prompt.en");
        for (uint256 i; i < 4; ++i) {
            item.optionsTh[i] = vm.parseJsonString(json, _path(".item.options.th[", i));
            item.optionsEn[i] = vm.parseJsonString(json, _path(".item.options.en[", i));
        }
    }

    function _path(string memory prefix, uint256 index) internal pure returns (string memory) {
        return string.concat(prefix, vm.toString(index), "]");
    }
}
