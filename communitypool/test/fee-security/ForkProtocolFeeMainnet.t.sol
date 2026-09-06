// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {CommunityPool} from "../../src/CommunityPool.sol";
import {PriceConverter} from "../../src/PriceConverter.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mainnet-fork compatibility of the V2 candidate's exact-transfer fee split with the real
/// canonical assets. Addresses are the ones already committed in script/DeployCommunityPool.s.sol
/// and lib/onchain/pool-chain-config.ts. Local fork only: balances are set with `deal`, no real
/// transaction is ever broadcast. Skips cleanly without MAINNET_RPC_URL.
contract ForkProtocolFeeMainnetTest is Test {
    address internal constant MAINNET_ETH_USD = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address internal constant MAINNET_WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address internal constant MAINNET_WBTC_USD_FEED = 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c;
    address internal constant MAINNET_PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78;
    address internal constant MAINNET_PAXG_USD_FEED = 0x9944D86CEB9160aF5C5feB251FD671923323f8C3;
    address internal constant MAINNET_XAUT = 0x68749665FF8D2d112Fa859AA293F07A622782F38;
    address internal constant MAINNET_XAU_USD_FEED = 0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6;
    // XAU/USD takes the same 2x-heartbeat policy as PAXG/USD: the feed publishes 24/7/365
    // (max observed gap 24.01 h, including weekends and gold-market holidays).

    /// @dev Verified mainnet policy (docs/deployment/phase-2-7-mainnet-canary.md): 2x feed heartbeat.
    uint32 internal constant ORACLE_MAX_AGE = 7_200; // ETH/USD + BTC/USD heartbeat 3600 s
    uint32 internal constant ORACLE_MAX_AGE_DAILY = 172_800; // PAXG/USD heartbeat 86400 s
    address internal admin = makeAddr("forkAdmin");
    address internal treasury = makeAddr("forkTreasury");
    address internal owner = makeAddr("forkOwner");
    address internal funder = makeAddr("forkFunder");

    function _pool() internal returns (CommunityPool p, ProtocolConfig c) {
        c = new ProtocolConfig(admin, treasury, 100);
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](2);
        tks[0] = CommunityPool.TokenConfig({
            token: MAINNET_WBTC, usdFeed: MAINNET_WBTC_USD_FEED, decimals: 8, maxPriceAge: ORACLE_MAX_AGE
        });
        tks[1] = CommunityPool.TokenConfig({
            token: MAINNET_PAXG, usdFeed: MAINNET_PAXG_USD_FEED, decimals: 18, maxPriceAge: ORACLE_MAX_AGE_DAILY
        });
        address[] memory cos = new address[](0);
        vm.prank(owner);
        p = new CommunityPool(
            "Fork", "f", 5e18, cos, uint64(block.timestamp + 30 days), MAINNET_ETH_USD, ORACLE_MAX_AGE, tks, address(c)
        );
    }

    function _skipIfNoRpc() internal returns (bool) {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return true;
        }
        vm.createSelectFork(rpc);
        return false;
    }

    function testFork_EthSplitWithRealChainlinkFeed() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        vm.deal(funder, 10 ether);
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(address(p).balance, 0.99 ether);
        assertEq(treasury.balance, 0.01 ether);
    }

    function testFork_WbtcExactTransferSplitWithExactAllowance() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        uint256 gross = 1_000_000; // 0.01 WBTC
        deal(MAINNET_WBTC, funder, gross);
        vm.startPrank(funder);
        IERC20(MAINNET_WBTC).approve(address(p), gross);
        p.fundERC20(IERC20(MAINNET_WBTC), gross);
        vm.stopPrank();
        assertEq(IERC20(MAINNET_WBTC).balanceOf(address(p)), 990_000);
        assertEq(IERC20(MAINNET_WBTC).balanceOf(treasury), 10_000);
        assertEq(IERC20(MAINNET_WBTC).balanceOf(funder), 0, "debited exactly gross");
        assertEq(IERC20(MAINNET_WBTC).allowance(funder, address(p)), 0);
    }

    function testFork_PaxgExactTransferSplitWithExactAllowance() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        uint256 gross = 1e18; // 1 PAXG
        deal(MAINNET_PAXG, funder, gross);
        vm.startPrank(funder);
        IERC20(MAINNET_PAXG).approve(address(p), gross);
        // PAXG is fee-on-transfer CAPABLE; its live fee rate is what makes it pass or fail exact
        // accounting. This test records the live outcome either way.
        (bool ok,) = address(p).call(abi.encodeWithSelector(p.fundERC20.selector, IERC20(MAINNET_PAXG), gross));
        vm.stopPrank();
        if (ok) {
            assertEq(IERC20(MAINNET_PAXG).balanceOf(address(p)), 0.99e18, "exact split at live 0 transfer fee");
            assertEq(IERC20(MAINNET_PAXG).balanceOf(treasury), 0.01e18);
            assertEq(IERC20(MAINNET_PAXG).balanceOf(funder), 0);
        } else {
            // Live PAXG transfer fee is non-zero: exact-transfer accounting rejects it atomically.
            assertEq(IERC20(MAINNET_PAXG).balanceOf(address(p)), 0);
            assertEq(IERC20(MAINNET_PAXG).balanceOf(treasury), 0);
            assertEq(IERC20(MAINNET_PAXG).balanceOf(funder), gross);
        }
    }

    // ------------------------------------------------------------------ Phase 2.6: live feed inspection

    struct FeedFacts {
        uint8 decimals;
        int256 answer;
        uint256 updatedAt;
        uint80 roundId;
        uint80 answeredInRound;
        uint256 version;
    }

    function _facts(address feed) internal view returns (FeedFacts memory f) {
        AggregatorV3Interface a = AggregatorV3Interface(feed);
        f.decimals = a.decimals();
        f.version = a.version();
        (f.roundId, f.answer,, f.updatedAt, f.answeredInRound) = a.latestRoundData();
    }

    /// @dev Every canonical mainnet feed the deploy script wires must satisfy the validation policy
    /// at the fork block with the chosen maxPriceAge, and must report 8 decimals (the value the
    /// pool captures at construction; documented in phase-2-7-mainnet-canary.md).
    function _assertFeedHealthy(address feed, uint32 maxAge, string memory label) internal view {
        FeedFacts memory f = _facts(feed);
        assertEq(f.decimals, 8, string.concat(label, ": decimals"));
        assertGt(f.answer, 0, string.concat(label, ": answer"));
        assertTrue(f.updatedAt != 0, string.concat(label, ": incomplete round"));
        assertLe(f.updatedAt, block.timestamp, string.concat(label, ": future timestamp"));
        assertLe(block.timestamp - f.updatedAt, maxAge, string.concat(label, ": stale at fork block"));
        assertEq(f.answeredInRound, f.roundId, string.concat(label, ": OCR feed reports answeredInRound == roundId"));
        assertEq(f.version, 6, string.concat(label, ": aggregator version"));
    }

    function testFork_CanonicalFeedsSatisfyValidationPolicy() public {
        if (_skipIfNoRpc()) return;
        _assertFeedHealthy(MAINNET_ETH_USD, ORACLE_MAX_AGE, "ETH/USD");
        _assertFeedHealthy(MAINNET_WBTC_USD_FEED, ORACLE_MAX_AGE, "BTC/USD");
        _assertFeedHealthy(MAINNET_PAXG_USD_FEED, ORACLE_MAX_AGE_DAILY, "PAXG/USD");
        _assertFeedHealthy(MAINNET_XAU_USD_FEED, ORACLE_MAX_AGE_DAILY, "XAU/USD");
    }

    function testFork_PoolCapturesRealFeedDecimals() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        (address feed, uint8 fd, uint32 age) = p.getEthUsdFeed();
        assertEq(feed, MAINNET_ETH_USD);
        assertEq(fd, 8);
        assertEq(age, ORACLE_MAX_AGE);
        (address tf, uint8 td, uint8 tfd, uint32 tage) = p.getTokenInfo(MAINNET_WBTC);
        assertEq(tf, MAINNET_WBTC_USD_FEED);
        assertEq(td, 8);
        assertEq(tfd, 8);
        assertEq(tage, ORACLE_MAX_AGE);
    }

    function testFork_XautPoolConstructsAndPricesFromXauUsd() public {
        if (_skipIfNoRpc()) return;
        ProtocolConfig c = new ProtocolConfig(admin, treasury, 100);
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](1);
        tks[0] = CommunityPool.TokenConfig({
            token: MAINNET_XAUT, usdFeed: MAINNET_XAU_USD_FEED, decimals: 6, maxPriceAge: ORACLE_MAX_AGE_DAILY
        });
        address[] memory cos = new address[](0);
        CommunityPool p = new CommunityPool(
            "Fork", "f", 5e18, cos, uint64(block.timestamp + 30 days), MAINNET_ETH_USD, ORACLE_MAX_AGE, tks, address(c)
        );
        (, uint8 td, uint8 tfd, uint32 tage) = p.getTokenInfo(MAINNET_XAUT);
        assertEq(td, 6);
        assertEq(tfd, 8);
        assertEq(tage, ORACLE_MAX_AGE_DAILY);
        // 0.01 XAU₮ (troy oz) is worth far more than $5, so the minimum gate passes at any sane price.
        deal(MAINNET_XAUT, funder, 10_000);
        vm.startPrank(funder);
        IERC20(MAINNET_XAUT).approve(address(p), 10_000);
        (bool ok,) = address(p).call(abi.encodeWithSelector(p.fundERC20.selector, IERC20(MAINNET_XAUT), 10_000));
        vm.stopPrank();
        // XAU₮ is fee-on-transfer CAPABLE (like PAXG); record the live outcome either way.
        if (ok) {
            assertEq(IERC20(MAINNET_XAUT).balanceOf(address(p)), 9_900);
            assertEq(IERC20(MAINNET_XAUT).balanceOf(treasury), 100);
        } else {
            assertEq(IERC20(MAINNET_XAUT).balanceOf(address(p)), 0);
            assertEq(IERC20(MAINNET_XAUT).balanceOf(funder), 10_000);
        }
    }

    /// @dev Smoke check on the live cadence of the two 24h-heartbeat feeds: every gap between
    /// recent consecutive rounds must sit inside the threshold the deploy script wires.
    ///
    /// Honest limitation: at the feeds' current few-minute cadence this window spans only hours,
    /// so it cannot by itself observe a weekend. The durable evidence that XAU/USD publishes
    /// 24/7/365 (max gap 24.01 h across weekends, Christmas 2025 and Good Friday 2026) is the
    /// off-chain round-walk recorded in docs/deployment/phase-2-7-mainnet-canary.md, which the
    /// canary checklist re-runs on deployment day. This test guards against a regime change that
    /// is visible inside the sampled window.
    function testFork_DailyFeedsRecentRoundsRespectThreshold() public {
        if (_skipIfNoRpc()) return;
        _assertRecentGaps(MAINNET_XAU_USD_FEED, ORACLE_MAX_AGE_DAILY, "XAU/USD");
        _assertRecentGaps(MAINNET_PAXG_USD_FEED, ORACLE_MAX_AGE_DAILY, "PAXG/USD");
    }

    function _assertRecentGaps(address feed, uint32 maxAge, string memory label) internal view {
        AggregatorV3Interface a = AggregatorV3Interface(feed);
        (uint80 latest,,, uint256 newer,) = a.latestRoundData();
        uint256 sampled;
        for (uint256 i = 1; i <= 40; i++) {
            if (latest < i) break;
            (, int256 answer,, uint256 older,) = a.getRoundData(latest - uint80(i));
            if (older == 0 || answer <= 0) break; // walked past this aggregator phase
            assertLe(newer - older, maxAge, string.concat(label, ": gap between consecutive rounds"));
            newer = older;
            sampled++;
        }
        assertGt(sampled, 0, string.concat(label, ": no historical rounds readable"));
    }

    /// @dev Real feed, real pool: once the fork clock passes the threshold without a new round,
    /// ETH and WBTC contributions fail closed with the typed staleness error and nothing moves.
    function testFork_RealFeedFailsClosedWhenNoRoundArrives() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        FeedFacts memory f = _facts(MAINNET_ETH_USD);
        vm.warp(f.updatedAt + ORACLE_MAX_AGE); // boundary: still valid
        vm.deal(funder, 10 ether);
        vm.prank(funder);
        p.fund{value: 1 ether}();
        vm.warp(f.updatedAt + ORACLE_MAX_AGE + 1);
        vm.prank(funder);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriceConverter.PriceConverter__StalePrice.selector, f.updatedAt, block.timestamp, ORACLE_MAX_AGE
            )
        );
        p.fund{value: 1 ether}();
        assertEq(address(p).balance, 0.99 ether, "only the pre-threshold contribution settled");
        assertEq(treasury.balance, 0.01 ether);

        FeedFacts memory b = _facts(MAINNET_WBTC_USD_FEED);
        vm.warp(b.updatedAt + ORACLE_MAX_AGE + 1);
        deal(MAINNET_WBTC, funder, 1_000_000);
        vm.startPrank(funder);
        IERC20(MAINNET_WBTC).approve(address(p), 1_000_000);
        vm.expectRevert(
            abi.encodeWithSelector(
                PriceConverter.PriceConverter__StalePrice.selector, b.updatedAt, block.timestamp, ORACLE_MAX_AGE
            )
        );
        p.fundERC20(IERC20(MAINNET_WBTC), 1_000_000);
        vm.stopPrank();
        assertEq(IERC20(MAINNET_WBTC).balanceOf(address(p)), 0);
        assertEq(IERC20(MAINNET_WBTC).balanceOf(funder), 1_000_000);
    }
}
