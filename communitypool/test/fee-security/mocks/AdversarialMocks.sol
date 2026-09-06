// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CommunityPool} from "../../../src/CommunityPool.sol";
import {IProtocolConfig} from "../../../src/interfaces/IProtocolConfig.sol";

/// @notice Harness exposing the internal fee snapshot so the math can be fuzzed without moving assets.
contract PoolHarness is CommunityPool {
    constructor(
        string memory name_,
        string memory description_,
        uint256 minimumUsd_,
        address[] memory coOwners,
        uint64 expiresAt_,
        address ethUsdFeed,
        TokenConfig[] memory tokenConfigs,
        address protocolConfig_
    )
        CommunityPool(name_, description_, minimumUsd_, coOwners, expiresAt_, ethUsdFeed, tokenConfigs, protocolConfig_)
    {}

    function feeFor(uint256 grossAmount) external view returns (uint256 feeAmount, address recipient) {
        return _protocolFeeFor(grossAmount);
    }
}

/// @notice A treasury that may ALSO be an explicitly authorized pool owner. On ETH receipt it
/// attempts one configured pool action, recording what happened, and optionally propagates the
/// failure so the outer funding fails closed.
contract OwnerTreasury {
    enum Action {
        None,
        Withdraw,
        CheaperWithdraw,
        WithdrawToken,
        WithdrawTokenAmount,
        Fund,
        FundDirect,
        Release
    }

    Action public action;
    bool public propagate;
    IERC20 public token;
    uint256 public amount;
    uint256 public callbacks;
    uint256 public actionSucceeded;
    uint256 public actionFailed;
    bytes public lastRevert;
    uint256 public poolBalanceSeenInCallback;

    receive() external payable {
        callbacks++;
        CommunityPool pool = CommunityPool(payable(msg.sender));
        poolBalanceSeenInCallback = address(pool).balance;
        bool ok;
        bytes memory ret;
        if (action == Action.None) return;
        if (action == Action.Withdraw) {
            (ok, ret) = address(pool).call(abi.encodeWithSelector(pool.withdraw.selector, amount));
        } else if (action == Action.CheaperWithdraw) {
            (ok, ret) = address(pool).call(abi.encodeWithSelector(pool.cheaperWithdraw.selector));
        } else if (action == Action.WithdrawToken) {
            (ok, ret) = address(pool).call(abi.encodeWithSelector(pool.withdrawToken.selector, token));
        } else if (action == Action.WithdrawTokenAmount) {
            (ok, ret) = address(pool).call(abi.encodeWithSelector(pool.withdrawTokenAmount.selector, token, amount));
        } else if (action == Action.Fund) {
            (ok, ret) = address(pool).call{value: msg.value}(abi.encodeWithSelector(pool.fund.selector));
        } else if (action == Action.FundDirect) {
            (ok, ret) = address(pool).call{value: msg.value}("");
        } else if (action == Action.Release) {
            (ok, ret) = address(pool).call(abi.encodeWithSelector(pool.releaseExpiredFundsToDeployer.selector));
        }
        if (ok) {
            actionSucceeded++;
        } else {
            actionFailed++;
            lastRevert = ret;
            if (propagate) revert("OwnerTreasury: propagating inner failure");
        }
    }

    function configure(Action a, bool propagate_, IERC20 t, uint256 amt) external {
        action = a;
        propagate = propagate_;
        token = t;
        amount = amt;
    }

    /// @dev Let tests move assets this contract legitimately holds (it is an owner in some tests).
    function callPool(address pool, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = pool.call(data);
    }
}

/// @notice Treasury that burns gas on receipt, optionally reverting afterwards.
contract GasGriefingTreasury {
    uint256 public iterations;
    bool public revertAfter;
    uint256 private _sink;

    function configure(uint256 iterations_, bool revertAfter_) external {
        iterations = iterations_;
        revertAfter = revertAfter_;
    }

    receive() external payable {
        uint256 acc;
        for (uint256 i = 0; i < iterations; i++) {
            acc = uint256(keccak256(abi.encode(acc, i)));
        }
        _sink = acc;
        if (revertAfter) revert("GasGriefingTreasury: revert after burn");
    }
}

