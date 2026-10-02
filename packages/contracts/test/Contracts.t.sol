// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {NexToken} from "../src/NexToken.sol";
import {NexusMining} from "../src/NexusMining.sol";
import {ImpactTreasury} from "../src/ImpactTreasury.sol";
import {TeamVesting} from "../src/TeamVesting.sol";

contract ReentrantReceiver {
    address public target;
    bytes public payload;
    bool public blocked;

    constructor(address target_) {
        target = target_;
    }

    receive() external payable {}

    fallback(bytes calldata data) external returns (bytes memory result) {
        (bool ok,) = target.call(data);
        blocked = ok;
        result = ok ? data : bytes("");
    }
}

contract ReentrantToken is ERC20 {
    NexusMining public mining;
    bytes public attackData;
    bool private attacking;
    constructor() ERC20("Reentrant", "R") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(address target, bytes calldata data) external {
        mining = NexusMining(target);
        attackData = data;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (!attacking) {
            attacking = true;
            (bool ok,) = address(mining).call(attackData);
            attacking = false;
            if (!ok) revert("reentry blocked");
        }
        return super.transfer(to, value);
    }
}

contract ContractsTest is Test {
    address owner = address(0xA11CE);
    address alice = address(0xA11CE2);
    address bob = address(0xB0B);
    bytes32 answer = keccak256("answer");
    NexToken token;
    NexusMining mining;
    ImpactTreasury treasury;

    function setUp() public {
        token = new NexToken(owner);
        treasury = new ImpactTreasury(owner, address(token));
        mining = new NexusMining(owner, address(token), address(treasury));
        bytes32 minterRole = token.MINTER_ROLE();
        vm.prank(owner);
        token.grantRole(minterRole, address(mining));
    }

    function testRewardBoundariesAndTotal() public view {
        assertEq(mining.blockReward(1), 1051 ether);
        assertEq(mining.blockReward(1000), 1051 ether);
        assertEq(mining.blockReward(1001), 525.5 ether);
        assertEq(mining.blockReward(9999), 2.052734375 ether);
        assertEq(mining.blockReward(10000), 2.052734375 ether);
        uint256 total;
        for (uint256 h = 1; h <= 10000; ++h) {
            total += mining.blockReward(h);
        }
        assertLe(total, 2_100_000 ether);
    }

    function testCommitSubmitAndClose() public {
        vm.prank(owner);
        mining.commitProblem(1, answer);
        vm.prank(alice);
        mining.submitAnswer(1, answer);
        vm.prank(bob);
        mining.submitAnswer(1, answer);
        address[] memory miners = new address[](2);
        uint256[] memory weights = new uint256[](2);
        miners[0] = alice;
        miners[1] = bob;
        weights[0] = 1;
        weights[1] = 2;
        vm.prank(owner);
        mining.closeBlock(1, keccak256("salt"), alice, miners, weights);
        (,, bool closed, bytes32 revealed, bytes32 salt) = mining.problems(1);
        assertTrue(closed);
        assertEq(revealed, answer);
        assertEq(salt, keccak256("salt"));
        assertEq(token.totalSupply(), 1051 ether);
        assertEq(token.balanceOf(address(treasury)), 105.1 ether);
        assertEq(token.balanceOf(alice), 567.54 ether);
        assertEq(token.balanceOf(bob), 378.36 ether);
    }

    function testRejectsBadAnswerDuplicateAndClose() public {
        vm.prank(owner);
        mining.commitProblem(2, answer);
        vm.expectRevert(NexusMining.AnswerMismatch.selector);
        vm.prank(alice);
        mining.submitAnswer(2, keccak256("wrong"));
        vm.prank(alice);
        mining.submitAnswer(2, answer);
        vm.expectRevert(NexusMining.AlreadySubmitted.selector);
        vm.prank(alice);
        mining.submitAnswer(2, answer);
        address[] memory miners = new address[](1);
        uint256[] memory weights = new uint256[](1);
        miners[0] = alice;
        weights[0] = 1;
        vm.prank(owner);
        mining.closeBlock(2, keccak256("salt"), alice, miners, weights);
        vm.expectRevert(NexusMining.InvalidClose.selector);
        vm.prank(owner);
        mining.closeBlock(2, keccak256("salt2"), alice, miners, weights);
    }

    function testTreasuryRoundAndVesting() public {
        bytes32 minterRole = token.MINTER_ROLE();
        vm.prank(owner);
        token.grantRole(minterRole, owner);
        vm.prank(owner);
        token.mint(address(this), 1000 ether);
        token.transfer(address(treasury), 1000 ether);
        treasury.createProposal(alice, 100 ether);
        vm.prank(alice);
        treasury.vote(1, true);
        vm.warp(block.timestamp + 30 days);
        treasury.closeRound(1);
        treasury.execute(1);
        assertEq(token.balanceOf(alice), 100 ether);
        assertEq(token.balanceOf(address(treasury)), 900 ether);
        TeamVesting vesting = new TeamVesting(owner, address(token), bob, block.timestamp);
        assertEq(vesting.vestedAmount(block.timestamp), vesting.ALLOCATION() / 13);
    }

    function testAllSplitsPreserveEveryWei() public view {
        for (uint256 height = 1; height <= 10000; ++height) {
            NexusMining.RewardSplit memory split = mining.rewardSplit(height);
            assertEq(split.impactFirst + split.winnerAmount + split.minersPool, mining.blockReward(height));
            assertGe(split.impactFirst, (mining.blockReward(height) * 1_000) / 10_000);
        }
    }

    function testTeamAllocationIsFundedOnce() public {
        TeamVesting vesting = new TeamVesting(owner, address(token), bob, block.timestamp);
        vm.prank(owner);
        mining.fundTeamVesting(address(vesting));
        assertEq(token.balanceOf(address(vesting)), 4_200_000 ether);
        assertEq(mining.totalMiningMinted(), 0);
        vm.expectRevert(NexusMining.AlreadyFunded.selector);
        vm.prank(owner);
        mining.fundTeamVesting(address(vesting));
        vm.expectRevert(NexusMining.InvalidDistribution.selector);
        vm.prank(owner);
        mining.fundTeamVesting(address(0));
    }

    function testTokenCapAndVestingRelease() public {
        bytes32 minterRole = token.MINTER_ROLE();
        vm.prank(owner);
        token.grantRole(minterRole, owner);
        uint256 cap = token.CAP();
        vm.prank(owner);
        vm.expectRevert();
        token.mint(owner, cap + 1);
        vm.prank(owner);
        token.mint(address(this), 4_200_000 ether);
        TeamVesting vesting = new TeamVesting(owner, address(token), bob, block.timestamp - 1);
        token.transfer(address(vesting), vesting.ALLOCATION());
        vm.prank(bob);
        vesting.release();
        assertEq(vesting.released(), vesting.ALLOCATION() / 13);
    }

    function testTreasuryWaitsForFunding() public {
        treasury.createProposal(alice, 100 ether);
        vm.prank(alice);
        treasury.vote(1, true);
        vm.warp(block.timestamp + 30 days);
        treasury.closeRound(1);
        vm.expectRevert(ImpactTreasury.InsufficientFunding.selector);
        treasury.execute(1);
        bytes32 minterRole = token.MINTER_ROLE();
        vm.prank(owner);
        token.grantRole(minterRole, owner);
        vm.prank(owner);
        token.mint(address(treasury), 100 ether);
        treasury.execute(1);
    }

    function testAccessAndInvalidInputsRevert() public {
        vm.prank(owner);
        token.pause();
        vm.expectRevert();
        mining.commitProblem(1, answer);
        vm.prank(owner);
        token.unpause();
        vm.prank(owner);
        mining.commitProblem(1, answer);
        vm.expectRevert(NexusMining.AlreadyCommitted.selector);
        vm.prank(owner);
        mining.commitProblem(1, answer);
        vm.expectRevert(NexusMining.InvalidBlock.selector);
        mining.blockReward(10001);
        vm.expectRevert(ImpactTreasury.InvalidProposal.selector);
        treasury.createProposal(address(0), 1);
    }

    function testReentrancyBlocked() public {
        ReentrantToken malicious = new ReentrantToken();
        ImpactTreasury maliciousTreasury = new ImpactTreasury(owner, address(malicious));
        NexusMining maliciousMining = new NexusMining(owner, address(malicious), address(maliciousTreasury));
        bytes32 commitment = keccak256("safe");
        vm.prank(owner);
        maliciousMining.commitProblem(1, commitment);
        vm.prank(alice);
        maliciousMining.submitAnswer(1, commitment);
        address[] memory miners = new address[](1);
        uint256[] memory weights = new uint256[](1);
        miners[0] = alice;
        weights[0] = 1;
        bytes memory callData = abi.encodeCall(NexusMining.closeBlock, (1, keccak256("salt"), alice, miners, weights));
        malicious.arm(address(maliciousMining), callData);
        vm.expectRevert("reentry blocked");
        vm.prank(owner);
        maliciousMining.closeBlock(1, keccak256("salt"), alice, miners, weights);
    }

    function testTreasuryEdgeCasesAndPause() public {
        vm.expectRevert(ImpactTreasury.UnknownProposal.selector);
        treasury.vote(0, true);
        vm.expectRevert(ImpactTreasury.UnknownProposal.selector);
        treasury.getProposal(99);
        treasury.createProposal(alice, 1 ether);
        vm.prank(alice);
        treasury.vote(1, true);
        vm.expectRevert(ImpactTreasury.VoteClosed.selector);
        vm.prank(alice);
        treasury.vote(1, false);
        vm.expectRevert(ImpactTreasury.VotingStillActive.selector);
        treasury.closeRound(1);
        vm.warp(block.timestamp + 30 days);
        treasury.closeRound(1);
        vm.expectRevert(ImpactTreasury.AlreadyFinal.selector);
        treasury.closeRound(1);
        vm.expectRevert(ImpactTreasury.InsufficientFunding.selector);
        treasury.execute(1);
        vm.prank(owner);
        treasury.pause();
        vm.expectRevert();
        treasury.createProposal(bob, 1 ether);
        vm.prank(owner);
        treasury.unpause();
    }

    function testRejectedAndVestingEdgeCases() public {
        treasury.createProposal(alice, 1 ether);
        vm.expectRevert(ImpactTreasury.ProposalRejected.selector);
        vm.warp(block.timestamp + 30 days);
        treasury.closeRound(1);
        TeamVesting vesting = new TeamVesting(owner, address(token), bob, block.timestamp + 1 hours);
        vm.expectRevert(TeamVesting.NotBeneficiary.selector);
        vesting.release();
        vm.expectRevert(TeamVesting.NothingToRelease.selector);
        vm.prank(bob);
        vesting.release();
        vm.prank(owner);
        vesting.pause();
        vm.expectRevert();
        vm.prank(bob);
        vesting.release();
        vm.prank(owner);
        vesting.unpause();
        vm.warp(vesting.startTime() + 90 days);
        assertEq(vesting.vestedAmount(block.timestamp), (vesting.ALLOCATION() / 13) * 2);
    }

    function testTokenRoleAndPause() public {
        vm.expectRevert();
        vm.prank(alice);
        token.mint(alice, 1);
        vm.prank(owner);
        token.pause();
        vm.expectRevert();
        token.mint(alice, 1);
        vm.prank(owner);
        token.unpause();
    }

    function testRemainingValidationPaths() public {
        bytes32 minterRole = token.MINTER_ROLE();
        vm.prank(owner);
        token.grantRole(minterRole, owner);
        vm.prank(owner);
        token.mint(alice, 1 ether);
        assertEq(token.balanceOf(alice), 1 ether);
        vm.expectRevert(NexToken.InvalidReceiver.selector);
        vm.prank(owner);
        token.mint(address(0), 1);
        vm.expectRevert(ImpactTreasury.InvalidProposal.selector);
        treasury.createProposal(alice, 0);
        vm.expectRevert(ImpactTreasury.NotExecutable.selector);
        treasury.execute(999);
        vm.expectRevert(TeamVesting.InvalidAddress.selector);
        new TeamVesting(owner, address(token), address(0), block.timestamp);
        TeamVesting future = new TeamVesting(owner, address(token), bob, block.timestamp + 1 days);
        assertEq(future.vestedAmount(block.timestamp - 1), 0);
        assertEq(future.releasable(), 0);
        vm.warp(future.startTime() + 2_000 days);
        assertEq(future.vestedAmount(block.timestamp), future.ALLOCATION());
        vm.expectRevert();
        vm.prank(alice);
        mining.pause();
    }
}
