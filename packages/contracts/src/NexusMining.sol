// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface INexMintable {
    function mint(address to, uint256 amount) external;
}

/// @title Commit/reveal miner coordination and Genesis Era rewards.
contract NexusMining is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant GENESIS_START = 1;
    uint256 public constant GENESIS_END = 10_000;
    uint256 public constant HALVING_INTERVAL = 1_000;
    uint256 public constant INITIAL_REWARD = 1_051 ether;
    uint256 public constant GENESIS_CAP = 2_100_000 ether;
    uint256 public constant BPS = 10_000;
    uint256 public constant IMPACT_BPS = 1_000;
    uint256 public constant WINNER_BPS = 4_000;
    INexMintable public immutable mintable;
    IERC20 public immutable paymentToken;
    address public immutable treasury;

    struct Problem {
        bytes32 answerCommitHash;
        bool committed;
        bool closed;
        bytes32 answerHash;
        bytes32 salt;
    }

    struct RewardSplit {
        uint256 impactFirst;
        uint256 winnerAmount;
        uint256 minersPool;
    }
    mapping(uint256 => Problem) public problems;
    mapping(uint256 => mapping(address => bytes32)) public answers;
    mapping(uint256 => mapping(address => uint64)) public answerTimestamps;
    bool public teamVestingFunded;
    uint256 public totalMiningMinted;

    constructor(address initialOwner, address tokenAddress, address treasuryAddress) Ownable(initialOwner) {
        mintable = INexMintable(tokenAddress);
        paymentToken = IERC20(tokenAddress);
        treasury = treasuryAddress;
    }

    function commitProblem(uint256 height, bytes32 answerCommitHash) external onlyOwner whenNotPaused {
        if (height < GENESIS_START || height > GENESIS_END || answerCommitHash == bytes32(0)) revert InvalidProblem();
        Problem storage problem = problems[height];
        if (problem.committed) revert AlreadyCommitted();
        problem.answerCommitHash = answerCommitHash;
        problem.committed = true;
        emit ProblemCommitted(height, answerCommitHash);
    }

    function submitAnswer(uint256 height, bytes32 answerHash) external whenNotPaused {
        Problem storage problem = problems[height];
        if (!problem.committed || problem.closed) revert ProblemUnavailable();
        if (answerHash != problem.answerCommitHash || answerHash == bytes32(0)) revert AnswerMismatch();
        if (answers[height][msg.sender] != bytes32(0)) revert AlreadySubmitted();
        answers[height][msg.sender] = answerHash;
        answerTimestamps[height][msg.sender] = uint64(block.timestamp);
        emit AnswerSubmitted(height, msg.sender, answerHash, uint64(block.timestamp));
    }

    /// @notice Funds the fixed team allocation once, without consuming the Genesis mining cap.
    function fundTeamVesting(address vesting) external onlyOwner nonReentrant {
        if (vesting == address(0)) revert InvalidDistribution();
        if (teamVestingFunded) revert AlreadyFunded();
        teamVestingFunded = true;
        mintable.mint(vesting, 4_200_000 ether);
    }

    function closeBlock(
        uint256 height,
        bytes32 salt,
        address winner,
        address[] calldata miners,
        uint256[] calldata weights
    ) external onlyOwner nonReentrant whenNotPaused {
        Problem storage problem = problems[height];
        if (!problem.committed || problem.closed || salt == bytes32(0) || winner == address(0)) revert InvalidClose();
        if (miners.length == 0 || miners.length != weights.length) revert InvalidDistribution();
        if (answers[height][winner] != problem.answerCommitHash) revert WinnerHasNoCorrectAnswer();
        uint256 totalWeight;
        for (uint256 i; i < miners.length; ++i) {
            address miner = miners[i];
            if (miner == address(0) || weights[i] == 0 || answers[height][miner] != problem.answerCommitHash) {
                revert InvalidDistribution();
            }
            for (uint256 j; j < i; ++j) {
                if (miners[j] == miner) revert DuplicateMiner();
            }
            totalWeight += weights[i];
        }
        if (totalWeight == 0) revert InvalidDistribution();
        uint256 reward = blockReward(height);
        RewardSplit memory split = _splitReward(reward);
        problem.closed = true;
        problem.answerHash = problem.answerCommitHash;
        problem.salt = salt;
        if (totalMiningMinted + reward > GENESIS_CAP) revert GenesisCapExceeded();
        totalMiningMinted += reward;
        mintable.mint(address(this), reward);
        uint256 distributed = _payMiners(miners, weights, totalWeight, split.minersPool);
        uint256 impactAmount = split.impactFirst + (split.minersPool - distributed);
        paymentToken.safeTransfer(treasury, impactAmount);
        paymentToken.safeTransfer(winner, split.winnerAmount);
        emit AnswerRevealed(height, problem.answerHash, salt);
        emit BlockClosed(height, winner, split.winnerAmount, split.minersPool, impactAmount);
    }

    function rewardSplit(uint256 height) external pure returns (RewardSplit memory split) {
        return _splitReward(blockReward(height));
    }

    function _splitReward(uint256 reward) private pure returns (RewardSplit memory split) {
        split.impactFirst = (reward * IMPACT_BPS) / BPS;
        uint256 remaining = reward - split.impactFirst;
        split.winnerAmount = (remaining * WINNER_BPS) / BPS;
        split.minersPool = remaining - split.winnerAmount;
    }

    function _payMiners(address[] calldata miners, uint256[] calldata weights, uint256 totalWeight, uint256 pool)
        private
        returns (uint256 distributed)
    {
        for (uint256 i; i < miners.length; ++i) {
            uint256 amount = (pool * weights[i]) / totalWeight;
            distributed += amount;
            paymentToken.safeTransfer(miners[i], amount);
        }
    }

    /// @notice Bounded halving schedule; no loop and Genesis heights only.
    function blockReward(uint256 height) public pure returns (uint256) {
        if (height < GENESIS_START || height > GENESIS_END) revert InvalidBlock();
        uint256 era = (height - 1) / HALVING_INTERVAL;
        uint256 reward = INITIAL_REWARD >> era;
        if (era == 0) return reward;
        return reward + ((INITIAL_REWARD >> (era - 1)) & 1);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
    event ProblemCommitted(uint256 indexed height, bytes32 answerCommitHash);
    event AnswerSubmitted(uint256 indexed height, address indexed miner, bytes32 answerHash, uint64 timestamp);
    event AnswerRevealed(uint256 indexed height, bytes32 answerHash, bytes32 salt);
    event BlockClosed(
        uint256 indexed height, address indexed winner, uint256 winnerAmount, uint256 minersTotal, uint256 impactAmount
    );
    error InvalidProblem();
    error AlreadyCommitted();
    error ProblemUnavailable();
    error AnswerMismatch();
    error AlreadySubmitted();
    error InvalidClose();
    error InvalidDistribution();
    error WinnerHasNoCorrectAnswer();
    error DuplicateMiner();
    error InvalidBlock();
    error AlreadyFunded();
    error GenesisCapExceeded();
}

