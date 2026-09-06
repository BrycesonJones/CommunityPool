// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IProtocolConfig} from "../../src/interfaces/IProtocolConfig.sol";
import {CommunityPool} from "../../src/CommunityPool.sol";

/// @notice Treasury that refuses ETH (simulates a misconfigured recipient).
contract MockRejectingTreasury {
    receive() external payable {
        revert("MockRejectingTreasury: rejects ETH");
    }
}

/// @notice Treasury that accepts ETH silently (a Safe-like contract recipient).
contract MockAcceptingTreasury {
    receive() external payable {}
}

/// @notice Treasury that tries to re-enter the pool while receiving its fee.
/// `swallow == false` propagates the inner failure (so the outer funding reverts);
/// `swallow == true` catches it and records that the reentry was blocked (outer funding succeeds).
contract MockReentrantTreasury {
    bool public swallow;
    uint256 public reentryAttempts;
    uint256 public reentryBlocked;
    uint256 public withdrawAttemptsBlocked;

    function setSwallow(bool v) external {
        swallow = v;
    }

    receive() external payable {
        CommunityPool pool = CommunityPool(payable(msg.sender));
        reentryAttempts++;
        // Attempt a recursive fee-bearing contribution with the fee just received.
        try pool.fund{value: msg.value}() {
        // Must never happen: nonReentrant blocks it.
        }
        catch {
            reentryBlocked++;
            if (!swallow) revert("MockReentrantTreasury: reentry blocked, propagating");
        }
        // Also try to drain: not an owner, so NotOwner regardless of the guard.
        try pool.cheaperWithdraw() {}
        catch {
            withdrawAttemptsBlocked++;
        }
    }
}

/// @notice A non-official config used to prove the pool fails closed on malformed values.
contract MockMalformedProtocolConfig is IProtocolConfig {
    uint256 private _feeBps;
    address private _recipient;
    bool public revertOnFeeRead;
    bool public revertOnRecipientRead;

    constructor(uint256 feeBps_, address recipient_) {
        _feeBps = feeBps_;
        _recipient = recipient_;
    }

    function set(uint256 feeBps_, address recipient_) external {
        _feeBps = feeBps_;
        _recipient = recipient_;
    }

    function setReverts(bool onFee, bool onRecipient) external {
        revertOnFeeRead = onFee;
        revertOnRecipientRead = onRecipient;
    }

    function protocolFeeBps() external view returns (uint256) {
        if (revertOnFeeRead) revert("MockMalformedProtocolConfig: fee read reverts");
        return _feeBps;
    }

    function feeRecipient() external view returns (address) {
        if (revertOnRecipientRead) revert("MockMalformedProtocolConfig: recipient read reverts");
        return _recipient;
    }
}

/// @notice ERC-20 whose outbound `transfer` returns false (never reverts) when armed. SafeERC20
/// must treat the false return as failure.
contract MockFalseReturningERC20 is ERC20 {
    uint8 private immutable _decimals;
    bool public returnFalseOnTransfer;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setReturnFalseOnTransfer(bool v) external {
        returnFalseOnTransfer = v;
    }

    function transfer(address to, uint256 value) public override returns (bool) {
        if (returnFalseOnTransfer) return false;
        return super.transfer(to, value);
    }
}
