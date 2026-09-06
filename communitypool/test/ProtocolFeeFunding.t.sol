// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test, Vm} from "forge-std/Test.sol";
import {
    CommunityPool,
    CommunityPool__BelowMinimumUsd,
    CommunityPool__InvalidFeeRecipient,
    CommunityPool__NotOwner,
    CommunityPool__ProtocolFeeExceedsMaximum,
    CommunityPool__ProtocolFeeTransferFailed,
    CommunityPool__UnsupportedTokenBehavior
} from "../src/CommunityPool.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {ProtocolConstants} from "../src/ProtocolConstants.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockV3Aggregator} from "./pricefeeds/V3Aggregator.sol";
import {MockMintableERC20} from "./MockMintableERC20.sol";
import {MockFeeOnTransferERC20} from "./MockFeeOnTransferERC20.sol";
import {MockRevertingERC20} from "./MockRevertingERC20.sol";
import {
    MockAcceptingTreasury,
    MockFalseReturningERC20,
    MockMalformedProtocolConfig,
    MockReentrantTreasury,
    MockRejectingTreasury
} from "./mocks/FeeMocks.sol";

/// @notice Phase 2.3–2.4 correctness/regression coverage for protocol-fee collection on the V2
/// candidate: gross/fee/net accounting, floor rounding, gross-based minimums, dynamic config,
/// receive/fallback parity, treasury failure, reentrancy, exact-transfer ERC-20 hardening, and
/// the unchanged authority boundary.
contract ProtocolFeeFundingTest is Test {
    event Funded(
        address indexed funder, address indexed feeRecipient, uint256 grossAmount, uint256 feeAmount, uint256 netAmount
    );
    event FundedERC20(
        address indexed token,
        address indexed funder,
        address indexed feeRecipient,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount
    );

    uint256 internal constant BPS = 10_000;
    uint256 internal constant ETH_USD = 2000e8; // $2,000, 8-dec feed
    uint256 internal constant MIN_USD = 5e18; // $5

    address internal protocolAdmin = makeAddr("protocolAdmin");
    address internal treasuryA = makeAddr("treasuryA");
    address internal treasuryB = makeAddr("treasuryB");
    address internal poolDeployer = makeAddr("poolDeployer");
    address internal funder = makeAddr("funder");

    ProtocolConfig internal config;
    MockV3Aggregator internal ethFeed;
    MockV3Aggregator internal wbtcFeed;
    MockV3Aggregator internal paxgFeed;
    MockMintableERC20 internal wbtc; // 8 decimals
    MockMintableERC20 internal paxg; // 18 decimals
    uint64 internal expiresAt;
    CommunityPool internal pool;

    function setUp() public {
        config = new ProtocolConfig(protocolAdmin, treasuryA, 100);
        ethFeed = new MockV3Aggregator(8, int256(ETH_USD));
        wbtcFeed = new MockV3Aggregator(8, int256(60_000e8));
        paxgFeed = new MockV3Aggregator(8, int256(2_000e8));
        wbtc = new MockMintableERC20("Wrapped BTC", "WBTC", 8);
        paxg = new MockMintableERC20("PAX Gold", "PAXG", 18);
        expiresAt = uint64(block.timestamp + 30 days);
        pool = _deployPool(address(config));

        vm.deal(funder, 100 ether);
        wbtc.mint(funder, 10e8);
        paxg.mint(funder, 100e18);
        vm.startPrank(funder);
        wbtc.approve(address(pool), type(uint256).max);
        paxg.approve(address(pool), type(uint256).max);
        vm.stopPrank();
    }

    function _tokenConfigs(address extraToken, address extraFeed, uint8 extraDec)
        internal
        view
        returns (CommunityPool.TokenConfig[] memory tks)
    {
        uint256 n = extraToken == address(0) ? 2 : 3;
        tks = new CommunityPool.TokenConfig[](n);
        tks[0] = CommunityPool.TokenConfig({token: address(wbtc), usdFeed: address(wbtcFeed), decimals: 8});
        tks[1] = CommunityPool.TokenConfig({token: address(paxg), usdFeed: address(paxgFeed), decimals: 18});
        if (n == 3) tks[2] = CommunityPool.TokenConfig({token: extraToken, usdFeed: extraFeed, decimals: extraDec});
    }

    function _deployPool(address cfg) internal returns (CommunityPool) {
        return _deployPoolWithToken(cfg, address(0), address(0), 0);
    }

    function _deployPoolWithToken(address cfg, address tok, address feed, uint8 dec) internal returns (CommunityPool) {
        address[] memory cos = new address[](0);
        vm.prank(poolDeployer);
        return
            new CommunityPool(
                "Fee", "desc", MIN_USD, cos, expiresAt, address(ethFeed), _tokenConfigs(tok, feed, dec), cfg
            );
    }

    function _setFee(uint256 bps) internal {
        vm.prank(protocolAdmin);
        config.setProtocolFeeBps(bps);
    }

    function _setRecipient(address r) internal {
        vm.prank(protocolAdmin);
        config.setFeeRecipient(r);
    }

    function _fee(uint256 gross, uint256 bps) internal pure returns (uint256) {
        return (gross * bps) / BPS;
    }

    /// @dev Full accounting assertion for one ETH contribution.
    function _fundEthAndAssert(uint256 gross, uint256 bps, address recipient) internal {
        uint256 poolBefore = address(pool).balance;
        uint256 recipBefore = recipient.balance;
        uint256 funderBefore = funder.balance;
        uint256 expectedFee = _fee(gross, bps);
        uint256 expectedNet = gross - expectedFee;
        address eventRecipient = expectedFee == 0 ? address(0) : recipient;

        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(pool));
        emit Funded(funder, eventRecipient, gross, expectedFee, expectedNet);
        pool.fund{value: gross}();

        assertEq(expectedFee + expectedNet, gross, "gross == fee + net");
        assertLe(expectedFee, gross, "fee <= gross");
        assertEq(address(pool).balance - poolBefore, expectedNet, "pool delta == net");
        assertEq(recipient.balance - recipBefore, expectedFee, "treasury delta == fee");
        assertEq(funderBefore - funder.balance, gross, "funder debited exactly gross");
    }

    /// @dev Full accounting assertion for one ERC-20 contribution.
    function _fundErc20AndAssert(MockMintableERC20 token, uint256 gross, uint256 bps, address recipient) internal {
        uint256 poolBefore = token.balanceOf(address(pool));
        uint256 recipBefore = token.balanceOf(recipient);
        uint256 funderBefore = token.balanceOf(funder);
        uint256 expectedFee = _fee(gross, bps);
        uint256 expectedNet = gross - expectedFee;
        address eventRecipient = expectedFee == 0 ? address(0) : recipient;

        vm.prank(funder);
        vm.expectEmit(true, true, true, true, address(pool));
        emit FundedERC20(address(token), funder, eventRecipient, gross, expectedFee, expectedNet);
        pool.fundERC20(IERC20(address(token)), gross);

        assertEq(expectedFee + expectedNet, gross, "gross == fee + net");
        assertLe(expectedFee, gross, "fee <= gross");
        assertEq(token.balanceOf(address(pool)) - poolBefore, expectedNet, "pool delta == net");
        assertEq(token.balanceOf(recipient) - recipBefore, expectedFee, "treasury delta == fee");
        assertEq(funderBefore - token.balanceOf(funder), gross, "funder debited exactly gross");
    }

    // ================================================================ ETH: rates

    function testEth_ZeroBps_AllToPool() public {
        _setFee(0);
        _fundEthAndAssert(1 ether, 0, treasuryA);
    }

    function testEth_OnePercent_Split() public {
        _fundEthAndAssert(1 ether, 100, treasuryA);
        assertEq(treasuryA.balance, 0.01 ether);
        assertEq(address(pool).balance, 0.99 ether);
    }

    function testEth_ThreePercent_Split() public {
        _setFee(300);
        _fundEthAndAssert(1 ether, 300, treasuryA);
        assertEq(treasuryA.balance, 0.03 ether);
        assertEq(address(pool).balance, 0.97 ether);
    }

    function testEth_FloorRounding() public {
        // Feed: $2,000/ETH, min $5 => 0.0025 ETH minimum. Use amounts with fractional fee results.
        _setFee(300);
        uint256 gross = 0.0025 ether + 1; // 2_500_000_000_000_001 wei; 3% = 75_000_000_000_000.03 -> floors
        uint256 expectedFee = (gross * 300) / BPS;
        assertEq(expectedFee, 75_000_000_000_000, "floor");
        assertLt(expectedFee * BPS, gross * 300, "fee below exact percentage");
        _fundEthAndAssert(gross, 300, treasuryA);
    }

    function testEth_MinimumIsGrossNotNet() public {
        // Exactly $5 gross at $2,000/ETH = 0.0025 ETH.
        uint256 exactMin = 0.0025 ether;
        _fundEthAndAssert(exactMin, 100, treasuryA);
        // Pool received strictly less than the minimum's ETH value: intentional.
        assertLt(address(pool).balance, exactMin);

        // One wei below the gross minimum reverts, fee or not.
        vm.prank(funder);
        vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
        pool.fund{value: exactMin - 1}();
    }

    function testEth_ReceiveAndFallbackCollectTheSameFee() public {
        uint256 gross = 1 ether;
        uint256 t0 = treasuryA.balance;

        vm.prank(funder);
        pool.fund{value: gross}();
        uint256 feeViaFund = treasuryA.balance - t0;

        uint256 t1 = treasuryA.balance;
        vm.prank(funder);
        (bool ok1,) = address(pool).call{value: gross}("");
        assertTrue(ok1, "receive path");
        uint256 feeViaReceive = treasuryA.balance - t1;

        uint256 t2 = treasuryA.balance;
        vm.prank(funder);
        (bool ok2,) = address(pool).call{value: gross}(hex"deadbeef");
        assertTrue(ok2, "fallback path");
        uint256 feeViaFallback = treasuryA.balance - t2;

        assertEq(feeViaFund, 0.01 ether);
        assertEq(feeViaReceive, feeViaFund, "receive() must charge the same fee");
        assertEq(feeViaFallback, feeViaFund, "fallback() must charge the same fee");
        assertEq(address(pool).balance, 3 * 0.99 ether);

        // Direct sends below the gross minimum are rejected on every path.
        vm.prank(funder);
        (bool okLow,) = address(pool).call{value: 1}("");
        assertFalse(okLow, "no fee-free / minimum-free direct-send path");
    }

    function testEth_DynamicFeeUpdate_SamePool() public {
        _fundEthAndAssert(1 ether, 100, treasuryA);
        _setFee(300);
        _fundEthAndAssert(1 ether, 300, treasuryA);
        _setFee(0);
        uint256 tBefore = treasuryA.balance;
        _fundEthAndAssert(1 ether, 0, treasuryA);
        assertEq(treasuryA.balance, tBefore, "no transfer at 0 bps");
        assertEq(treasuryA.balance, 0.01 ether + 0.03 ether);
        assertEq(address(pool).balance, 0.99 ether + 0.97 ether + 1 ether);
    }

    function testEth_DynamicTreasuryUpdate_SamePool() public {
        _fundEthAndAssert(1 ether, 100, treasuryA);
        _setRecipient(treasuryB);
        uint256 aBefore = treasuryA.balance;
        _fundEthAndAssert(1 ether, 100, treasuryB);
        assertEq(treasuryA.balance, aBefore, "old treasury receives nothing new");
        assertEq(treasuryB.balance, 0.01 ether);
    }

    function testEth_ContractTreasuryAccepted() public {
        MockAcceptingTreasury safe = new MockAcceptingTreasury();
        _setRecipient(address(safe));
        _fundEthAndAssert(1 ether, 100, address(safe));
    }

    function testEth_RejectingTreasuryFailsClosedThenRecovers() public {
        MockRejectingTreasury bad = new MockRejectingTreasury();
        _setRecipient(address(bad));

        uint256 poolBefore = address(pool).balance;
        vm.recordLogs();
        vm.prank(funder);
        vm.expectRevert(CommunityPool__ProtocolFeeTransferFailed.selector);
        pool.fund{value: 1 ether}();
        assertEq(address(pool).balance, poolBefore, "pool unchanged");
        assertEq(address(bad).balance, 0, "treasury unchanged");
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != Funded.selector, "no Funded event on failure");
        }

        // Recovery by configuration correction, no pool redeploy.
        _setRecipient(treasuryA);
        _fundEthAndAssert(1 ether, 100, treasuryA);
    }

    function testEth_ReentrantTreasury_Propagating_FailsClosed() public {
        MockReentrantTreasury evil = new MockReentrantTreasury();
        _setRecipient(address(evil));
        uint256 poolBefore = address(pool).balance;
        vm.prank(funder);
        vm.expectRevert(CommunityPool__ProtocolFeeTransferFailed.selector);
        pool.fund{value: 1 ether}();
        assertEq(address(pool).balance, poolBefore);
        assertEq(address(evil).balance, 0);
    }

    function testEth_ReentrantTreasury_Swallowing_InnerBlockedOuterSettles() public {
        MockReentrantTreasury evil = new MockReentrantTreasury();
        evil.setSwallow(true);
        _setRecipient(address(evil));

        vm.recordLogs();
        vm.prank(funder);
        pool.fund{value: 1 ether}();

        assertEq(evil.reentryAttempts(), 1);
        assertEq(evil.reentryBlocked(), 1, "recursive fund() must be blocked by the guard");
        assertEq(evil.withdrawAttemptsBlocked(), 1, "treasury is not an owner");
        assertEq(address(pool).balance, 0.99 ether, "pool holds exactly net; nothing drained");
        assertEq(address(evil).balance, 0.01 ether, "treasury holds exactly one fee");

        uint256 fundedEvents;
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == address(pool) && logs[i].topics[0] == Funded.selector) fundedEvents++;
        }
        assertEq(fundedEvents, 1, "exactly one funding settled");
    }

    // ================================================================ ERC-20: rates and decimals

    function testErc20_ZeroBps_AllToPool_8dec() public {
        _setFee(0);
        _fundErc20AndAssert(wbtc, 200_000, 0, treasuryA);
    }

    function testErc20_OnePercent_8dec() public {
        _fundErc20AndAssert(wbtc, 200_000, 100, treasuryA);
        assertEq(wbtc.balanceOf(treasuryA), 2_000);
        assertEq(wbtc.balanceOf(address(pool)), 198_000);
    }

    function testErc20_ThreePercent_8dec() public {
        _setFee(300);
        _fundErc20AndAssert(wbtc, 200_000, 300, treasuryA);
        assertEq(wbtc.balanceOf(treasuryA), 6_000);
        assertEq(wbtc.balanceOf(address(pool)), 194_000);
    }

    function testErc20_OnePercent_18dec() public {
        _fundErc20AndAssert(paxg, 1e18, 100, treasuryA);
        assertEq(paxg.balanceOf(treasuryA), 0.01e18);
        assertEq(paxg.balanceOf(address(pool)), 0.99e18);
    }

    function testErc20_ThreePercent_18dec() public {
        _setFee(300);
        _fundErc20AndAssert(paxg, 1e18, 300, treasuryA);
        assertEq(paxg.balanceOf(treasuryA), 0.03e18);
    }

    function testErc20_ZeroBps_18dec() public {
        _setFee(0);
        _fundErc20AndAssert(paxg, 1e18, 0, treasuryA);
    }

    function testErc20_FloorRounding() public {
        // $60,000/WBTC, min $5 => 8_333.33 raw units minimum (8 dec). Amounts chosen so 1% is fractional.
        uint256 gross = 8_339; // 1% = 83.39 -> 83
        assertEq(_fee(gross, 100), 83);
        assertLt(_fee(gross, 100) * BPS, gross * 100, "fee below exact percentage");
        _fundErc20AndAssert(wbtc, gross, 100, treasuryA);
    }

    function testErc20_RoundingToZeroFeeIsValid() public {
        // Use PAXG with a tiny fee rate so fee floors to zero: 1 bps of 8_333 raw... use rate 1.
        _setFee(1);
        // gross must clear the $5 minimum: PAXG $2,000 => 0.0025e18 raw. 1 bps of 2.5e15 = 2.5e11 (non-zero).
        // Pick WBTC: min 8_334 raw units; 1 bps of 8_334 = 0.8334 -> 0.
        uint256 gross = 8_334;
        assertEq(_fee(gross, 1), 0);
        uint256 tBefore = wbtc.balanceOf(treasuryA);
        _fundErc20AndAssert(wbtc, gross, 1, treasuryA);
        assertEq(wbtc.balanceOf(treasuryA), tBefore, "zero fee makes no transfer");
    }

    function testErc20_ExactGrossAllowanceIsSufficient() public {
        address tight = makeAddr("tightFunder");
        wbtc.mint(tight, 200_000);
        vm.startPrank(tight);
        wbtc.approve(address(pool), 200_000); // exactly gross, not gross + fee
        pool.fundERC20(IERC20(address(wbtc)), 200_000);
        vm.stopPrank();
        assertEq(wbtc.balanceOf(tight), 0, "debited exactly 200,000, not 202,000");
        assertEq(wbtc.allowance(tight, address(pool)), 0);
        assertEq(wbtc.balanceOf(treasuryA), 2_000);
        assertEq(wbtc.balanceOf(address(pool)), 198_000);
    }

    function testErc20_MinimumIsGrossNotNet() public {
        // $60,000/WBTC, 8 dec: $5 == 8_333.33.. raw; getUsdValue floors, so 8_334 is the first accepted.
        uint256 exactMin = 8_334;
        _fundErc20AndAssert(wbtc, exactMin, 100, treasuryA);
        assertLt(wbtc.balanceOf(address(pool)), exactMin, "pool holds net, below the gross minimum");

        vm.prank(funder);
        vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
        pool.fundERC20(IERC20(address(wbtc)), 8_333);
    }

    function testErc20_DynamicFeeUpdate_SamePool() public {
        _fundErc20AndAssert(wbtc, 200_000, 100, treasuryA);
        _setFee(300);
        _fundErc20AndAssert(wbtc, 200_000, 300, treasuryA);
        _setFee(0);
        _fundErc20AndAssert(wbtc, 200_000, 0, treasuryA);
        assertEq(wbtc.balanceOf(treasuryA), 2_000 + 6_000);
        assertEq(wbtc.balanceOf(address(pool)), 198_000 + 194_000 + 200_000);
    }

    function testErc20_DynamicTreasuryUpdate_SamePool() public {
        _fundErc20AndAssert(wbtc, 200_000, 100, treasuryA);
        _setRecipient(treasuryB);
        _fundErc20AndAssert(wbtc, 200_000, 100, treasuryB);
        assertEq(wbtc.balanceOf(treasuryA), 2_000, "old treasury unchanged");
        assertEq(wbtc.balanceOf(treasuryB), 2_000);
    }

    // ================================================================ ERC-20: unsupported behavior

    function testErc20_FeeOnTransferTokenRejected() public {
        MockFeeOnTransferERC20 fot = new MockFeeOnTransferERC20("Deflate", "DEF", 18, 50); // 0.5% burn
        CommunityPool p = _deployPoolWithToken(address(config), address(fot), address(paxgFeed), 18);
        fot.mint(funder, 10e18);
        vm.startPrank(funder);
        fot.approve(address(p), 1e18);
        vm.expectRevert(CommunityPool__UnsupportedTokenBehavior.selector);
        p.fundERC20(IERC20(address(fot)), 1e18);
        vm.stopPrank();
        assertEq(fot.balanceOf(address(p)), 0, "no partial contribution left behind");
        assertEq(fot.balanceOf(treasuryA), 0, "no partial fee transferred");
        assertEq(fot.balanceOf(funder), 10e18, "funder untouched");
    }

    function testErc20_FeeOnTransferTokenWithZeroTokenFeeStillWorks() public {
        // Token-side fee disabled => exact-transfer semantics hold => accepted.
        MockFeeOnTransferERC20 fot = new MockFeeOnTransferERC20("Deflate", "DEF", 18, 0);
        CommunityPool p = _deployPoolWithToken(address(config), address(fot), address(paxgFeed), 18);
        fot.mint(funder, 10e18);
        vm.startPrank(funder);
        fot.approve(address(p), 1e18);
        p.fundERC20(IERC20(address(fot)), 1e18);
        vm.stopPrank();
        assertEq(fot.balanceOf(address(p)), 0.99e18);
        assertEq(fot.balanceOf(treasuryA), 0.01e18);
    }

    function testErc20_TreasuryTransferRevertsFailsClosed() public {
        MockRevertingERC20 rev = new MockRevertingERC20("Pausable", "PAU", 18);
        CommunityPool p = _deployPoolWithToken(address(config), address(rev), address(paxgFeed), 18);
        rev.mint(funder, 10e18);
        rev.setRevertOnTransfer(true); // transferFrom still works; outbound transfer (fee) reverts
        vm.startPrank(funder);
        rev.approve(address(p), 1e18);
        vm.expectRevert();
        p.fundERC20(IERC20(address(rev)), 1e18);
        vm.stopPrank();
        assertEq(rev.balanceOf(address(p)), 0);
        assertEq(rev.balanceOf(treasuryA), 0);
        assertEq(rev.balanceOf(funder), 10e18);
    }

    function testErc20_TreasuryTransferReturnsFalseFailsClosed() public {
        MockFalseReturningERC20 f = new MockFalseReturningERC20("Falsy", "FLS", 18);
        CommunityPool p = _deployPoolWithToken(address(config), address(f), address(paxgFeed), 18);
        f.mint(funder, 10e18);
        f.setReturnFalseOnTransfer(true);
        vm.startPrank(funder);
        f.approve(address(p), 1e18);
        vm.expectRevert(); // SafeERC20FailedOperation
        p.fundERC20(IERC20(address(f)), 1e18);
        vm.stopPrank();
        assertEq(f.balanceOf(address(p)), 0);
        assertEq(f.balanceOf(funder), 10e18);
    }

    function testErc20_ZeroTokenFeeOnFalseReturningTokenSucceeds() public {
        // With 0 bps there is no outbound transfer, so a false-returning `transfer` is never hit.
        MockFalseReturningERC20 f = new MockFalseReturningERC20("Falsy", "FLS", 18);
        CommunityPool p = _deployPoolWithToken(address(config), address(f), address(paxgFeed), 18);
        f.mint(funder, 10e18);
        f.setReturnFalseOnTransfer(true);
        _setFee(0);
        vm.startPrank(funder);
        f.approve(address(p), 1e18);
        p.fundERC20(IERC20(address(f)), 1e18);
        vm.stopPrank();
        assertEq(f.balanceOf(address(p)), 1e18);
    }

    // ================================================================ malformed / non-official config

    function testMalformedConfig_FeeAboveCapFailsClosed() public {
        MockMalformedProtocolConfig bad = new MockMalformedProtocolConfig(301, treasuryA);
        CommunityPool p = _deployPool(address(bad));
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(CommunityPool__ProtocolFeeExceedsMaximum.selector, 301, 300));
        p.fund{value: 1 ether}();
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(CommunityPool__ProtocolFeeExceedsMaximum.selector, 301, 300));
        p.fundERC20(IERC20(address(wbtc)), 200_000);
        assertEq(address(p).balance, 0);
        assertEq(treasuryA.balance, 0);
        // Exactly the cap through a non-official config is still accepted (the cap is inclusive).
        bad.set(300, treasuryA);
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(treasuryA.balance, 0.03 ether);
    }

    function testMalformedConfig_ZeroRecipientWithFeeFailsClosed() public {
        MockMalformedProtocolConfig bad = new MockMalformedProtocolConfig(100, address(0));
        CommunityPool p = _deployPool(address(bad));
        vm.prank(funder);
        vm.expectRevert(CommunityPool__InvalidFeeRecipient.selector);
        p.fund{value: 1 ether}();
        vm.prank(funder);
        vm.expectRevert(CommunityPool__InvalidFeeRecipient.selector);
        p.fundERC20(IERC20(address(wbtc)), 200_000);
        assertEq(address(p).balance, 0);
        assertEq(wbtc.balanceOf(address(p)), 0);
        // Zero recipient with a zero fee is fine: nothing to send, nothing to validate.
        bad.set(0, address(0));
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(address(p).balance, 1 ether);
    }

    function testMalformedConfig_PoolItselfAsRecipientRejected() public {
        MockMalformedProtocolConfig bad = new MockMalformedProtocolConfig(100, address(0));
        CommunityPool p = _deployPool(address(bad));
        bad.set(100, address(p));
        vm.prank(funder);
        vm.expectRevert(CommunityPool__InvalidFeeRecipient.selector);
        p.fund{value: 1 ether}();
        vm.prank(funder);
        vm.expectRevert(CommunityPool__InvalidFeeRecipient.selector);
        p.fundERC20(IERC20(address(wbtc)), 200_000);
    }

    function testMalformedConfig_RevertingReadsFailClosed() public {
        MockMalformedProtocolConfig bad = new MockMalformedProtocolConfig(100, treasuryA);
        CommunityPool p = _deployPool(address(bad));
        bad.setReverts(true, false);
        vm.prank(funder);
        vm.expectRevert();
        p.fund{value: 1 ether}();
        bad.setReverts(false, true);
        vm.prank(funder);
        vm.expectRevert();
        p.fundERC20(IERC20(address(wbtc)), 200_000);
        assertEq(address(p).balance, 0);
        assertEq(wbtc.balanceOf(address(p)), 0);
        assertEq(treasuryA.balance, 0);
    }

    // ================================================================ destination and authority

    function testFeesGoToRecipientNotAdminEvenAfterRotation() public {
        address newAdmin = makeAddr("safeMultisig");
        vm.prank(protocolAdmin);
        config.transferAdmin(newAdmin);
        vm.prank(newAdmin);
        config.acceptAdmin();
        _fundEthAndAssert(1 ether, 100, treasuryA);
        assertEq(newAdmin.balance, 0, "admin never receives fees");
        assertEq(protocolAdmin.balance, 0);
        assertEq(poolDeployer.balance, 0, "deployer never receives fees");
    }

    function testAuthorityUnchangedWithFeesEnabled() public {
        _fundEthAndAssert(1 ether, 100, treasuryA);
        _fundErc20AndAssert(wbtc, 200_000, 100, treasuryA);

        address[3] memory nonOwners = [protocolAdmin, treasuryA, address(config)];
        for (uint256 i = 0; i < nonOwners.length; i++) {
            assertFalse(pool.isOwner(nonOwners[i]));
            vm.startPrank(nonOwners[i]);
            vm.expectRevert(CommunityPool__NotOwner.selector);
            pool.withdraw(1);
            vm.expectRevert(CommunityPool__NotOwner.selector);
            pool.cheaperWithdraw();
            vm.expectRevert(CommunityPool__NotOwner.selector);
            pool.withdrawToken(IERC20(address(wbtc)));
            vm.expectRevert(CommunityPool__NotOwner.selector);
            pool.withdrawTokenAmount(IERC20(address(wbtc)), 1);
            vm.stopPrank();
        }
        assertEq(address(pool).balance, 0.99 ether);
        assertEq(wbtc.balanceOf(address(pool)), 198_000);
    }

    function testOwnerWithdrawsOnlyNetAndCannotRecoverPaidFee() public {
        _fundEthAndAssert(1 ether, 100, treasuryA);
        uint256 before = poolDeployer.balance;
        vm.prank(poolDeployer);
        pool.cheaperWithdraw();
        assertEq(poolDeployer.balance - before, 0.99 ether, "owner receives net only");
        assertEq(treasuryA.balance, 0.01 ether, "paid fee stays with treasury");

        // Post-expiry release likewise releases only the net remaining.
        _fundEthAndAssert(1 ether, 100, treasuryA);
        vm.warp(uint256(expiresAt) + 1);
        uint256 before2 = poolDeployer.balance;
        pool.releaseExpiredFundsToDeployer();
        assertEq(poolDeployer.balance - before2, 0.99 ether);
    }

    function testGetProtocolFeeConfigReflectsTransactionTimeValues() public {
        (uint256 feeBps, address recipient) = pool.getProtocolFeeConfig();
        assertEq(feeBps, 100);
        assertEq(recipient, treasuryA);
        _setFee(250);
        _setRecipient(treasuryB);
        (feeBps, recipient) = pool.getProtocolFeeConfig();
        assertEq(feeBps, 250);
        assertEq(recipient, treasuryB);
        _fundEthAndAssert(1 ether, 250, treasuryB);
    }

    function testSharedConstantsMatchConfig() public view {
        assertEq(config.MAX_PROTOCOL_FEE_BPS(), ProtocolConstants.MAX_PROTOCOL_FEE_BPS);
        assertEq(config.BPS_DENOMINATOR(), ProtocolConstants.BPS_DENOMINATOR);
        assertEq(ProtocolConstants.MAX_PROTOCOL_FEE_BPS, 300);
        assertEq(ProtocolConstants.BPS_DENOMINATOR, 10_000);
    }

    // ================================================================ fuzz: accounting invariants

    function testFuzz_EthAccounting(uint96 grossRaw, uint16 bpsRaw) public {
        uint256 gross = bound(uint256(grossRaw), 0.0025 ether, 50 ether);
        uint256 bps = bound(uint256(bpsRaw), 0, 300);
        _setFee(bps);
        _fundEthAndAssert(gross, bps, treasuryA);
    }

    function testFuzz_Erc20Accounting(uint64 grossRaw, uint16 bpsRaw) public {
        uint256 gross = bound(uint256(grossRaw), 8_334, 5e8);
        uint256 bps = bound(uint256(bpsRaw), 0, 300);
        _setFee(bps);
        _fundErc20AndAssert(wbtc, gross, bps, treasuryA);
    }
}
