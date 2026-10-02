// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {MilestoneAnchor} from "../src/MilestoneAnchor.sol";

/// @dev MilestoneAnchor is Amoy-bound (chainId 80002), so every test runs
///      under vm.chainId(80002); the constructor reverts anywhere else.
contract MilestoneAnchorTest is Test {
    address owner = address(0xA11CE);
    address attacker = address(0xB0B);

    bytes32 hash = keccak256("milestone-1000");
    bytes32 spanFrom = keccak256("span-from");
    bytes32 spanTo = keccak256("span-to");

    MilestoneAnchor anchor;

    function setUp() public {
        vm.chainId(80_002);
        anchor = new MilestoneAnchor(owner);
    }

    function testConstructorRejectsNonAmoy() public {
        vm.chainId(1);
        vm.expectRevert(MilestoneAnchor.ChainMismatch.selector);
        new MilestoneAnchor(owner);
    }

    function testRecordAndReadBack() public {
        vm.expectEmit(true, true, false, true, address(anchor));
        emit MilestoneAnchor.MilestoneAnchored(1_000, hash, spanFrom, spanTo, 1_000, 777, uint64(block.timestamp));
        vm.prank(owner);
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 777);

        assertTrue(anchor.anchored(1_000));
        assertTrue(anchor.isAnchored(1_000));
        MilestoneAnchor.Milestone memory m = anchor.getMilestone(1_000);
        assertEq(m.milestoneHash, hash);
        assertEq(m.spanFromBlockHash, spanFrom);
        assertEq(m.spanToBlockHash, spanTo);
        assertEq(m.totalCumulativeWork, 777);
        assertEq(m.anchoredAt, uint64(block.timestamp));
        assertEq(anchor.chainIdBound(), 80_002);
    }

    function testOnlyOwnerCanRecord() public {
        vm.prank(attacker);
        vm.expectRevert();
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 1);
    }

    function testRejectsDuplicateAnchor() public {
        vm.startPrank(owner);
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 1);
        vm.expectRevert(MilestoneAnchor.AlreadyAnchored.selector);
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 1);
        vm.stopPrank();
    }

    function testRejectsInvalidHeights() public {
        vm.startPrank(owner);
        vm.expectRevert(MilestoneAnchor.InvalidHeight.selector);
        anchor.recordMilestone(0, hash, spanFrom, spanTo, 0, 1);
        vm.expectRevert(MilestoneAnchor.InvalidHeight.selector);
        anchor.recordMilestone(999, hash, spanFrom, spanTo, 999, 1);
        vm.expectRevert(MilestoneAnchor.InvalidHeight.selector);
        anchor.recordMilestone(1_500, hash, spanFrom, spanTo, 1_500, 1);
        vm.stopPrank();
    }

    function testRejectsSpanMismatch() public {
        vm.prank(owner);
        vm.expectRevert(MilestoneAnchor.MilestoneMismatch.selector);
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 2_000, 1);
    }

    function testRejectsZeroHash() public {
        vm.prank(owner);
        vm.expectRevert(MilestoneAnchor.InvalidMilestoneHash.selector);
        anchor.recordMilestone(1_000, bytes32(0), spanFrom, spanTo, 1_000, 1);
    }

    function testRejectsRecordOnOtherChain() public {
        vm.chainId(1);
        vm.prank(owner);
        vm.expectRevert(MilestoneAnchor.ChainMismatch.selector);
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 1);
    }

    function testPauseBlocksRecording() public {
        vm.startPrank(owner);
        anchor.pause();
        vm.expectRevert();
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 1);
        anchor.unpause();
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 1);
        assertTrue(anchor.isAnchored(1_000));
        vm.stopPrank();
    }

    function testUnknownMilestoneRead() public {
        vm.expectRevert(MilestoneAnchor.UnknownMilestone.selector);
        anchor.getMilestone(2_000);
    }

    function testOwnershipIsTwoStep() public {
        vm.prank(owner);
        anchor.transferOwnership(attacker);
        vm.prank(attacker);
        anchor.acceptOwnership();
        vm.prank(attacker);
        anchor.recordMilestone(1_000, hash, spanFrom, spanTo, 1_000, 1);
        assertTrue(anchor.isAnchored(1_000));
    }
}
