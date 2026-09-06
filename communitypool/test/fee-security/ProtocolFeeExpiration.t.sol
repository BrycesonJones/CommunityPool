// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {FeeSecurityBase, CommunityPool, IERC20, Vm} from "./FeeSecurityBase.sol";
import {GasGriefingTreasury, ExpensiveProtocolConfig, OwnerTreasury} from "./mocks/AdversarialMocks.sol";
import {MockMalformedProtocolConfig, MockRejectingTreasury} from "../mocks/FeeMocks.sol";
import {
    CommunityPool__NotOwner,
    CommunityPool__NotYetExpiredForRelease,
    CommunityPool__PoolExpired,
    CommunityPool__ProtocolFeeExceedsMaximum,
    CommunityPool__ProtocolFeeTransferFailed,
    CommunityPool__WithdrawDisabledAfterExpiry
} from "../../src/CommunityPool.sol";
import {ProtocolConfig__FeeExceedsMaximum} from "../../src/ProtocolConfig.sol";

/// @notice Expiration boundaries, withdrawal and expiry-release accounting after fees, dynamic
/// fee/treasury/admin sequences, zero- and tiny-fee semantics, treasury gas griefing, malicious
/// admin limits, and price-feed edge behavior.
contract ProtocolFeeExpirationTest is FeeSecurityBase {
    function setUp() public {
        _baseSetUp(100);
    }

    // ------------------------------------------------------------ expiration boundaries

    function _assertRejectedEverywhere() internal {
        uint256 poolEth = address(pool).balance;
        uint256 poolTok = wbtc.balanceOf(address(pool));
        uint256 tEth = treasuryA.balance;
        uint256 tTok = wbtc.balanceOf(treasuryA);
        vm.recordLogs();
        vm.startPrank(funder);
        vm.expectRevert(CommunityPool__PoolExpired.selector);
        pool.fund{value: 1 ether}();
        (bool okR,) = address(pool).call{value: 1 ether}("");
        (bool okF,) = address(pool).call{value: 1 ether}(hex"aa");
        vm.expectRevert(CommunityPool__PoolExpired.selector);
        pool.fundERC20(IERC20(address(wbtc)), 1e8);
        vm.stopPrank();
        assertFalse(okR);
        assertFalse(okF);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(
            _countEvents(logs, address(pool), Funded.selector)
                + _countEvents(logs, address(pool), FundedERC20.selector),
            0
        );
        assertEq(address(pool).balance, poolEth);
        assertEq(wbtc.balanceOf(address(pool)), poolTok);
        assertEq(treasuryA.balance, tEth);
        assertEq(wbtc.balanceOf(treasuryA), tTok);
    }

    function testFundingAllowedThroughExpiresAtAndRejectedAfter() public {
        vm.warp(uint256(expiresAt) - 1);
        _fundEthExpect(pool, funder, 1 ether, 100, treasuryA);
        vm.warp(uint256(expiresAt));
        _fundEthExpect(pool, funder, 1 ether, 100, treasuryA);
        vm.prank(funder);
        pool.fundERC20(IERC20(address(wbtc)), 1e8);
        // Release is not yet available at exactly expiresAt.
        vm.expectRevert(CommunityPool__NotYetExpiredForRelease.selector);
        pool.releaseExpiredFundsToDeployer();
        vm.warp(uint256(expiresAt) + 1);
        _assertRejectedEverywhere();
    }

    // ------------------------------------------------------------ withdrawal accounting after fees

    function testOwnersWithdrawOnlyNetAndNoFeeIsEverRecoverable() public {
        _fundEthExpect(pool, funder, 1 ether, 100, treasuryA);
        vm.prank(funder);
        pool.fundERC20(IERC20(address(wbtc)), 1e8);
        assertEq(address(pool).balance, 0.99 ether);
        assertEq(wbtc.balanceOf(address(pool)), 0.99e8);

        vm.startPrank(owner);
        pool.withdraw(0.4 ether);
        vm.expectRevert(); // exceeds remaining net: paid fee is not recoverable
        pool.withdraw(0.6 ether);
        pool.cheaperWithdraw();
        pool.withdrawTokenAmount(IERC20(address(wbtc)), 0.5e8);
        vm.expectRevert();
        pool.withdrawTokenAmount(IERC20(address(wbtc)), 0.5e8);
        pool.withdrawToken(IERC20(address(wbtc)));
        vm.stopPrank();

        assertEq(address(pool).balance, 0);
        assertEq(wbtc.balanceOf(address(pool)), 0);
        assertEq(owner.balance, 1_000 ether + 0.99 ether, "sum of withdrawals == net");
        assertEq(wbtc.balanceOf(owner), 1_000e8 + 0.99e8);
        assertEq(treasuryA.balance, 0.01 ether, "fee untouched by withdrawals");
        assertEq(wbtc.balanceOf(treasuryA), 0.01e8);
    }

    function testExpiryReleaseReleasesOnlyNet() public {
        _fundEthExpect(pool, funder, 2 ether, 100, treasuryA);
        vm.prank(funder);
        pool.fundERC20(IERC20(address(paxg)), 10e18);
        vm.warp(uint256(expiresAt) + 1);
        vm.startPrank(owner);
        vm.expectRevert(CommunityPool__WithdrawDisabledAfterExpiry.selector);
        pool.cheaperWithdraw();
        vm.stopPrank();
        uint256 ownerEth = owner.balance;
        uint256 ownerPaxg = paxg.balanceOf(owner);
        vm.prank(attacker); // anyone may trigger release
        pool.releaseExpiredFundsToDeployer();
        assertEq(owner.balance - ownerEth, 1.98 ether, "only net ETH released");
        assertEq(paxg.balanceOf(owner) - ownerPaxg, 9.9e18, "only net PAXG released");
        assertEq(treasuryA.balance, 0.02 ether);
        assertEq(paxg.balanceOf(treasuryA), 0.1e18);
        // Idempotent: nothing more to release, no second fee movement.
        pool.releaseExpiredFundsToDeployer();
        assertEq(treasuryA.balance, 0.02 ether);
    }

    // ------------------------------------------------------------ dynamic sequences

    function testDynamicFeeAndTreasurySequenceReconciles() public {
        uint256[4] memory rates = [uint256(100), 300, 0, 75];
        address[4] memory recips = [treasuryA, treasuryB, treasuryC, treasuryA];
        uint256 expectedPool;
        uint256[3] memory expectedT; // A, B, C
        for (uint256 i = 0; i < 4; i++) {
            _setFee(rates[i]);
            _setRecipient(recips[i]);
            uint256 fee = _fee(1 ether, rates[i]);
            _fundEthExpect(pool, funder, 1 ether, rates[i], recips[i]);
            expectedPool += 1 ether - fee;
            if (recips[i] == treasuryA) expectedT[0] += fee;
            if (recips[i] == treasuryB) expectedT[1] += fee;
            if (recips[i] == treasuryC) expectedT[2] += fee;
        }
        assertEq(address(pool).balance, expectedPool);
        assertEq(treasuryA.balance, expectedT[0]); // 0.01 + 0.0075
        assertEq(treasuryB.balance, expectedT[1]); // 0.03
        assertEq(treasuryC.balance, expectedT[2]); // 0
        assertEq(
            treasuryA.balance + treasuryB.balance + treasuryC.balance + address(pool).balance,
            4 ether,
            "gross conserved"
        );
        // Historical fees never move when configuration changes afterwards.
        _setRecipient(treasuryC);
        _setFee(300);
        assertEq(treasuryA.balance, expectedT[0]);
        assertEq(treasuryB.balance, expectedT[1]);
    }

    function testAdminRotationInterleavedWithFunding() public {
        _fundEthExpect(pool, funder, 1 ether, 100, treasuryA);
        vm.prank(admin);
        config.transferAdmin(pendingAdmin);
        _fundEthExpect(pool, funder, 1 ether, 100, treasuryA); // A still active, config unchanged
        vm.prank(admin);
        config.setProtocolFeeBps(200);
        _fundEthExpect(pool, funder, 1 ether, 200, treasuryA);
        vm.prank(pendingAdmin);
        config.acceptAdmin();
        _fundEthExpect(pool, funder, 1 ether, 200, treasuryA); // rotation alone changes nothing economic
        assertEq(config.feeRecipient(), treasuryA, "rotation never changes the treasury");
        assertFalse(pool.isOwner(admin));
        assertFalse(pool.isOwner(pendingAdmin));
        assertTrue(pool.isOwner(owner));
        assertEq(address(pool).balance, 0.99 ether * 2 + 0.98 ether * 2);
    }

    // ------------------------------------------------------------ zero / tiny fee semantics

    function testZeroFeeNeverContactsTreasury() public {
        _setFee(0);
        MockRejectingTreasury bad = new MockRejectingTreasury();
        _setRecipient(address(bad));
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(pool));
        emit Funded(funder, address(0), 1 ether, 0, 1 ether);
        pool.fund{value: 1 ether}();
        assertEq(address(pool).balance, 1 ether);
        // Zero recipient with zero fee through a malformed config: also fine, nothing to validate.
        MockMalformedProtocolConfig m = new MockMalformedProtocolConfig(0, address(0));
        address[] memory cos = new address[](0);
        CommunityPool p = _newPool(owner, cos, address(m), MIN_USD, expiresAt);
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(address(p).balance, 1 ether);
    }

    function testTinyFeeRoundsToZeroWithRejectingTreasury() public {
        _setFee(1); // 1 bps: fee floors to 0 for gross < 10_000 raw units
        _setRecipient(address(new MockRejectingTreasury()));
        vm.prank(funder);
        vm.expectEmit(true, true, true, true, address(pool));
        emit FundedERC20(address(wbtc), funder, address(0), 9_999, 0, 9_999);
        pool.fundERC20(IERC20(address(wbtc)), 9_999);
        assertEq(wbtc.balanceOf(address(pool)), 9_999, "gross retained, treasury never called");
    }

    // ------------------------------------------------------------ treasury gas griefing

    function testGasGriefingTreasury_SucceedsAtACostOrFailsClosed() public {
        GasGriefingTreasury g = new GasGriefingTreasury();
        _setRecipient(address(g));
        g.configure(2_000, false);
        uint256 gasBefore = gasleft();
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        uint256 used = gasBefore - gasleft();
        assertGt(used, 200_000, "griefing treasury inflates the funder's gas cost");
        assertEq(address(g).balance, 0.01 ether);

        g.configure(2_000, true);
        vm.prank(funder);
        vm.expectRevert(CommunityPool__ProtocolFeeTransferFailed.selector);
        pool.fund{value: 1 ether}();

        // Insufficient gas for the treasury's work => the call fails => contribution fails closed.
        g.configure(50_000, false);
        vm.prank(funder);
        vm.expectRevert();
        pool.fund{value: 1 ether, gas: 300_000}();
        assertEq(address(pool).balance, 0.99 ether, "only the first contribution settled");

        // Operational recovery: the admin changes the recipient; no pool redeploy.
        _setRecipient(treasuryA);
        _fundEthExpect(pool, funder, 1 ether, 100, treasuryA);
    }

    function testExpensiveConfigOnlyRaisesCost() public {
        ExpensiveProtocolConfig e = new ExpensiveProtocolConfig(100, treasuryA, 1_000);
        address[] memory cos = new address[](0);
        CommunityPool p = _newPool(owner, cos, address(e), MIN_USD, expiresAt);
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(address(p).balance, 0.99 ether);
        assertEq(treasuryA.balance, 0.01 ether);
    }

    // ------------------------------------------------------------ malicious admin limits

    function testCompromisedAdminCanOnlyTuneWithinPolicy() public {
        vm.startPrank(admin);
        config.setProtocolFeeBps(0);
        config.setProtocolFeeBps(300);
        config.setFeeRecipient(attacker);
        config.transferAdmin(attacker);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig__FeeExceedsMaximum.selector, 301, 300));
        config.setProtocolFeeBps(301);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig__FeeExceedsMaximum.selector, type(uint256).max, 300));
        config.setProtocolFeeBps(type(uint256).max);
        vm.stopPrank();
        // The strongest admin outcome is a 3% fee to an attacker-chosen recipient on FUTURE contributions.
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        assertEq(attacker.balance, 1_000 ether + 0.03 ether);
        assertEq(address(pool).balance, 0.97 ether);
        // Nothing beyond that: no pool assets, no ownership, no pool parameters.
        vm.startPrank(admin);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        pool.cheaperWithdraw();
        vm.expectRevert(CommunityPool__NotOwner.selector);
        pool.withdrawToken(IERC20(address(wbtc)));
        vm.stopPrank();
        assertFalse(pool.isOwner(admin));
        assertEq(pool.expiresAt(), expiresAt);
        assertEq(pool.minimumUsd(), MIN_USD);
        assertEq(pool.getWhitelistedTokens().length, 2);
    }

    function testMalformedConfigHugeFeeFailsClosedWithoutEvent() public {
        MockMalformedProtocolConfig m = new MockMalformedProtocolConfig(type(uint256).max, treasuryA);
        address[] memory cos = new address[](0);
        CommunityPool p = _newPool(owner, cos, address(m), MIN_USD, expiresAt);
        vm.recordLogs();
        vm.prank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(CommunityPool__ProtocolFeeExceedsMaximum.selector, type(uint256).max, 300)
        );
        p.fund{value: 1 ether}();
        m.set(10_000, treasuryA);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(CommunityPool__ProtocolFeeExceedsMaximum.selector, 10_000, 300));
        p.fundERC20(IERC20(address(wbtc)), 1e8);
        assertEq(_countEvents(vm.getRecordedLogs(), address(p), Funded.selector), 0);
        assertEq(treasuryA.balance, 0);
        assertEq(address(p).balance, 0);
    }

    // ------------------------------------------------------------ price feed edge behavior (pre-existing V1 logic)

    function testZeroOrNegativePriceFailsClosedWithoutPartialState() public {
        ethFeed.updateAnswer(0);
        vm.prank(funder);
        vm.expectRevert();
        pool.fund{value: 1 ether}();
        ethFeed.updateAnswer(-1);
        vm.prank(funder);
        vm.expectRevert();
        pool.fund{value: 1 ether}();
        wbtcFeed.updateAnswer(0);
        vm.prank(funder);
        vm.expectRevert();
        pool.fundERC20(IERC20(address(wbtc)), 1e8);
        assertEq(address(pool).balance, 0);
        assertEq(treasuryA.balance, 0);
        assertEq(wbtc.balanceOf(address(pool)), 0);
    }

    function testExtremePriceOverflowsToRevertNotMisprice() public {
        ethFeed.updateAnswer(type(int256).max / 1e10);
        vm.prank(funder);
        vm.expectRevert(); // ethPrice * amount overflows: fails closed rather than accepting a bad conversion
        pool.fund{value: 100 ether}();
    }

    function testStaleFeedIsNotDetected_DocumentedPreExistingBehavior() public {
        // PriceConverter checks answer > 0 only; updatedAt/round completeness are not validated.
        // This predates Phase 2 (identical in V1) and affects only the USD minimum gate, never the
        // fee split. Recorded as a pre-existing observation, not a Phase 2.5 regression.
        vm.warp(block.timestamp + 10 days);
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        assertEq(address(pool).balance, 0.99 ether);
    }
}
