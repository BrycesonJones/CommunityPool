// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title PriceConverter
/// @notice Validated Chainlink price reads normalized to CommunityPool's 18-decimal USD representation.
///
/// Every read of `latestRoundData()` is validated before use:
///   - `answer > 0`                          (PriceConverter__InvalidPrice)
///   - `updatedAt != 0`                      (PriceConverter__IncompleteRound)
///   - `updatedAt <= block.timestamp`        (PriceConverter__FutureTimestamp)
///   - `block.timestamp - updatedAt <= maxPriceAge`  (PriceConverter__StalePrice)
/// Boundary: an answer whose age equals `maxPriceAge` is still valid; one second older is stale.
///
/// `answeredInRound` is NOT checked: Chainlink documents it as deprecated ("previously used when
/// answers could take multiple rounds to be computed") and the OCR feeds CommunityPool targets
/// (aggregator version 6) always report it equal to `roundId`. `startedAt` is NOT checked: it is
/// informational for OCR feeds and `updatedAt` is the completion signal.
///
/// Feed decimals are not assumed. The consumer reads `decimals()` once at construction, rejects
/// feeds above 18 decimals (PriceConverter__UnsupportedFeedDecimals), and passes the stored value
/// here so each read scales the answer to 18 decimals without an extra external call.
///
/// A feed that reverts, returns a non-positive answer, an incomplete round, a future timestamp, or
/// a stale timestamp makes the calling operation revert. There is no cached or fallback price.
library PriceConverter {
    error PriceConverter__InvalidPrice(int256 answer);
    error PriceConverter__IncompleteRound();
    error PriceConverter__FutureTimestamp(uint256 updatedAt, uint256 blockTimestamp);
    error PriceConverter__StalePrice(uint256 updatedAt, uint256 blockTimestamp, uint32 maxPriceAge);
    error PriceConverter__UnsupportedFeedDecimals(uint8 feedDecimals);
    error PriceConverter__InvalidMaxPriceAge();

    /// @notice Largest feed decimals supported; answers are scaled UP to 18, never down.
    uint8 internal constant MAX_FEED_DECIMALS = 18;

    /// @notice Read `decimals()` from a feed and enforce the supported range. Call once at
    /// construction; a reverting `decimals()` propagates and fails construction closed.
    function validateFeedDecimals(AggregatorV3Interface priceFeed) internal view returns (uint8 feedDecimals) {
        feedDecimals = priceFeed.decimals();
        if (feedDecimals > MAX_FEED_DECIMALS) revert PriceConverter__UnsupportedFeedDecimals(feedDecimals);
    }

    /// @notice A maximum price age of zero would reject every round; refuse it at configuration time.
    /// `uint32` seconds spans ~136 years, far beyond any sensible heartbeat multiple.
    function validateMaxPriceAge(uint32 maxPriceAge) internal pure {
        if (maxPriceAge == 0) revert PriceConverter__InvalidMaxPriceAge();
    }

    /// @notice Validated latest price scaled to 18 decimals.
    /// @param feedDecimals The feed's `decimals()` as captured at construction (<= 18).
    /// @param maxPriceAge Maximum accepted age in seconds; age == maxPriceAge is still valid.
    function getPrice18(AggregatorV3Interface priceFeed, uint8 feedDecimals, uint32 maxPriceAge)
        internal
        view
        returns (uint256)
    {
        (, int256 answer,, uint256 updatedAt,) = priceFeed.latestRoundData();
        if (answer <= 0) revert PriceConverter__InvalidPrice(answer);
        if (updatedAt == 0) revert PriceConverter__IncompleteRound();
        if (updatedAt > block.timestamp) revert PriceConverter__FutureTimestamp(updatedAt, block.timestamp);
        if (block.timestamp - updatedAt > maxPriceAge) {
            revert PriceConverter__StalePrice(updatedAt, block.timestamp, maxPriceAge);
        }
        // feedDecimals <= 18 is guaranteed by validateFeedDecimals; checked arithmetic makes an
        // absurd answer overflow-revert rather than mis-scale.
        return uint256(answer) * (10 ** uint256(MAX_FEED_DECIMALS - feedDecimals));
    }

    /// @notice USD value (18-decimal fixed point) of `ethAmount` wei.
    function getConversionRate(
        uint256 ethAmount,
        AggregatorV3Interface priceFeed,
        uint8 feedDecimals,
        uint32 maxPriceAge
    ) internal view returns (uint256) {
        uint256 ethPrice18 = getPrice18(priceFeed, feedDecimals, maxPriceAge);
        return Math.mulDiv(ethPrice18, ethAmount, 1e18);
    }

    /// @notice USD value (18-decimal fixed point) for `tokenAmount` raw units of a token with `tokenDecimals`.
    function getUsdValue(
        uint256 tokenAmount,
        uint8 tokenDecimals,
        AggregatorV3Interface priceFeed,
        uint8 feedDecimals,
        uint32 maxPriceAge
    ) internal view returns (uint256) {
        uint256 tokenPrice18 = getPrice18(priceFeed, feedDecimals, maxPriceAge);
        return Math.mulDiv(tokenPrice18, tokenAmount, 10 ** uint256(tokenDecimals));
    }
}
