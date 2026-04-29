// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

library PriceConverter {
    function getPrice(AggregatorV3Interface priceFeed) internal view returns (uint256) {
        (, int256 answer,,,) = priceFeed.latestRoundData();
        if (answer <= 0) revert();
        return uint256(answer * 1e10);
    }

    function getConversionRate(uint256 ethAmount, AggregatorV3Interface priceFeed)
        internal
        view
        returns (uint256)
    {
        uint256 ethPrice = getPrice(priceFeed);
        return (ethPrice * ethAmount) / 1e18;
    }

    /// @notice USD value (18-decimal fixed point) for `tokenAmount` of an ERC20 with `tokenDecimals`.
    function getUsdValue(uint256 tokenAmount, uint8 tokenDecimals, AggregatorV3Interface priceFeed)
        internal
        view
        returns (uint256)
    {
        uint256 tokenPrice = getPrice(priceFeed);
        return (tokenPrice * tokenAmount) / (10 ** uint256(tokenDecimals));
    }
}
