// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {FeeSecurityBase, CommunityPool, IERC20, MockMintableERC20} from "./FeeSecurityBase.sol";
import {FeeOnTransferModesERC20, RebasingERC20, NoReturnERC20, MalformedERC20} from "./mocks/AdversarialMocks.sol";
import {MockRevertingERC20} from "../MockRevertingERC20.sol";
import {MockFalseReturningERC20} from "../mocks/FeeMocks.sol";
import {CommunityPool__UnsupportedTokenBehavior} from "../../src/CommunityPool.sol";

/// @notice Adversarial ERC-20 matrix against exact-transfer accounting: standard, no-return,
/// false-return, reverting, malformed return data, fee-on-transfer (transferFrom / transfer /
/// both), rebasing / balance manipulation, and balanceOf that reverts, lies, or drifts.
///
/// Trust statement: exact-transfer enforcement necessarily relies on the token's own observable
/// `balanceOf`. CommunityPool cannot make a malicious token truthful; it can only fail closed
/// whenever the balances it observes do not reconcile with the amounts it requested.
contract ProtocolFeeAdversarialERC20Test is FeeSecurityBase {
    function setUp() public {
        _baseSetUp(100);
    }

    function _poolFor(address tok, uint8 dec) internal returns (CommunityPool p) {
        p = _newPoolWithExtraToken(owner, address(config), tok, address(paxgFeed), dec);
    }

    function _assertNoPartialState(CommunityPool p, address tok, uint256 poolBefore, uint256 tBefore) internal view {
        assertEq(IERC20(tok).balanceOf(address(p)), poolBefore, "no partial contribution");
        assertEq(IERC20(tok).balanceOf(treasuryA), tBefore, "no partial fee");
    }

    // ------------------------------------------------------------ baseline behaviors

    function testStandardTrueReturningTokenSucceeds() public {
        vm.prank(funder);
        pool.fundERC20(IERC20(address(paxg)), 1e18);
        assertEq(paxg.balanceOf(address(pool)), 0.99e18);
        assertEq(paxg.balanceOf(treasuryA), 0.01e18);
    }

    function testNoReturnTokenSucceeds() public {
        NoReturnERC20 usdt = new NoReturnERC20();
        CommunityPool p = _poolFor(address(usdt), 6);
        usdt.mint(funder, 1_000e6);
        vm.startPrank(funder);
        usdt.approve(address(p), 100e6);
        p.fundERC20(IERC20(address(usdt)), 100e6);
        vm.stopPrank();
        assertEq(usdt.balanceOf(address(p)), 99e6);
        assertEq(usdt.balanceOf(treasuryA), 1e6);
        assertEq(usdt.balanceOf(funder), 900e6, "debited exactly gross");
    }

    function testFalseReturningTokenFailsClosed() public {
        MockFalseReturningERC20 f = new MockFalseReturningERC20("F", "F", 18);
        CommunityPool p = _poolFor(address(f), 18);
        f.mint(funder, 10e18);
        f.setReturnFalseOnTransfer(true);
        vm.startPrank(funder);
        f.approve(address(p), 1e18);
        vm.expectRevert();
        p.fundERC20(IERC20(address(f)), 1e18);
        vm.stopPrank();
        _assertNoPartialState(p, address(f), 0, 0);
        assertEq(f.balanceOf(funder), 10e18);
    }

    function testRevertingTokenFailsClosed() public {
        MockRevertingERC20 r = new MockRevertingERC20("R", "R", 18);
        CommunityPool p = _poolFor(address(r), 18);
        r.mint(funder, 10e18);
        r.setRevertOnTransfer(true);
        vm.startPrank(funder);
        r.approve(address(p), 1e18);
        vm.expectRevert();
        p.fundERC20(IERC20(address(r)), 1e18);
        vm.stopPrank();
        _assertNoPartialState(p, address(r), 0, 0);
    }

    function testMalformedReturnDataFailsClosed() public {
        MalformedERC20 m = new MalformedERC20();
        CommunityPool p = _poolFor(address(m), 18);
        m.mint(funder, 10e18);
        m.arm(true, false, 0, false);
        vm.startPrank(funder);
        m.approve(address(p), 1e18);
        vm.expectRevert(); // SafeERC20: return word 2 is not `true`
        p.fundERC20(IERC20(address(m)), 1e18);
        vm.stopPrank();
        assertEq(m.balanceOf(address(p)), 0);
        assertEq(m.balanceOf(funder), 10e18);
    }

    // ------------------------------------------------------------ fee-on-transfer variants

    function _fotCase(bool onFrom, bool onTransfer, uint256 protocolBps, bool expectRevert) internal {
        FeeOnTransferModesERC20 t = new FeeOnTransferModesERC20(18);
        t.configure(50, onFrom, onTransfer);
        CommunityPool p = _poolFor(address(t), 18);
        _setFee(protocolBps);
        t.mint(funder, 10e18);
        vm.startPrank(funder);
        t.approve(address(p), 1e18);
        if (expectRevert) {
            vm.expectRevert(CommunityPool__UnsupportedTokenBehavior.selector);
            p.fundERC20(IERC20(address(t)), 1e18);
            vm.stopPrank();
            _assertNoPartialState(p, address(t), 0, 0);
            assertEq(t.balanceOf(funder), 10e18, "funder untouched");
        } else {
            p.fundERC20(IERC20(address(t)), 1e18);
            vm.stopPrank();
            assertEq(t.balanceOf(address(p)), 1e18 - _fee(1e18, protocolBps));
        }
    }

    function testFoT_OnTransferFrom_Rejected() public {
        _fotCase(true, false, 100, true);
    }

    function testFoT_OnTransfer_Rejected() public {
        _fotCase(false, true, 100, true);
    }

    function testFoT_OnBoth_Rejected() public {
        _fotCase(true, true, 100, true);
    }

    function testFoT_OnTransferFrom_RejectedEvenAtZeroProtocolFee() public {
        _fotCase(true, false, 0, true);
    }

    function testFoT_OnTransferOnly_AcceptedAtZeroProtocolFee() public {
        // No outbound transfer happens at 0 bps, so a token that only taxes `transfer` cannot
        // violate exact accounting on the pull. Documented: behavior depends on the path exercised.
        _fotCase(false, true, 0, false);
    }

    // ------------------------------------------------------------ rebasing / balance manipulation

    function testRebasingTokenRebaseInsideTransferRejected() public {
        RebasingERC20 rb = new RebasingERC20();
        CommunityPool p = _poolFor(address(rb), 18);
        rb.mint(funder, 10e18);
        rb.setRebaseInsideTransfer(true, 12_000); // balances inflate 20% mid-pull
        vm.startPrank(funder);
        rb.approve(address(p), 1e18);
        vm.expectRevert(CommunityPool__UnsupportedTokenBehavior.selector);
        p.fundERC20(IERC20(address(rb)), 1e18);
        vm.stopPrank();
        assertEq(rb.balanceOf(address(p)), 0);
    }

    function testRebasingTokenNegativeRebaseInsideTransferRejected() public {
        RebasingERC20 rb = new RebasingERC20();
        CommunityPool p = _poolFor(address(rb), 18);
        rb.mint(funder, 10e18);
        rb.setRebaseInsideTransfer(true, 8_000);
        vm.startPrank(funder);
        rb.approve(address(p), 1e18);
        vm.expectRevert(CommunityPool__UnsupportedTokenBehavior.selector);
        p.fundERC20(IERC20(address(rb)), 1e18);
        vm.stopPrank();
    }

    function testRebasingTokenIsAcceptedOnlyWhileItBehavesExactly() public {
        // A rebasing token that does not rebase during the contribution is indistinguishable from
        // a standard token at that moment; later rebases change pool balances outside any
        // contribution. That is the documented reason such assets are unsupported policy-wise.
        RebasingERC20 rb = new RebasingERC20();
        CommunityPool p = _poolFor(address(rb), 18);
        rb.mint(funder, 10e18);
        vm.startPrank(funder);
        rb.approve(address(p), 1e18);
        p.fundERC20(IERC20(address(rb)), 1e18);
        vm.stopPrank();
        assertEq(rb.balanceOf(address(p)), 0.99e18);
        rb.setMultiplier(5_000);
        assertEq(rb.balanceOf(address(p)), 0.495e18, "balance drifts outside contributions (unsupported asset class)");
    }

    // ------------------------------------------------------------ balanceOf adversarial

    function testBalanceOfRevertsFailsClosed() public {
        MalformedERC20 m = new MalformedERC20();
        CommunityPool p = _poolFor(address(m), 18);
        m.mint(funder, 10e18);
        m.arm(false, true, 0, false);
        vm.startPrank(funder);
        m.approve(address(p), 1e18);
        vm.expectRevert();
        p.fundERC20(IERC20(address(m)), 1e18);
        vm.stopPrank();
    }

    function testBalanceOfConstantLieFailsClosed() public {
        MalformedERC20 m = new MalformedERC20();
        CommunityPool p = _poolFor(address(m), 18);
        m.mint(funder, 10e18);
        m.arm(false, false, 123e18, false); // every read returns the same fake number => delta 0 != gross
        vm.startPrank(funder);
        m.approve(address(p), 1e18);
        vm.expectRevert(CommunityPool__UnsupportedTokenBehavior.selector);
        p.fundERC20(IERC20(address(m)), 1e18);
        vm.stopPrank();
    }

    function testBalanceOfDriftingAcrossReadsFailsClosed() public {
        MalformedERC20 m = new MalformedERC20();
        CommunityPool p = _poolFor(address(m), 18);
        m.mint(funder, 10e18);
        m.arm(false, false, 0, true); // small gas-dependent jitter on every read
        vm.startPrank(funder);
        m.approve(address(p), 1e18);
        // Either the pull delta or the fee delta will not reconcile exactly.
        vm.expectRevert();
        p.fundERC20(IERC20(address(m)), 1e18);
        vm.stopPrank();
    }

    // ------------------------------------------------------------ decimals sanity on real-shaped assets

    function testEightAndEighteenDecimalAssetsReconcileExactly() public {
        vm.startPrank(funder);
        pool.fundERC20(IERC20(address(wbtc)), 12_345_678); // 0.12345678 WBTC
        pool.fundERC20(IERC20(address(paxg)), 3_333_333_333_333_333_333); // 3.33.. PAXG
        vm.stopPrank();
        assertEq(wbtc.balanceOf(treasuryA), 123_456);
        assertEq(wbtc.balanceOf(address(pool)), 12_345_678 - 123_456);
        assertEq(paxg.balanceOf(treasuryA), 33_333_333_333_333_333);
        assertEq(paxg.balanceOf(address(pool)), 3_333_333_333_333_333_333 - 33_333_333_333_333_333);
    }
}
