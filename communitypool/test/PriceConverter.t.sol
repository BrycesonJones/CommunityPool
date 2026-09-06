// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {MockV3Aggregator} from "./pricefeeds/V3Aggregator.sol";
import {PriceConverterHarness} from "../src/PriceConverterHarness.sol";

contract PriceConverterTest is Test {
    MockV3Aggregator internal feed;
    PriceConverterHarness internal harness;

    function setUp() public {
        feed = new MockV3Aggregator(8, int256(2000e8));
        harness = new PriceConverterHarness();
    }

    /// @dev 1 ETH at $2000/ETH -> 2000 USD in 18-decimal fixed point (8-decimal feed, fresh round).
    function testOneEthAt2000Usd() public view {
        uint256 usd = harness.conversionRate(1 ether, AggregatorV3Interface(address(feed)), 8, 1 hours);
        assertEq(usd, 2000e18);
    }

    function testFeedDecimalsReadFromFeed() public view {
        assertEq(harness.readFeedDecimals(AggregatorV3Interface(address(feed))), 8);
    }
}
