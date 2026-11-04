// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {AgentSpendEscrow} from "../AgentSpendEscrow.sol";

/// @notice A test token with 6 decimals, like USDC. Anyone can mint it, and it has no value.
contract TestUSDC is ERC20 {
    constructor() ERC20("Test USDC", "tUSDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @notice Takes a 1% fee on each transfer, to test that such tokens are refused.
contract FeeToken is ERC20 {
    constructor() ERC20("Fee Token", "FEE") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(this), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// @notice A malicious token that tries to call back into the escrow during a
/// transfer, to take the same money twice.
contract ReentrantToken is ERC20 {
    AgentSpendEscrow public target;
    uint256 public dealId;
    bool public attackSucceeded;
    bool public attackAttempted;

    constructor() ERC20("Reentrant Token", "EVIL") {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function arm(AgentSpendEscrow escrow, uint256 id) external {
        target = escrow;
        dealId = id;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);

        if (address(target) != address(0) && from == address(target) && !attackAttempted) {
            attackAttempted = true;
            try target.release(dealId) {
                attackSucceeded = true;
            } catch {}
        }
    }
}
