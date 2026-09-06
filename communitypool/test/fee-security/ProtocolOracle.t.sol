// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {FeeSecurityBase, CommunityPool, IERC20} from "./FeeSecurityBase.sol";
import {MockOracle} from "./mocks/OracleMocks.sol";
import {PriceConverter} from "../../src/PriceConverter.sol";
import {PriceConverterHarness} from "../../src/PriceConverterHarness.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {CommunityPool__BelowMinimumUsd} from "../../src/CommunityPool.sol";

/// @notice Phase 2.6 oracle hardening: every Chainlink read must be positive, complete, not from
/// the future, and no older than the pool's immutable per-feed `maxPriceAge`; feed decimals are
/// read at construction and normalized to 18. A rejected price fails the contribution closed
/// before any asset moves, on every ETH ingress (`fund`, `receive`, `fallback`) and on `fundERC20`.
contract ProtocolOracleTest is FeeSecurityBase {
    uint32 internal constant ETH_AGE = 3600;
    uint32 internal constant TOKEN_AGE = 86_400;
    uint256 internal constant T0 = 1_800_000_000;

    MockOracle internal ethOracle;
    MockOracle internal wbtcOracle;
    CommunityPool internal opool;
    PriceConverterHarness internal harness;

    function setUp() public {
        vm.warp(T0);
        _baseSetUp(100);
        harness = new PriceConverterHarness();
        ethOracle = new MockOracle(8, ETH_PRICE);
        wbtcOracle = new MockOracle(8, WBTC_PRICE);
        opool = _oraclePool(address(ethOracle), ETH_AGE, address(wbtcOracle), 8, TOKEN_AGE);
    }

    // ------------------------------------------------------------------ fixtures

    function _oraclePool(address ethFeedAddr, uint32 ethAge, address tokFeed, uint8 tokDec, uint32 tokAge)
        internal
        returns (CommunityPool p)
    {
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](1);
        tks[0] =
            CommunityPool.TokenConfig({token: address(wbtc), usdFeed: tokFeed, decimals: tokDec, maxPriceAge: tokAge});
        address[] memory cos = new address[](0);
        vm.prank(owner);
        p = new CommunityPool("Oracle", "d", MIN_USD, cos, expiresAt, ethFeedAddr, ethAge, tks, address(config));
        vm.prank(funder);
        wbtc.approve(address(p), type(uint256).max);
    }

    function _stale(uint256 updatedAt, uint32 maxAge) internal view returns (bytes memory) {
        return
            abi.encodeWithSelector(
                PriceConverter.PriceConverter__StalePrice.selector, updatedAt, block.timestamp, maxAge
            );
    }

    struct Snapshot {
        uint256 poolEth;
        uint256 treasuryEth;
        uint256 funderEth;
        uint256 poolWbtc;
        uint256 treasuryWbtc;
        uint256 funderWbtc;
        uint256 allowance;
    }

    function _snap(CommunityPool p) internal view returns (Snapshot memory s) {
        s.poolEth = address(p).balance;
        s.treasuryEth = treasuryA.balance;
        s.funderEth = funder.balance;
        s.poolWbtc = wbtc.balanceOf(address(p));
        s.treasuryWbtc = wbtc.balanceOf(treasuryA);
        s.funderWbtc = wbtc.balanceOf(funder);
        s.allowance = wbtc.allowance(funder, address(p));
    }

    function _assertUnchanged(CommunityPool p, Snapshot memory before) internal view {
        Snapshot memory after_ = _snap(p);
        assertEq(after_.poolEth, before.poolEth, "pool ETH moved");
        assertEq(after_.treasuryEth, before.treasuryEth, "treasury ETH moved");
        assertEq(after_.funderEth, before.funderEth, "funder ETH moved");
        assertEq(after_.poolWbtc, before.poolWbtc, "pool WBTC moved");
        assertEq(after_.treasuryWbtc, before.treasuryWbtc, "treasury WBTC moved");
        assertEq(after_.funderWbtc, before.funderWbtc, "funder WBTC moved");
        assertEq(after_.allowance, before.allowance, "allowance consumed");
    }

    /// @dev Expect `fund` (direct), `receive` and `fallback` to all revert with `err` and move nothing.
    function _expectAllEthIngressFailClosed(CommunityPool p, bytes memory err) internal {
        Snapshot memory before = _snap(p);
        vm.startPrank(funder);
        vm.expectRevert(err);
        p.fund{value: 1 ether}();
        vm.expectRevert(err);
        (bool ok,) = address(p).call{value: 1 ether}("");
        ok; // expectRevert consumed the revert; the low-level call itself succeeds
        vm.expectRevert(err);
        (ok,) = address(p).call{value: 1 ether}(hex"deadbeef");
        vm.stopPrank();
        _assertUnchanged(p, before);
    }

    // ------------------------------------------------------------------ construction validation

    function testConstructionRejectsZeroEthMaxPriceAge() public {
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](0);
        address[] memory cos = new address[](0);
        vm.expectRevert(PriceConverter.PriceConverter__InvalidMaxPriceAge.selector);
        new CommunityPool("x", "d", MIN_USD, cos, expiresAt, address(ethOracle), 0, tks, address(config));
    }

    function testConstructionRejectsZeroTokenMaxPriceAge() public {
        vm.expectRevert(PriceConverter.PriceConverter__InvalidMaxPriceAge.selector);
        _oraclePool(address(ethOracle), ETH_AGE, address(wbtcOracle), 8, 0);
    }

    function testConstructionRejectsFeedAbove18Decimals() public {
        MockOracle big = new MockOracle(19, 1e19);
        vm.expectRevert(abi.encodeWithSelector(PriceConverter.PriceConverter__UnsupportedFeedDecimals.selector, 19));
        _oraclePool(address(big), ETH_AGE, address(wbtcOracle), 8, TOKEN_AGE);
        vm.expectRevert(abi.encodeWithSelector(PriceConverter.PriceConverter__UnsupportedFeedDecimals.selector, 19));
        _oraclePool(address(ethOracle), ETH_AGE, address(big), 8, TOKEN_AGE);
    }

    function testConstructionFailsClosedWhenDecimalsReverts() public {
        MockOracle broken = new MockOracle(8, ETH_PRICE);
        broken.setReverts(false, true);
        vm.expectRevert(bytes("MockOracle: decimals reverts"));
        _oraclePool(address(broken), ETH_AGE, address(wbtcOracle), 8, TOKEN_AGE);
        vm.expectRevert(bytes("MockOracle: decimals reverts"));
        _oraclePool(address(ethOracle), ETH_AGE, address(broken), 8, TOKEN_AGE);
    }

    function testConstructionCapturesFeedDecimalsAndThresholds() public {
        MockOracle six = new MockOracle(6, 60_000e6);
        CommunityPool p = _oraclePool(address(ethOracle), 7_200, address(six), 8, 172_800);
        (address f, uint8 fd, uint32 age) = p.getEthUsdFeed();
        assertEq(f, address(ethOracle));
        assertEq(fd, 8);
        assertEq(age, 7_200);
        (address tf, uint8 td, uint8 tfd, uint32 tage) = p.getTokenInfo(address(wbtc));
        assertEq(tf, address(six));
        assertEq(td, 8);
        assertEq(tfd, 6);
        assertEq(tage, 172_800);
        (address nf, uint8 nd, uint8 nfd, uint32 nage) = p.getTokenInfo(address(paxg));
        assertEq(nf, address(0), "non-whitelisted token has no feed");
        assertEq(nd + nfd + nage, 0);
    }

    function testFeedDecimalsAreReadOnceAtConstruction() public {
        // Changing what the feed reports later does not change the captured scale: the pool
        // keeps using the construction-time value (documented; a feed's decimals never change).
        ethOracle.setDecimals(18);
        (, uint8 fd,) = opool.getEthUsdFeed();
        assertEq(fd, 8, "captured decimals are immutable");
        ethOracle.setDecimals(8);
    }

    // ------------------------------------------------------------------ mock matrix (ETH ingress)

    function testFreshValidPriceAccepted() public {
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(address(opool).balance, 0.99 ether);
        assertEq(treasuryA.balance, 0.01 ether);
    }

    function testZeroAnswerRejected() public {
        ethOracle.setAnswer(0);
        _expectAllEthIngressFailClosed(
            opool, abi.encodeWithSelector(PriceConverter.PriceConverter__InvalidPrice.selector, int256(0))
        );
    }

    function testNegativeAnswerRejected() public {
        ethOracle.setAnswer(-1);
        _expectAllEthIngressFailClosed(
            opool, abi.encodeWithSelector(PriceConverter.PriceConverter__InvalidPrice.selector, int256(-1))
        );
    }

    function testIncompleteRoundRejected() public {
        ethOracle.setUpdatedAt(0);
        _expectAllEthIngressFailClosed(
            opool, abi.encodeWithSelector(PriceConverter.PriceConverter__IncompleteRound.selector)
        );
    }

    function testFutureTimestampRejected() public {
        ethOracle.setUpdatedAt(block.timestamp + 1);
        _expectAllEthIngressFailClosed(
            opool,
            abi.encodeWithSelector(
                PriceConverter.PriceConverter__FutureTimestamp.selector, block.timestamp + 1, block.timestamp
            )
        );
    }

    function testStalePriceRejected() public {
        vm.warp(T0 + ETH_AGE + 1);
        _expectAllEthIngressFailClosed(opool, _stale(T0, ETH_AGE));
    }

    function testRevertingFeedFailsClosed() public {
        ethOracle.setReverts(true, false);
        _expectAllEthIngressFailClosed(opool, bytes("MockOracle: latestRoundData reverts"));
    }

    function testAnsweredInRoundIsNotConsulted() public {
        // Deprecated field per Chainlink docs: a fresh, complete round is accepted regardless.
        ethOracle.setRound(10, 0);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        ethOracle.setRound(10, 3);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(address(opool).balance, 1.98 ether);
    }

    function testStartedAtIsNotConsulted() public {
        ethOracle.setStartedAt(0);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        ethOracle.setStartedAt(block.timestamp + 1 days);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(address(opool).balance, 1.98 ether);
    }

    function testStaleThenRefreshedFeedRecovers() public {
        vm.warp(T0 + ETH_AGE + 1);
        _expectAllEthIngressFailClosed(opool, _stale(T0, ETH_AGE));
        ethOracle.refresh(ETH_PRICE);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(address(opool).balance, 0.99 ether);
    }

    // ------------------------------------------------------------------ boundary: max-1 / max / max+1

    function testEthBoundaryMaxMinusOneAccepted() public {
        vm.warp(T0 + ETH_AGE - 1);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(address(opool).balance, 0.99 ether);
    }

    function testEthBoundaryExactlyMaxAccepted() public {
        vm.warp(T0 + ETH_AGE);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(address(opool).balance, 0.99 ether);
    }

    function testEthBoundaryMaxPlusOneRejected() public {
        vm.warp(T0 + ETH_AGE + 1);
        _expectAllEthIngressFailClosed(opool, _stale(T0, ETH_AGE));
    }

    function testTokenBoundaryMaxMinusOneAccepted() public {
        vm.warp(T0 + TOKEN_AGE - 1);
        ethOracle.refresh(ETH_PRICE); // ETH feed is irrelevant to fundERC20 but keep it honest
        vm.prank(funder);
        opool.fundERC20(IERC20(address(wbtc)), 1e8);
        assertEq(wbtc.balanceOf(address(opool)), 0.99e8);
    }

    function testTokenBoundaryExactlyMaxAccepted() public {
        vm.warp(T0 + TOKEN_AGE);
        vm.prank(funder);
        opool.fundERC20(IERC20(address(wbtc)), 1e8);
        assertEq(wbtc.balanceOf(address(opool)), 0.99e8);
    }

    function testTokenBoundaryMaxPlusOneRejected() public {
        vm.warp(T0 + TOKEN_AGE + 1);
        Snapshot memory before = _snap(opool);
        vm.prank(funder);
        vm.expectRevert(_stale(T0, TOKEN_AGE));
        opool.fundERC20(IERC20(address(wbtc)), 1e8);
        _assertUnchanged(opool, before);
    }

    // ------------------------------------------------------------------ ERC-20 fail-closed matrix

    function _expectTokenFailClosed(bytes memory err) internal {
        Snapshot memory before = _snap(opool);
        vm.prank(funder);
        vm.expectRevert(err);
        opool.fundERC20(IERC20(address(wbtc)), 1e8);
        _assertUnchanged(opool, before);
    }

    function testTokenZeroAnswerRejected() public {
        wbtcOracle.setAnswer(0);
        _expectTokenFailClosed(abi.encodeWithSelector(PriceConverter.PriceConverter__InvalidPrice.selector, int256(0)));
    }

    function testTokenNegativeAnswerRejected() public {
        wbtcOracle.setAnswer(-60_000e8);
        _expectTokenFailClosed(
            abi.encodeWithSelector(PriceConverter.PriceConverter__InvalidPrice.selector, int256(-60_000e8))
        );
    }

    function testTokenIncompleteRoundRejected() public {
        wbtcOracle.setUpdatedAt(0);
        _expectTokenFailClosed(abi.encodeWithSelector(PriceConverter.PriceConverter__IncompleteRound.selector));
    }

    function testTokenFutureTimestampRejected() public {
        wbtcOracle.setUpdatedAt(block.timestamp + 5);
        _expectTokenFailClosed(
            abi.encodeWithSelector(
                PriceConverter.PriceConverter__FutureTimestamp.selector, block.timestamp + 5, block.timestamp
            )
        );
    }

    function testTokenRevertingFeedFailsClosed() public {
        wbtcOracle.setReverts(true, false);
        _expectTokenFailClosed(bytes("MockOracle: latestRoundData reverts"));
    }

    // ------------------------------------------------------------------ per-feed independence

    function testThresholdsAreIndependentPerFeed() public {
        // ETH feed (1h) is stale, WBTC feed (24h) is still fresh: only ETH ingress is blocked.
        vm.warp(T0 + ETH_AGE + 1);
        _expectAllEthIngressFailClosed(opool, _stale(T0, ETH_AGE));
        vm.prank(funder);
        opool.fundERC20(IERC20(address(wbtc)), 1e8);
        assertEq(wbtc.balanceOf(address(opool)), 0.99e8);
    }

    function testTokenStalenessDoesNotBlockEth() public {
        vm.warp(T0 + TOKEN_AGE + 1);
        ethOracle.refresh(ETH_PRICE);
        vm.prank(funder);
        vm.expectRevert(_stale(T0, TOKEN_AGE));
        opool.fundERC20(IERC20(address(wbtc)), 1e8);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(address(opool).balance, 0.99 ether);
    }

    function testStalenessOnOnePoolDoesNotAffectAnotherWithLongerThreshold() public {
        CommunityPool lenient = _oraclePool(address(ethOracle), 2 * ETH_AGE, address(wbtcOracle), 8, TOKEN_AGE);
        vm.warp(T0 + ETH_AGE + 1);
        _expectAllEthIngressFailClosed(opool, _stale(T0, ETH_AGE));
        vm.prank(funder);
        lenient.fund{value: 1 ether}();
        assertEq(address(lenient).balance, 0.99 ether);
    }

    // ------------------------------------------------------------------ price only gates the minimum

    function testOraclePriceDoesNotChangeFeeSplit() public {
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        ethOracle.refresh(ETH_PRICE * 50); // $100k ETH
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        ethOracle.refresh(ETH_PRICE / 100); // $20 ETH
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(treasuryA.balance, 0.03 ether, "fee is 1% of gross at every price");
        assertEq(address(opool).balance, 2.97 ether);
    }

    function testFuzz_FeeIndependentOfPrice(int256 price) public {
        price = bound(price, 5e8, 1e16); // $5 .. $100M per ETH keeps 1 ETH above the $5 minimum
        ethOracle.refresh(price);
        vm.prank(funder);
        opool.fund{value: 1 ether}();
        assertEq(treasuryA.balance, 0.01 ether);
        assertEq(address(opool).balance, 0.99 ether);
    }

    function testBelowMinimumStillRejectedWithFreshPrice() public {
        vm.prank(funder);
        vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
        opool.fund{value: ETH_MIN_WEI - 1}();
        vm.prank(funder);
        opool.fund{value: ETH_MIN_WEI}();
    }

    // ------------------------------------------------------------------ decimal normalization

    function testMinimumGateIdenticalAcrossFeedDecimals() public {
        uint8[3] memory decs = [uint8(6), 8, 18];
        for (uint256 i = 0; i < decs.length; i++) {
            MockOracle e = new MockOracle(decs[i], int256(2000) * int256(10 ** uint256(decs[i])));
            MockOracle t = new MockOracle(decs[i], int256(60_000) * int256(10 ** uint256(decs[i])));
            CommunityPool p = _oraclePool(address(e), ETH_AGE, address(t), 8, TOKEN_AGE);
            vm.startPrank(funder);
            vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
            p.fund{value: ETH_MIN_WEI - 1}();
            p.fund{value: ETH_MIN_WEI}();
            vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
            p.fundERC20(IERC20(address(wbtc)), WBTC_MIN_RAW - 1);
            p.fundERC20(IERC20(address(wbtc)), WBTC_MIN_RAW);
            vm.stopPrank();
        }
    }

    function testFuzz_Price18Normalization(uint8 feedDecimals, int256 answer) public {
        feedDecimals = uint8(bound(uint256(feedDecimals), 0, 18));
        answer = bound(answer, 1, type(int256).max / 1e18);
        MockOracle o = new MockOracle(feedDecimals, answer);
        uint256 got = harness.price18(AggregatorV3Interface(address(o)), feedDecimals, ETH_AGE);
        assertEq(got, uint256(answer) * 10 ** (18 - uint256(feedDecimals)));
    }

    function testAbsurdAnswerOverflowsInsteadOfMisscaling() public {
        MockOracle o = new MockOracle(0, type(int256).max);
        vm.expectRevert(); // checked multiplication panics
        harness.price18(AggregatorV3Interface(address(o)), 0, ETH_AGE);
    }

    function testFuzz_UsdValueScalesByTokenAndFeedDecimals(uint8 feedDecimals, uint8 tokenDecimals, uint128 amount)
        public
    {
        feedDecimals = uint8(bound(uint256(feedDecimals), 0, 18));
        tokenDecimals = uint8(bound(uint256(tokenDecimals), 0, 30));
        int256 answer = int256(60_000) * int256(10 ** uint256(feedDecimals));
        MockOracle o = new MockOracle(feedDecimals, answer);
        uint256 got = harness.usdValue(amount, tokenDecimals, AggregatorV3Interface(address(o)), feedDecimals, ETH_AGE);
        assertEq(got, (60_000e18 * uint256(amount)) / 10 ** uint256(tokenDecimals));
    }

    // ------------------------------------------------------------------ freshness fuzz

    function testFuzz_FreshnessWindowIsInclusive(uint32 maxAge, uint256 age) public {
        maxAge = uint32(bound(uint256(maxAge), 1, type(uint32).max));
        age = bound(age, 0, uint256(maxAge) * 2 + 1);
        MockOracle o = new MockOracle(8, ETH_PRICE);
        vm.warp(T0 + age);
        if (age <= maxAge) {
            assertEq(harness.price18(AggregatorV3Interface(address(o)), 8, maxAge), 2000e18);
        } else {
            vm.expectRevert(
                abi.encodeWithSelector(PriceConverter.PriceConverter__StalePrice.selector, T0, T0 + age, maxAge)
            );
            harness.price18(AggregatorV3Interface(address(o)), 8, maxAge);
        }
    }

    function testFuzz_FutureTimestampAlwaysRejected(uint256 ahead) public {
        ahead = bound(ahead, 1, 365 days);
        ethOracle.setUpdatedAt(block.timestamp + ahead);
        vm.prank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriceConverter.PriceConverter__FutureTimestamp.selector, block.timestamp + ahead, block.timestamp
            )
        );
        opool.fund{value: 1 ether}();
    }

    function testFuzz_NonPositiveAnswerAlwaysRejected(int256 answer) public {
        answer = bound(answer, type(int256).min, 0);
        ethOracle.setAnswer(answer);
        vm.prank(funder);
        vm.expectRevert(abi.encodeWithSelector(PriceConverter.PriceConverter__InvalidPrice.selector, answer));
        opool.fund{value: 1 ether}();
    }

    function testHarnessRejectsZeroMaxAge() public {
        vm.expectRevert(PriceConverter.PriceConverter__InvalidMaxPriceAge.selector);
        harness.checkMaxAge(0);
        harness.checkMaxAge(1);
    }

    // ------------------------------------------------------------------ legacy fixture feed (MockV3Aggregator)

    function testLegacyFixtureFeedGoesStalePastFixtureThreshold() public {
        vm.warp(T0 + uint256(ORACLE_MAX_AGE) + 1);
        // pool from the base fixture expired at T0 + 30 days; use a fresh long-lived pool instead
        address[] memory cos = new address[](0);
        vm.prank(owner);
        CommunityPool p = new CommunityPool(
            "L",
            "d",
            MIN_USD,
            cos,
            uint64(block.timestamp + 1 days),
            address(ethFeed),
            ORACLE_MAX_AGE,
            _tokenConfigs(),
            address(config)
        );
        vm.prank(funder);
        vm.expectRevert(_stale(T0, ORACLE_MAX_AGE));
        p.fund{value: 1 ether}();
        ethFeed.updateAnswer(ETH_PRICE);
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(address(p).balance, 0.99 ether);
    }
}
