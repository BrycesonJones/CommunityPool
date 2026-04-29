// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Read-only fork tests against live Chainlink feeds. Set `SEPOLIA_RPC_URL` or
/// `MAINNET_RPC_URL` (e.g. Alchemy HTTPS URLs) to run; otherwise tests are skipped.
contract ForkPriceFeedTest is Test {
    // https://docs.chain.link/data-feeds/price-feeds/addresses (Sepolia ETH / USD)
    address internal constant SEPOLIA_ETH_USD = 0x694AA1769357215DE4FAC081bf1f309aDC325306;
    address internal constant MAINNET_ETH_USD = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    // Feeds the JS/Solidity deploy paths point at on mainnet — keep in sync with
    // lib/onchain/pool-chain-config.ts and script/DeployCommunityPool.s.sol.
    address internal constant MAINNET_WBTC_USD = 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c;
    address internal constant MAINNET_PAXG_USD = 0x9944D86CEB9160aF5C5feB251FD671923323f8C3;
    address internal constant MAINNET_XAU_USD = 0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6;

    /// Stale-feed window: skip the recency check unless the fork's `updatedAt` is within this many
    /// seconds of `block.timestamp`. Mainnet XAU/USD is heartbeat-bounded (~24h) so we use 7 days
    /// as a generous bound that still catches a feed that's clearly broken.
    uint256 internal constant FRESH_WINDOW = 7 days;

    function _selectFork(string memory envName) internal returns (bool) {
        string memory rpc = vm.envOr(envName, string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return false;
        }
        vm.createSelectFork(rpc);
        return true;
    }

    function _assertHealthyFeed(address feedAddr, string memory label) internal view {
        AggregatorV3Interface feed = AggregatorV3Interface(feedAddr);
        (, int256 answer,, uint256 updatedAt,) = feed.latestRoundData();
        assertGt(answer, 0, string.concat(label, ": answer should be positive"));
        assertGt(updatedAt, 0, string.concat(label, ": updatedAt should be set"));
        if (block.timestamp > FRESH_WINDOW && updatedAt + FRESH_WINDOW < block.timestamp) {
            revert(string.concat(label, ": feed is stale (updatedAt older than 7 days)"));
        }
        // Lock down the 8-decimal assumption baked into PriceConverter.getPrice (* 1e10 scale).
        assertEq(feed.decimals(), 8, string.concat(label, ": expected 8-decimal feed"));
    }

    function testFork_SepoliaLatestRoundData() public {
        if (!_selectFork("SEPOLIA_RPC_URL")) return;
        _assertHealthyFeed(SEPOLIA_ETH_USD, "Sepolia ETH/USD");
    }

    function testFork_MainnetLatestRoundData() public {
        if (!_selectFork("MAINNET_RPC_URL")) return;
        _assertHealthyFeed(MAINNET_ETH_USD, "Mainnet ETH/USD");
    }

    function testFork_MainnetWbtcFeed() public {
        if (!_selectFork("MAINNET_RPC_URL")) return;
        _assertHealthyFeed(MAINNET_WBTC_USD, "Mainnet WBTC/USD");
    }

    function testFork_MainnetPaxgFeed() public {
        if (!_selectFork("MAINNET_RPC_URL")) return;
        _assertHealthyFeed(MAINNET_PAXG_USD, "Mainnet PAXG/USD");
    }

    function testFork_MainnetXauFeed() public {
        if (!_selectFork("MAINNET_RPC_URL")) return;
        _assertHealthyFeed(MAINNET_XAU_USD, "Mainnet XAU/USD");
    }
}
