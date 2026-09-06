// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {PriceConverter} from "./PriceConverter.sol";

/// @notice Thin wrapper so tests can call `PriceConverter` internal helpers.
contract PriceConverterHarness {
    function price18(AggregatorV3Interface priceFeed, uint8 feedDecimals, uint32 maxPriceAge)
        external
        view
        returns (uint256)
    {
        return PriceConverter.getPrice18(priceFeed, feedDecimals, maxPriceAge);
    }

    function conversionRate(uint256 ethAmount, AggregatorV3Interface priceFeed, uint8 feedDecimals, uint32 maxPriceAge)
        external
        view
        returns (uint256)
    {
        return PriceConverter.getConversionRate(ethAmount, priceFeed, feedDecimals, maxPriceAge);
    }

    function usdValue(
        uint256 tokenAmount,
        uint8 tokenDecimals,
        AggregatorV3Interface priceFeed,
        uint8 feedDecimals,
        uint32 maxPriceAge
    ) external view returns (uint256) {
        return PriceConverter.getUsdValue(tokenAmount, tokenDecimals, priceFeed, feedDecimals, maxPriceAge);
    }

    function readFeedDecimals(AggregatorV3Interface priceFeed) external view returns (uint8) {
        return PriceConverter.validateFeedDecimals(priceFeed);
    }

    function checkMaxAge(uint32 maxPriceAge) external pure {
        PriceConverter.validateMaxPriceAge(maxPriceAge);
    }
}
