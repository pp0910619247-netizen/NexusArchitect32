// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Capped} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title NEX token with mining-only inflation
contract NexToken is ERC20Capped, AccessControl, Ownable2Step, Pausable, ReentrancyGuard {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    uint256 public constant CAP = 21_000_000 ether;

    constructor(address initialOwner)
        ERC20("Nexus Architect", "NEX")
        ERC20Capped(21_000_000 ether)
        Ownable(initialOwner)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
    }

    /// @notice Mints newly mined NEX. The permanent minter role belongs to NexusMining.
    function mint(address to, uint256 amount) external onlyRole(MINTER_ROLE) whenNotPaused nonReentrant {
        if (to == address(0)) revert InvalidReceiver();
        if (totalSupply() + amount > CAP) revert CapExceeded();
        _mint(to, amount);
    }

    /// @notice Pauses all token transfers and minting.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resumes all token transfers and minting.
    function unpause() external onlyOwner {
        _unpause();
    }

    error InvalidReceiver();
    error CapExceeded();
}
