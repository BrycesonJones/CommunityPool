// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {FeeSecurityBase, CommunityPool, IERC20, MockV3Aggregator, MockMintableERC20, Vm} from "./FeeSecurityBase.sol";
import {PoolHarness} from "./mocks/AdversarialMocks.sol";
import {MockMalformedProtocolConfig} from "../mocks/FeeMocks.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ProtocolConstants} from "../../src/ProtocolConstants.sol";
import {
    CommunityPool__BelowMinimumUsd,
    CommunityPool__InvalidFeeRecipient,
    CommunityPool__ProtocolFeeExceedsMaximum
} from "../../src/CommunityPool.sol";
import {ProtocolConfig__FeeExceedsMaximum} from "../../src/ProtocolConfig.sol";

/// @notice Property-based coverage of the fee mathematics and of ETH / ERC-20 funding accounting
/// across fuzzed amounts, rates, prices, minimums, decimals, and allowances.
contract ProtocolFeeFuzzTest is FeeSecurityBase {
    PoolHarness internal harness;
    MockMalformedProtocolConfig internal rawConfig;

    function setUp() public {
        _baseSetUp(100);
        rawConfig = new MockMalformedProtocolConfig(100, treasuryA);
        address[] memory cos = new address[](0);
        vm.prank(owner);
        harness =
            new PoolHarness("H", "h", MIN_USD, cos, expiresAt, address(ethFeed), _tokenConfigs(), address(rawConfig));
    }

    // ------------------------------------------------------------ pure math (no asset movement)

    function testFuzz_FeeMath(uint256 gross, uint256 bps) public {
        bps = bound(bps, 0, MAX_BPS);
        rawConfig.set(bps, treasuryA);
        (uint256 fee, address recipient) = harness.feeFor(gross);
        assertEq(fee, Math.mulDiv(gross, bps, BPS), "fee == mulDiv");
        assertLe(fee, gross, "fee <= gross");
        assertLe(fee, Math.mulDiv(gross, MAX_BPS, BPS), "fee <= 3% floor");
        assertEq(fee + (gross - fee), gross, "fee + net == gross");
        // Floor: fee * 10_000 <= gross * bps, and the next unit would exceed it.
        if (gross <= type(uint256).max / BPS) {
            assertLe(fee * BPS, gross * bps, "never rounds up");
            assertGt((fee + 1) * BPS, gross * bps, "floor is tight");
        }
        assertEq(recipient, fee == 0 ? address(0) : treasuryA, "recipient only when fee due");
    }

    function testFeeMath_Extremes() public {
        uint256[10] memory samples = [
            uint256(0), 1, 99, 100, 101, 9_999, 10_000, 10_001, uint256(type(uint128).max), uint256(type(uint192).max)
        ];
        uint256[3] memory rates = [uint256(1), 100, 300];
        for (uint256 i = 0; i < samples.length; i++) {
            for (uint256 r = 0; r < rates.length; r++) {
                rawConfig.set(rates[r], treasuryA);
                (uint256 fee,) = harness.feeFor(samples[i]);
                assertEq(fee, (samples[i] * rates[r]) / BPS);
                assertLe(fee, samples[i]);
            }
        }
        // type(uint256).max: mulDiv handles the 512-bit intermediate; fee is exactly floor(max * 300 / 10_000).
        rawConfig.set(300, treasuryA);
        (uint256 feeMax,) = harness.feeFor(type(uint256).max);
        assertEq(feeMax, Math.mulDiv(type(uint256).max, 300, BPS));
        assertLt(feeMax, type(uint256).max);
        rawConfig.set(0, treasuryA);
        (uint256 feeZero, address r0) = harness.feeFor(type(uint256).max);
        assertEq(feeZero, 0);
        assertEq(r0, address(0));
    }

    function testFuzz_FeeAboveCapFailsClosedForAnyValue(uint256 bps) public {
        bps = bound(bps, MAX_BPS + 1, type(uint256).max);
        rawConfig.set(bps, treasuryA);
        vm.expectRevert(abi.encodeWithSelector(CommunityPool__ProtocolFeeExceedsMaximum.selector, bps, MAX_BPS));
        harness.feeFor(1 ether);
        // And the official config cannot even store it.
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig__FeeExceedsMaximum.selector, bps, MAX_BPS));
        config.setProtocolFeeBps(bps);
    }

    function testFuzz_ZeroRecipientOnlyMattersWhenFeeDue(uint256 gross, uint256 bps) public {
        bps = bound(bps, 0, MAX_BPS);
        rawConfig.set(bps, address(0));
        uint256 expected = Math.mulDiv(gross, bps, BPS);
        if (expected == 0) {
            (uint256 fee, address r) = harness.feeFor(gross);
            assertEq(fee, 0);
            assertEq(r, address(0));
        } else {
            vm.expectRevert(CommunityPool__InvalidFeeRecipient.selector);
            harness.feeFor(gross);
        }
    }

    // ------------------------------------------------------------ ETH funding

    /// @dev Fuzz gross, rate, minimum and price together. Expected acceptance is computed from the
    /// same formula the contract uses; on acceptance the full accounting is asserted, on rejection
    /// nothing moves.
    function testFuzz_EthFunding(uint96 grossRaw, uint16 bpsRaw, uint96 minUsdRaw, uint64 priceRaw) public {
        uint256 gross = bound(uint256(grossRaw), 1, 500 ether);
        uint256 bps = bound(uint256(bpsRaw), 0, MAX_BPS);
        uint256 minUsd = bound(uint256(minUsdRaw), 0, 50_000e18);
        int256 price = int256(bound(uint256(priceRaw), 100e8, 100_000e8));
        ethFeed.updateAnswer(price);
        _setFee(bps);
        address[] memory cos = new address[](0);
        CommunityPool p = _newPool(owner, cos, address(config), minUsd, expiresAt);
        bool accepted = (uint256(price) * 1e10 * gross) / 1e18 >= minUsd;
        if (accepted) _ethAccept(p, gross, _fee(gross, bps));
        else _ethReject(p, gross);
    }

    function _ethReject(CommunityPool p, uint256 gross) internal {
        uint256 poolBefore = address(p).balance;
        uint256 tBefore = treasuryA.balance;
        vm.recordLogs();
        vm.prank(funder);
        vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
        p.fund{value: gross}();
        assertEq(address(p).balance, poolBefore, "rejected: pool unchanged");
        assertEq(treasuryA.balance, tBefore, "rejected: treasury unchanged");
        assertEq(_countEvents(vm.getRecordedLogs(), address(p), Funded.selector), 0, "rejected: no event");
    }

    function _ethAccept(CommunityPool p, uint256 gross, uint256 fee) internal {
        uint256 poolBefore = address(p).balance;
        uint256 tBefore = treasuryA.balance;
        uint256 fBefore = funder.balance;
        vm.recordLogs();
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(p));
        emit Funded(funder, fee == 0 ? address(0) : treasuryA, gross, fee, gross - fee);
        p.fund{value: gross}();
        assertEq(_countEvents(vm.getRecordedLogs(), address(p), Funded.selector), 1, "one event");
        assertEq(address(p).balance - poolBefore, gross - fee, "pool += net");
        assertEq(treasuryA.balance - tBefore, fee, "treasury += fee");
        assertEq(fBefore - funder.balance, gross, "funder -= gross");
        assertLe(fee, _fee(gross, MAX_BPS), "fee <= 3%");
    }

    /// @dev Direct sends (receive) and calldata sends (fallback) must be economically identical to fund().
    function testFuzz_EthIngressPathsAreEconomicallyIdentical(uint96 grossRaw, uint16 bpsRaw, uint8 pathSeed) public {
        uint256 gross = bound(uint256(grossRaw), ETH_MIN_WEI, 100 ether);
        uint256 bps = bound(uint256(bpsRaw), 0, MAX_BPS);
        _setFee(bps);
        uint256 fee = _fee(gross, bps);
        uint256 poolBefore = address(pool).balance;
        uint256 tBefore = treasuryA.balance;
        vm.recordLogs();
        vm.prank(funder);
        uint8 path = pathSeed % 3;
        bool ok;
        if (path == 0) {
            pool.fund{value: gross}();
            ok = true;
        } else if (path == 1) {
            (ok,) = address(pool).call{value: gross}("");
        } else {
            (ok,) = address(pool).call{value: gross}(abi.encodePacked(bytes4(keccak256("nope()")), pathSeed));
        }
        assertTrue(ok, "ingress path accepted");
        assertEq(_countEvents(vm.getRecordedLogs(), address(pool), Funded.selector), 1);
        assertEq(address(pool).balance - poolBefore, gross - fee);
        assertEq(treasuryA.balance - tBefore, fee);
    }

    // ------------------------------------------------------------ ERC-20 funding

    /// @dev Exact-transfer token with fuzzed decimals, price, minimum, gross, and rate.
    function testFuzz_Erc20Funding(uint8 decRaw, uint96 grossRaw, uint16 bpsRaw, uint96 minUsdRaw, uint64 priceRaw)
        public
    {
        uint8 dec = uint8(bound(uint256(decRaw), 0, 24));
        uint256 gross = bound(uint256(grossRaw), 1, 10 ** uint256(dec) * 1_000);
        uint256 bps = bound(uint256(bpsRaw), 0, MAX_BPS);
        uint256 minUsd = bound(uint256(minUsdRaw), 0, 100_000e18);
        int256 price = int256(bound(uint256(priceRaw), 1e8, 100_000e8));
        MockMintableERC20 tok = new MockMintableERC20("T", "T", dec);
        MockV3Aggregator feed = new MockV3Aggregator(8, price);
        _setFee(bps);
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](1);
        tks[0] = CommunityPool.TokenConfig({token: address(tok), usdFeed: address(feed), decimals: dec});
        address[] memory cos = new address[](0);
        vm.prank(owner);
        CommunityPool p = new CommunityPool("F", "f", minUsd, cos, expiresAt, address(ethFeed), tks, address(config));
        tok.mint(funder, gross);
        vm.prank(funder);
        tok.approve(address(p), gross); // exactly gross

        uint256 usdValue = (uint256(price) * 1e10 * gross) / (10 ** uint256(dec));
        uint256 fee = _fee(gross, bps);
        vm.recordLogs();
        vm.prank(funder);
        if (usdValue < minUsd) {
            vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
            p.fundERC20(IERC20(address(tok)), gross);
            assertEq(tok.balanceOf(address(p)), 0);
            assertEq(tok.balanceOf(treasuryA), 0);
            assertEq(tok.balanceOf(funder), gross);
            return;
        }
        p.fundERC20(IERC20(address(tok)), gross);
        assertEq(_countEvents(vm.getRecordedLogs(), address(p), FundedERC20.selector), 1);
        assertEq(tok.balanceOf(address(p)), gross - fee, "pool == net");
        assertEq(tok.balanceOf(treasuryA), fee, "treasury == fee");
        assertEq(tok.balanceOf(funder), 0, "funder debited exactly gross");
        assertEq(tok.allowance(funder, address(p)), 0, "allowance of exactly gross fully consumed");
    }

    function testFuzz_Erc20Allowance(uint64 grossRaw, uint16 bpsRaw, uint8 mode) public {
        uint256 gross = bound(uint256(grossRaw), WBTC_MIN_RAW, 100e8);
        uint256 bps = bound(uint256(bpsRaw), 0, MAX_BPS);
        _setFee(bps);
        address tight = makeAddr("tightFunder");
        wbtc.mint(tight, gross + 1);
        uint256 allowance;
        uint8 m = mode % 4;
        if (m == 0) allowance = gross - 1;
        else if (m == 1) allowance = gross;
        else if (m == 2) allowance = gross + 1;
        else allowance = type(uint256).max;
        vm.startPrank(tight);
        wbtc.approve(address(pool), allowance);
        if (m == 0) {
            vm.expectRevert();
            pool.fundERC20(IERC20(address(wbtc)), gross);
            assertEq(wbtc.balanceOf(tight), gross + 1, "nothing pulled");
        } else {
            pool.fundERC20(IERC20(address(wbtc)), gross);
            assertEq(wbtc.balanceOf(tight), 1, "pulled exactly gross, never more");
            if (allowance != type(uint256).max) assertEq(wbtc.allowance(tight, address(pool)), allowance - gross);
        }
        vm.stopPrank();
    }

    // ------------------------------------------------------------ minimum semantics

    function testFuzz_EthMinimumIsIndependentOfFeeRate(uint16 bpsRaw, uint8 offsetSeed) public {
        uint256 bps = bound(uint256(bpsRaw), 0, MAX_BPS);
        _setFee(bps);
        int256 off = int256(uint256(offsetSeed % 3)) - 1; // -1, 0, +1 wei
        uint256 value = uint256(int256(ETH_MIN_WEI) + off);
        vm.prank(funder);
        if (off < 0) {
            vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
            pool.fund{value: value}();
        } else {
            pool.fund{value: value}();
            assertLe(address(pool).balance, value, "pool holds at most gross");
        }
    }

    function testFuzz_Erc20MinimumIsIndependentOfFeeRate(uint16 bpsRaw, uint8 offsetSeed) public {
        uint256 bps = bound(uint256(bpsRaw), 0, MAX_BPS);
        _setFee(bps);
        int256 off = int256(uint256(offsetSeed % 3)) - 1;
        uint256 amount = uint256(int256(uint256(WBTC_MIN_RAW)) + off);
        vm.prank(funder);
        if (off < 0) {
            vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
            pool.fundERC20(IERC20(address(wbtc)), amount);
        } else {
            pool.fundERC20(IERC20(address(wbtc)), amount);
            assertEq(wbtc.balanceOf(address(pool)), amount - _fee(amount, bps));
        }
    }

    /// @dev Tiny gross amounts at non-zero rates floor to a zero fee: no treasury contact, gross retained.
    function testFuzz_TinyFeeRoundsToZeroWithoutContactingTreasury(uint16 grossRaw, uint16 bpsRaw) public {
        uint256 bps = bound(uint256(bpsRaw), 1, MAX_BPS);
        uint256 gross = bound(uint256(grossRaw), WBTC_MIN_RAW, WBTC_MIN_RAW + (BPS / bps) - 1);
        vm.assume(_fee(gross, bps) == 0);
        _setFee(bps);
        // A rejecting recipient proves the treasury is never called when the fee floors to zero.
        _setRecipient(address(new RejectAll()));
        vm.prank(funder);
        vm.expectEmit(true, true, true, true, address(pool));
        emit FundedERC20(address(wbtc), funder, address(0), gross, 0, gross);
        pool.fundERC20(IERC20(address(wbtc)), gross);
        assertEq(wbtc.balanceOf(address(pool)), gross);
    }
}

contract RejectAll {
    receive() external payable {
        revert("RejectAll");
    }
}
