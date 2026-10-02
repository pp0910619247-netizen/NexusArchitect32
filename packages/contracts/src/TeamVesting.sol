// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title Releases the fixed 20% team allocation in 13 equal quarterly installments.
contract TeamVesting is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;
    uint256 public constant ALLOCATION = 4_200_000 ether;
    uint256 public constant INTERVAL = 90 days;
    IERC20 public immutable token;
    address public immutable beneficiary;
    uint256 public startTime;
    uint256 public released;

    modifier onlyBeneficiary() {
        if (msg.sender != beneficiary) revert NotBeneficiary();
        _;
    }

    constructor(address initialOwner, address tokenAddress, address teamAddress, uint256 start) Ownable(initialOwner) {
        if (teamAddress == address(0)) revert InvalidAddress();
        token = IERC20(tokenAddress);
        beneficiary = teamAddress;
        startTime = start;
    }

    /// @notice Returns the cumulative amount unlocked at a timestamp.
    function vestedAmount(uint256 timestamp) public view returns (uint256) {
        if (timestamp < startTime) return 0;
        uint256 elapsed = timestamp - startTime;
        uint256 installments = elapsed / INTERVAL + 1;
        if (installments > 13) installments = 13;
        return (ALLOCATION / 13) * installments + (ALLOCATION % 13) * (installments == 13 ? 1 : 0);
    }

    function releasable() public view returns (uint256) {
        uint256 vested = vestedAmount(block.timestamp);
        return vested > released ? vested - released : 0;
    }

    function release() external onlyBeneficiary nonReentrant whenNotPaused {
        uint256 amount = releasable();
        if (amount == 0) revert NothingToRelease();
        released += amount;
        token.safeTransfer(beneficiary, amount);
        emit TokensReleased(beneficiary, amount, released);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }
    event TokensReleased(address indexed beneficiary, uint256 amount, uint256 totalReleased);
    error InvalidAddress();
    error NotBeneficiary();
    error NothingToRelease();
}
