// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {PriceConverter} from "./PriceConverter.sol";

/// @notice Thin wrapper so tests can call `PriceConverter` internal helpers.
contract PriceConverterHarness {
    function conversionRate(
        uint256 ethAmount,
        AggregatorV3Interface priceFeed
    ) external view returns (uint256) {
        return PriceConverter.getConversionRate(ethAmount, priceFeed);
    }
}
