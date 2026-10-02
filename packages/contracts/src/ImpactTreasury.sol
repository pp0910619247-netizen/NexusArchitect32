// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Holds impact rewards and executes time-locked community proposals.
contract ImpactTreasury is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 public constant ROUND_DURATION = 30 days;
    IERC20 public immutable token;

    struct Proposal {
        address proposer;
        address beneficiary;
        uint256 targetAmount;
        uint64 votingEnds;
        uint256 forVotes;
        uint256 againstVotes;
        bool executed;
        bool pinned;
    }

    uint256 public proposalCount;
    mapping(uint256 => Proposal) private proposals;
    mapping(uint256 => mapping(address => bool)) public hasVoted;

    constructor(address initialOwner, address tokenAddress) Ownable(initialOwner) {
        token = IERC20(tokenAddress);
    }

    /// @notice Creates a proposal with a 30-day voting period.
    function createProposal(address beneficiary, uint256 targetAmount) external whenNotPaused returns (uint256 id) {
        if (beneficiary == address(0) || targetAmount == 0) revert InvalidProposal();
        id = ++proposalCount;
        proposals[id] = Proposal({
            proposer: msg.sender,
            beneficiary: beneficiary,
            targetAmount: targetAmount,
            votingEnds: uint64(block.timestamp + ROUND_DURATION),
            forVotes: 0,
            againstVotes: 0,
            executed: false,
            pinned: false
        });
        emit ProposalCreated(id, msg.sender, beneficiary, targetAmount, proposals[id].votingEnds);
    }

    /// @notice Casts one vote per address for a proposal.
    function vote(uint256 id, bool support) external whenNotPaused {
        Proposal storage proposal = proposals[id];
        if (id == 0 || id > proposalCount) revert UnknownProposal();
        if (block.timestamp >= proposal.votingEnds || hasVoted[id][msg.sender]) revert VoteClosed();
        hasVoted[id][msg.sender] = true;
        if (support) proposal.forVotes++;
        else proposal.againstVotes++;
    }

    /// @notice Closes voting. A winning proposal is pinned until its target is fully funded.
    function closeRound(uint256 id) external whenNotPaused {
        Proposal storage proposal = proposals[id];
        if (id == 0 || id > proposalCount) revert UnknownProposal();
        if (proposal.executed || proposal.pinned) revert AlreadyFinal();
        if (block.timestamp < proposal.votingEnds) revert VotingStillActive();
        if (proposal.forVotes <= proposal.againstVotes || proposal.forVotes == 0) revert ProposalRejected();
        proposal.pinned = true;
        emit RoundClosed(id, proposal.pinned);
    }

    /// @notice Executes a pinned proposal, but only after the full target amount is available.
    function execute(uint256 id) external nonReentrant whenNotPaused returns (uint256 amount) {
        Proposal storage proposal = proposals[id];
        if (!proposal.pinned || proposal.executed) revert NotExecutable();
        if (token.balanceOf(address(this)) < proposal.targetAmount) revert InsufficientFunding();
        amount = proposal.targetAmount;
        proposal.executed = true;
        token.safeTransfer(proposal.beneficiary, amount);
        emit ProposalExecuted(id, proposal.beneficiary, amount);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    function getProposal(uint256 id) external view returns (Proposal memory) {
        if (id == 0 || id > proposalCount) revert UnknownProposal();
        return proposals[id];
    }

    event ProposalCreated(
        uint256 indexed id, address proposer, address beneficiary, uint256 targetAmount, uint64 votingEnds
    );
    event RoundClosed(uint256 indexed id, bool pinned);
    event ProposalExecuted(uint256 indexed id, address beneficiary, uint256 amount);
    error InvalidProposal();
    error UnknownProposal();
    error VoteClosed();
    error AlreadyFinal();
    error VotingStillActive();
    error ProposalRejected();
    error NotExecutable();
    error InsufficientFunding();
}
