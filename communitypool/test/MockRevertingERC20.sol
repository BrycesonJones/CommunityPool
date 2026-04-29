// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice ERC20 that can be flipped to revert on outbound `transfer` to simulate a paused or
/// blacklisted token. `transferFrom` (used during fund-in) stays functional so the contract can
/// hold a balance, then refuse to release on the way out.
contract MockRevertingERC20 is ERC20 {
    uint8 private immutable _decimals;
    bool public revertOnTransfer;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setRevertOnTransfer(bool v) external {
        revertOnTransfer = v;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (revertOnTransfer) revert("MockRevertingERC20: paused");
        return super.transfer(to, value);
    }
}
