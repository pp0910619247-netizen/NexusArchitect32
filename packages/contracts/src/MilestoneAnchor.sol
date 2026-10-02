// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";

/// @title MilestoneAnchor — on-chain notary for quiz-chain milestone hashes.
/// @dev  Polygon Amoy testnet (chainId 80002) ONLY; the deploy script refuses
///       every other chain. One record per milestone height, written by the
///       quiz-chain node (the owner key) every 1,000 mined blocks.
contract MilestoneAnchor is Ownable2Step, Pausable {
    uint256 public constant AMOY_CHAIN_ID = 80002;

    struct Milestone {
        bytes32 milestoneHash;
        bytes32 spanFromBlockHash;
        bytes32 spanToBlockHash;
        uint64 anchoredAt;
        uint256 totalCumulativeWork;
    }

    /// @dev milestone height → record (heights are multiples of 1,000).
    mapping(uint256 => Milestone) private milestones;

    /// @dev True once a height has been anchored (idempotence guard).
    mapping(uint256 => bool) public anchored;

    /// @notice Chain id this anchor is bound to (immutably Amoy).
    uint256 public immutable chainIdBound;

    error ChainMismatch();
    error InvalidHeight();
    error InvalidMilestoneHash();
    error MilestoneMismatch();
    error AlreadyAnchored();
    error UnknownMilestone();

    event MilestoneAnchored(
        uint256 indexed blockHeight,
        bytes32 indexed milestoneHash,
        bytes32 spanFromBlockHash,
        bytes32 spanToBlockHash,
        uint256 spanBlocks,
        uint256 totalCumulativeWork,
        uint64 anchoredAt
    );

    constructor(address initialOwner) Ownable(initialOwner) {
        chainIdBound = block.chainid;
        if (block.chainid != AMOY_CHAIN_ID) revert ChainMismatch();
    }

    /// @notice Anchors one quiz-chain milestone (owner = the node's wallet).
    /// @param blockHeight     Quiz-chain height (multiple of 1,000).
    /// @param milestoneHash   SHA-256 milestone digest from the sealed block.
    /// @param spanFromBlockHash First block hash of the covered span.
    /// @param spanToBlockHash   History digest at the milestone block.
    /// @param spanBlocks      Blocks covered (1,000 for regular milestones).
    /// @param totalCumulativeWork Cumulative PoW attempts at the milestone.
    function recordMilestone(
        uint256 blockHeight,
        bytes32 milestoneHash,
        bytes32 spanFromBlockHash,
        bytes32 spanToBlockHash,
        uint256 spanBlocks,
        uint256 totalCumulativeWork
    ) external onlyOwner whenNotPaused {
        if (block.chainid != AMOY_CHAIN_ID) revert ChainMismatch();
        if (blockHeight == 0 || blockHeight % 1_000 != 0) revert InvalidHeight();
        if (milestoneHash == bytes32(0)) revert InvalidMilestoneHash();
        if (spanBlocks != blockHeight) revert MilestoneMismatch();
        if (anchored[blockHeight]) revert AlreadyAnchored();

        anchored[blockHeight] = true;
        milestones[blockHeight] = Milestone({
            milestoneHash: milestoneHash,
            spanFromBlockHash: spanFromBlockHash,
            spanToBlockHash: spanToBlockHash,
            anchoredAt: uint64(block.timestamp),
            totalCumulativeWork: totalCumulativeWork
        });

        emit MilestoneAnchored(
            blockHeight,
            milestoneHash,
            spanFromBlockHash,
            spanToBlockHash,
            spanBlocks,
            totalCumulativeWork,
            uint64(block.timestamp)
        );
    }

    /// @notice Full record for an anchored milestone height.
    function getMilestone(uint256 blockHeight) external view returns (Milestone memory) {
        if (!anchored[blockHeight]) revert UnknownMilestone();
        return milestones[blockHeight];
    }

    /// @notice Convenience check used by the indexer/explorer.
    function isAnchored(uint256 blockHeight) external view returns (bool) {
        return anchored[blockHeight];
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
}
