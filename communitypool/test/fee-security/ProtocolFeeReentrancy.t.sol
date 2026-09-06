// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {FeeSecurityBase, CommunityPool, IERC20, Vm} from "./FeeSecurityBase.sol";
import {OwnerTreasury, CallbackERC20} from "./mocks/AdversarialMocks.sol";
import {
    CommunityPool__NotOwner,
    CommunityPool__ProtocolFeeTransferFailed,
    CommunityPool__UnsupportedTokenBehavior
} from "../../src/CommunityPool.sol";

/// @notice Reentrancy: treasury callbacks (with and without pool ownership), ERC-20 hook callbacks
/// (token as stranger and as explicitly authorized owner), cross-function paths into every
/// withdrawal function, and double-fee / duplicate-event proofs.
///
/// Security model asserted here: while a contribution is settling, NO other state-changing pool
/// function may execute — funding, withdrawals, or expiry release — regardless of the caller's
/// authority. A treasury that is also an owner keeps its withdrawal rights; it simply cannot
/// exercise them from inside the fee callback, so settlement and event ordering stay coherent.
contract ProtocolFeeReentrancyTest is FeeSecurityBase {
    bytes4 internal constant REENTRANT = bytes4(keccak256("ReentrancyGuardReentrantCall()"));

    OwnerTreasury internal ownerTreasury; // explicitly a co-owner AND the fee recipient
    CommunityPool internal ownedPool;

    function setUp() public {
        _baseSetUp(100);
        ownerTreasury = new OwnerTreasury();
        address[] memory cos = new address[](1);
        cos[0] = address(ownerTreasury);
        ownedPool = _newPool(owner, cos, address(config), MIN_USD, expiresAt);
        vm.startPrank(funder);
        wbtc.approve(address(ownedPool), type(uint256).max);
        paxg.approve(address(ownedPool), type(uint256).max);
        vm.stopPrank();
        _setRecipient(address(ownerTreasury));
        assertTrue(ownedPool.isOwner(address(ownerTreasury)), "treasury is an explicit co-owner in this suite");
    }

    function _selector(bytes memory revertData) internal pure returns (bytes4 s) {
        if (revertData.length < 4) return bytes4(0);
        assembly {
            s := mload(add(revertData, 32))
        }
    }

    // ================================================================ treasury == owner, cross-function

    function _runOwnerTreasuryCallback(OwnerTreasury.Action a, IERC20 t, uint256 amt) internal returns (uint256 net) {
        // Pre-load the pool so partial withdrawals have something to target.
        vm.prank(funder);
        ownedPool.fund{value: 2 ether}();
        vm.prank(funder);
        ownedPool.fundERC20(IERC20(address(wbtc)), 1e8);
        ownerTreasury.configure(a, false, t, amt);
        uint256 callbacksBefore = ownerTreasury.callbacks();
        uint256 failedBefore = ownerTreasury.actionFailed();
        uint256 ethBefore = address(ownedPool).balance;
        uint256 tokBefore = wbtc.balanceOf(address(ownedPool));
        uint256 treasuryEthBefore = address(ownerTreasury).balance;
        vm.recordLogs();
        vm.prank(funder);
        ownedPool.fund{value: 1 ether}();
        net = 0.99 ether;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, address(ownedPool), Funded.selector), 1, "exactly one Funded");
        assertEq(_countEvents(logs, address(ownedPool), Withdrawn.selector), 0, "no Withdrawn inside settlement");
        assertEq(
            _countEvents(logs, address(ownedPool), WithdrawnToken.selector), 0, "no WithdrawnToken inside settlement"
        );
        assertEq(ownerTreasury.callbacks() - callbacksBefore, 1);
        assertEq(ownerTreasury.actionSucceeded(), 0, "inner action must not execute during settlement");
        assertEq(ownerTreasury.actionFailed() - failedBefore, 1);
        assertEq(_selector(ownerTreasury.lastRevert()), REENTRANT, "blocked by the reentrancy guard");
        assertEq(
            ownerTreasury.poolBalanceSeenInCallback(),
            ethBefore + net,
            "fee already out, net already in, at callback time"
        );
        assertEq(address(ownedPool).balance, ethBefore + net, "pool holds net after settlement");
        assertEq(wbtc.balanceOf(address(ownedPool)), tokBefore, "tokens untouched");
        assertEq(address(ownerTreasury).balance - treasuryEthBefore, 0.01 ether, "exactly one fee received");
    }

    function testOwnerTreasury_CannotWithdrawPartialEthDuringFeeReceipt() public {
        _runOwnerTreasuryCallback(OwnerTreasury.Action.Withdraw, IERC20(address(0)), 0.5 ether);
        // Authority is intact outside the callback: the same owner-treasury withdraws afterwards.
        (bool ok,) =
            ownerTreasury.callPool(address(ownedPool), abi.encodeWithSelector(ownedPool.withdraw.selector, 0.5 ether));
        assertTrue(ok, "owner rights preserved outside settlement");
    }

    function testOwnerTreasury_CannotCheaperWithdrawDuringFeeReceipt() public {
        _runOwnerTreasuryCallback(OwnerTreasury.Action.CheaperWithdraw, IERC20(address(0)), 0);
    }

    function testOwnerTreasury_CannotWithdrawTokenDuringFeeReceipt() public {
        _runOwnerTreasuryCallback(OwnerTreasury.Action.WithdrawToken, IERC20(address(wbtc)), 0);
    }

    function testOwnerTreasury_CannotWithdrawTokenAmountDuringFeeReceipt() public {
        _runOwnerTreasuryCallback(OwnerTreasury.Action.WithdrawTokenAmount, IERC20(address(wbtc)), 1);
    }

    function testOwnerTreasury_CannotRecursivelyFundDuringFeeReceipt() public {
        _runOwnerTreasuryCallback(OwnerTreasury.Action.Fund, IERC20(address(0)), 0);
        _runOwnerTreasuryCallback(OwnerTreasury.Action.FundDirect, IERC20(address(0)), 0);
    }

    function testOwnerTreasury_CannotReleaseDuringFeeReceipt() public {
        // Not expired, so release would revert on expiry anyway; the guard rejects it first.
        _runOwnerTreasuryCallback(OwnerTreasury.Action.Release, IERC20(address(0)), 0);
    }

    function testOwnerTreasury_PropagatingFailureFailsClosed() public {
        vm.prank(funder);
        ownedPool.fund{value: 2 ether}();
        ownerTreasury.configure(OwnerTreasury.Action.Withdraw, true, IERC20(address(0)), 1);
        uint256 poolBefore = address(ownedPool).balance;
        uint256 tBefore = address(ownerTreasury).balance;
        vm.prank(funder);
        vm.expectRevert(CommunityPool__ProtocolFeeTransferFailed.selector);
        ownedPool.fund{value: 1 ether}();
        assertEq(address(ownedPool).balance, poolBefore);
        assertEq(address(ownerTreasury).balance, tBefore);
    }

    // ================================================================ treasury without ownership

    function testStrangerTreasury_EveryReentrantPathBlocked() public {
        OwnerTreasury stranger = new OwnerTreasury();
        _setRecipient(address(stranger));
        assertFalse(pool.isOwner(address(stranger)));
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        vm.prank(funder);
        pool.fundERC20(IERC20(address(wbtc)), 1e8);

        OwnerTreasury.Action[6] memory actions = [
            OwnerTreasury.Action.Withdraw,
            OwnerTreasury.Action.CheaperWithdraw,
            OwnerTreasury.Action.WithdrawToken,
            OwnerTreasury.Action.WithdrawTokenAmount,
            OwnerTreasury.Action.Fund,
            OwnerTreasury.Action.FundDirect
        ];
        for (uint256 i = 0; i < actions.length; i++) {
            stranger.configure(actions[i], false, IERC20(address(wbtc)), 1);
            uint256 poolBefore = address(pool).balance;
            uint256 tokBefore = wbtc.balanceOf(address(pool));
            uint256 tBefore = address(stranger).balance;
            vm.recordLogs();
            vm.prank(funder);
            pool.fund{value: 1 ether}();
            assertEq(
                _countEvents(vm.getRecordedLogs(), address(pool), Funded.selector), 1, "one Funded per contribution"
            );
            assertEq(stranger.actionSucceeded(), 0, "no unauthorized movement");
            assertEq(address(pool).balance - poolBefore, 0.99 ether);
            assertEq(wbtc.balanceOf(address(pool)), tokBefore);
            assertEq(address(stranger).balance - tBefore, 0.01 ether, "exactly one fee, no recursive fee loop");
        }
    }

    // ================================================================ ERC-20 hook callbacks

    function _callbackPool(bool tokenIsOwner) internal returns (CallbackERC20 tok, CommunityPool p) {
        tok = new CallbackERC20(18);
        vm.deal(address(tok), 10 ether);
        if (tokenIsOwner) {
            CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](2);
            tks[0] = CommunityPool.TokenConfig({
                token: address(wbtc), usdFeed: address(wbtcFeed), decimals: 8, maxPriceAge: ORACLE_MAX_AGE
            });
            tks[1] = CommunityPool.TokenConfig({
                token: address(tok), usdFeed: address(paxgFeed), decimals: 18, maxPriceAge: ORACLE_MAX_AGE
            });
            address[] memory cos = new address[](1);
            cos[0] = address(tok);
            vm.prank(owner);
            p = new CommunityPool(
                "CB", "d", MIN_USD, cos, expiresAt, address(ethFeed), ORACLE_MAX_AGE, tks, address(config)
            );
        } else {
            p = _newPoolWithExtraToken(owner, address(config), address(tok), address(paxgFeed), 18);
        }
        tok.mint(funder, 100e18);
        vm.startPrank(funder);
        tok.approve(address(p), type(uint256).max);
        wbtc.approve(address(p), type(uint256).max);
        vm.stopPrank();
        // Seed the pool with ETH and WBTC so cross-asset withdrawals have targets.
        vm.prank(funder);
        p.fund{value: 1 ether}();
        vm.prank(funder);
        p.fundERC20(IERC20(address(wbtc)), 1e8);
    }

    struct Snap {
        uint256 eth;
        uint256 wbtc;
        uint256 tok;
        uint256 treasury;
        uint256 hooks;
    }

    function _hookCall(CommunityPool p, CallbackERC20 tok, uint256 i)
        internal
        pure
        returns (bytes memory data, uint256 value)
    {
        if (i == 0) return (abi.encodeWithSelector(p.fundERC20.selector, tok, 1e18), 0);
        if (i == 1) return (abi.encodeWithSelector(p.fund.selector), 0.01 ether);
        if (i == 2) return (abi.encodeWithSelector(p.withdraw.selector, 0.1 ether), 0);
        if (i == 3) return (abi.encodeWithSelector(p.cheaperWithdraw.selector), 0);
        // withdrawToken targets WBTC (a different asset) so a cross-asset withdrawal would be visible.
        if (i == 4) return (abi.encodeWithSelector(p.withdrawToken.selector, IERC20(address(0))), 0);
        return (abi.encodeWithSelector(p.withdrawTokenAmount.selector, IERC20(address(0)), 1), 0);
    }

    function _snap(CommunityPool p, CallbackERC20 tok) internal view returns (Snap memory s) {
        s.eth = address(p).balance;
        s.wbtc = wbtc.balanceOf(address(p));
        s.tok = tok.balanceOf(address(p));
        s.treasury = tok.balanceOf(config.feeRecipient());
        s.hooks = tok.hookCalls();
    }

    function _runHookCase(CommunityPool p, CallbackERC20 tok, uint256 i, bool onFrom, bool tokenIsOwner) internal {
        (bytes memory data, uint256 value) = _hookCall(p, tok, i);
        if (i >= 4) {
            data = i == 4
                ? abi.encodeWithSelector(p.withdrawToken.selector, IERC20(address(wbtc)))
                : abi.encodeWithSelector(p.withdrawTokenAmount.selector, IERC20(address(wbtc)), 1);
        }
        tok.configureHook(address(p), data, value, onFrom, !onFrom, false);
        Snap memory before = _snap(p, tok);
        vm.recordLogs();
        vm.prank(funder);
        p.fundERC20(IERC20(address(tok)), 1e18);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, address(p), FundedERC20.selector), 1, "one FundedERC20");
        assertEq(_countEvents(logs, address(p), Funded.selector), 0, "no ETH Funded from a hook");
        assertEq(
            _countEvents(logs, address(p), Withdrawn.selector)
                + _countEvents(logs, address(p), WithdrawnToken.selector),
            0,
            "no withdrawal inside settlement"
        );
        Snap memory after_ = _snap(p, tok);
        assertGt(after_.hooks, before.hooks, "hook fired");
        assertEq(tok.hookSucceeded(), 0, "every reentrant call blocked");
        bytes4 sel = _selector(tok.lastRevert());
        if (tokenIsOwner || i < 2) assertEq(sel, REENTRANT, "blocked by guard");
        else assertTrue(sel == REENTRANT || sel == CommunityPool__NotOwner.selector, "blocked by guard or authority");
        assertEq(after_.eth, before.eth, "ETH untouched");
        assertEq(after_.wbtc, before.wbtc, "WBTC untouched");
        assertEq(after_.tok - before.tok, 0.99e18, "pool += net");
        assertEq(after_.treasury - before.treasury, 0.01e18, "treasury += fee, exactly once");
    }

    function _assertHookBlocked(CommunityPool p, CallbackERC20 tok, bool onFrom, bool tokenIsOwner) internal {
        for (uint256 i = 0; i < 6; i++) {
            _runHookCase(p, tok, i, onFrom, tokenIsOwner);
        }
    }

    function testTokenHooks_StrangerToken_TransferFromHook() public {
        (CallbackERC20 tok, CommunityPool p) = _callbackPool(false);
        _assertHookBlocked(p, tok, true, false);
    }

    function testTokenHooks_StrangerToken_TransferHook() public {
        (CallbackERC20 tok, CommunityPool p) = _callbackPool(false);
        _assertHookBlocked(p, tok, false, false);
    }

    function testTokenHooks_OwnerToken_TransferFromHook() public {
        (CallbackERC20 tok, CommunityPool p) = _callbackPool(true);
        assertTrue(p.isOwner(address(tok)));
        _assertHookBlocked(p, tok, true, true);
    }

    function testTokenHooks_OwnerToken_TransferHook() public {
        (CallbackERC20 tok, CommunityPool p) = _callbackPool(true);
        _assertHookBlocked(p, tok, false, true);
    }

    function testTokenHooks_PropagatingHookFailsClosed() public {
        (CallbackERC20 tok, CommunityPool p) = _callbackPool(true);
        tok.configureHook(address(p), abi.encodeWithSelector(p.cheaperWithdraw.selector), 0, true, false, true);
        uint256 ethBefore = address(p).balance;
        uint256 fBefore = tok.balanceOf(funder);
        vm.prank(funder);
        vm.expectRevert();
        p.fundERC20(IERC20(address(tok)), 1e18);
        assertEq(address(p).balance, ethBefore);
        assertEq(tok.balanceOf(funder), fBefore, "no partial pull survives");
        assertEq(tok.balanceOf(address(p)), 0);
        assertEq(tok.balanceOf(treasuryA), 0);
    }

    // ================================================================ double fee / duplicate events

    function testNoDoubleFee_AcrossAllIngressPathsAndCallbacks() public {
        OwnerTreasury t = new OwnerTreasury();
        t.configure(OwnerTreasury.Action.Fund, false, IERC20(address(0)), 0); // tries to re-fund with its fee
        _setRecipient(address(t));
        uint256 tBefore = address(t).balance;
        vm.recordLogs();
        vm.startPrank(funder);
        pool.fund{value: 1 ether}();
        (bool ok1,) = address(pool).call{value: 1 ether}("");
        (bool ok2,) = address(pool).call{value: 1 ether}(hex"01");
        vm.stopPrank();
        assertTrue(ok1 && ok2);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, address(pool), Funded.selector), 3, "three deliberate contributions, three events");
        assertEq(address(t).balance - tBefore, 0.03 ether, "exactly one fee per contribution");
        assertEq(t.actionSucceeded(), 0, "callback re-funding never succeeded");
        assertEq(address(pool).balance, 3 * 0.99 ether);
    }
}