/// @notice Config whose getters burn gas before answering (cost griefing) or return extreme values.
contract ExpensiveProtocolConfig is IProtocolConfig {
    uint256 public fee;
    address public recipient;
    uint256 public iterations;

    constructor(uint256 fee_, address recipient_, uint256 iterations_) {
        fee = fee_;
        recipient = recipient_;
        iterations = iterations_;
    }

    function _burn() internal view returns (uint256 acc) {
        for (uint256 i = 0; i < iterations; i++) {
            acc = uint256(keccak256(abi.encode(acc, i)));
        }
    }

    function protocolFeeBps() external view returns (uint256) {
        _burn();
        return fee;
    }

    function feeRecipient() external view returns (address) {
        _burn();
        return recipient;
    }
}

/// @notice ERC-20 with configurable fee-on-transfer applied on transferFrom only, transfer only, or both.
contract FeeOnTransferModesERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint16 public feeBps;
    bool public onTransferFrom;
    bool public onTransfer;
    bool private _inTransferFrom;

    constructor(uint8 decimals_) ERC20("FoT", "FOT") {
        _decimals = decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configure(uint16 feeBps_, bool onTransferFrom_, bool onTransfer_) external {
        feeBps = feeBps_;
        onTransferFrom = onTransferFrom_;
        onTransfer = onTransfer_;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _inTransferFrom = true;
        bool r = super.transferFrom(from, to, value);
        _inTransferFrom = false;
        return r;
    }

    function _update(address from, address to, uint256 value) internal override {
        bool taxed = feeBps > 0 && from != address(0) && to != address(0)
            && ((_inTransferFrom && onTransferFrom) || (!_inTransferFrom && onTransfer));
        if (!taxed) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        if (fee > 0) super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}

/// @notice Balance-manipulating token: reported balances are scaled by a multiplier that can be
/// changed at any time, including from inside a transfer (simulating a rebase mid-funding).
contract RebasingERC20 {
    uint8 public constant decimals = 18;
    string public constant name = "Rebase";
    string public constant symbol = "RB";
    mapping(address => uint256) internal _shares;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public multiplierBps = 10_000;
    bool public rebaseInsideTransfer;
    uint256 public rebaseToBps;

    function mint(address to, uint256 amount) external {
        _shares[to] += amount;
    }

    function setMultiplier(uint256 bps) external {
        multiplierBps = bps;
    }

    function setRebaseInsideTransfer(bool on, uint256 toBps) external {
        rebaseInsideTransfer = on;
        rebaseToBps = toBps;
    }

    function balanceOf(address a) public view returns (uint256) {
        return (_shares[a] * multiplierBps) / 10_000;
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function _move(address from, address to, uint256 amount) internal {
        uint256 shares = (amount * 10_000) / multiplierBps;
        require(_shares[from] >= shares, "RB: balance");
        _shares[from] -= shares;
        _shares[to] += shares;
        if (rebaseInsideTransfer) multiplierBps = rebaseToBps;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _move(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "RB: allowance");
        allowance[from][msg.sender] -= amount;
        _move(from, to, amount);
        return true;
    }
}

/// @notice USDT-style token: transfer/transferFrom/approve return nothing.
contract NoReturnERC20 {
    uint8 public constant decimals = 6;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address s, uint256 v) external {
        allowance[msg.sender][s] = v;
    }

    function transfer(address to, uint256 amount) external {
        require(balanceOf[msg.sender] >= amount, "NR: balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }

    function transferFrom(address from, address to, uint256 amount) external {
        require(allowance[from][msg.sender] >= amount, "NR: allowance");
        require(balanceOf[from] >= amount, "NR: balance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
    }
}

/// @notice Token whose `transfer` returns malformed data (a 32-byte word that is not a bool) when armed,
/// and whose `balanceOf` can be made to revert or lie.
contract MalformedERC20 {
    uint8 public constant decimals = 18;
    mapping(address => uint256) internal _bal;
    mapping(address => mapping(address => uint256)) public allowance;
    bool public malformedReturn;
    bool public balanceOfReverts;
    uint256 public balanceOfOverride; // 0 = honest
    bool public balanceOfIncrementsEachRead;
    uint256 public reads;

    function mint(address to, uint256 amount) external {
        _bal[to] += amount;
    }

    function arm(bool malformed, bool revertBal, uint256 overrideBal, bool incrementing) external {
        malformedReturn = malformed;
        balanceOfReverts = revertBal;
        balanceOfOverride = overrideBal;
        balanceOfIncrementsEachRead = incrementing;
    }

    function balanceOf(address a) external view returns (uint256) {
        if (balanceOfReverts) revert("MF: balanceOf reverts");
        if (balanceOfOverride != 0) return balanceOfOverride;
        if (balanceOfIncrementsEachRead) {
            // view: cannot persist `reads`, so derive a moving value from gas left to differ across reads.
            return _bal[a] + (gasleft() % 7);
        }
        return _bal[a];
    }

    function approve(address s, uint256 v) external returns (bool) {
        allowance[msg.sender][s] = v;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(allowance[from][msg.sender] >= amount, "MF: allowance");
        require(_bal[from] >= amount, "MF: balance");
        allowance[from][msg.sender] -= amount;
        _bal[from] -= amount;
        _bal[to] += amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        require(_bal[msg.sender] >= amount, "MF: balance");
        _bal[msg.sender] -= amount;
        _bal[to] += amount;
        if (malformedReturn) {
            assembly {
                mstore(0, 2) // not a valid bool
                return(0, 32)
            }
        }
        return true;
    }
}

/// @notice ERC-20 with hooks: during transferFrom and/or transfer it performs an arbitrary configured
/// call (e.g. re-enter the pool). Used both as a plain token and as an explicitly added pool owner.
contract CallbackERC20 is ERC20 {
    uint8 private immutable _decimals;
    address public target;
    bytes public callData;
    uint256 public callValue;
    bool public hookOnTransferFrom;
    bool public hookOnTransfer;
    bool public propagate;
    uint256 public hookCalls;
    uint256 public hookSucceeded;
    uint256 public hookFailed;
    bytes public lastRevert;
    bool private _inTransferFrom;

    constructor(uint8 decimals_) ERC20("Callback", "CB") {
        _decimals = decimals_;
    }

    receive() external payable {}

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function configureHook(
        address target_,
        bytes calldata data,
        uint256 value,
        bool onFrom,
        bool onTransfer,
        bool propagate_
    ) external {
        target = target_;
        callData = data;
        callValue = value;
        hookOnTransferFrom = onFrom;
        hookOnTransfer = onTransfer;
        propagate = propagate_;
    }

    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        _inTransferFrom = true;
        bool r = super.transferFrom(from, to, value);
        _inTransferFrom = false;
        return r;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        bool fire = target != address(0) && from != address(0) && to != address(0)
            && ((_inTransferFrom && hookOnTransferFrom) || (!_inTransferFrom && hookOnTransfer));
        if (!fire) return;
        hookCalls++;
        (bool ok, bytes memory ret) = target.call{value: callValue}(callData);
        if (ok) {
            hookSucceeded++;
        } else {
            hookFailed++;
            lastRevert = ret;
            if (propagate) revert("CallbackERC20: propagating hook failure");
        }
    }

    /// @dev When this token is itself an owner, tests use this to exercise owner paths directly.
    function callPool(address pool, bytes calldata data) external returns (bool ok, bytes memory ret) {
        (ok, ret) = pool.call(data);
    }
}
