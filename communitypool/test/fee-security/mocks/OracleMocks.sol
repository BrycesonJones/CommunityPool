// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";

/// @notice Fully controllable AggregatorV3 mock for oracle-validation tests: every field of
/// latestRoundData, the reported decimals, and revert switches are settable.
contract MockOracle is AggregatorV3Interface {
    uint8 private _decimals;
    uint80 public roundId;
    int256 public answer;
    uint256 public startedAt;
    uint256 public updatedAt;
    uint80 public answeredInRound;
    bool public revertLatestRoundData;
    bool public revertDecimals;

    constructor(uint8 decimals_, int256 answer_) {
        _decimals = decimals_;
        roundId = 1;
        answer = answer_;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
        answeredInRound = 1;
    }

    // ---------------------------------------------------------------- controls

    function setAnswer(int256 a) external {
        answer = a;
    }

    function setUpdatedAt(uint256 t) external {
        updatedAt = t;
    }

    function setStartedAt(uint256 t) external {
        startedAt = t;
    }

    function setRound(uint80 r, uint80 answered) external {
        roundId = r;
        answeredInRound = answered;
    }

    function setDecimals(uint8 d) external {
        _decimals = d;
    }

    function setReverts(bool onLatestRoundData, bool onDecimals) external {
        revertLatestRoundData = onLatestRoundData;
        revertDecimals = onDecimals;
    }

    /// @dev Fresh round at the current block time.
    function refresh(int256 a) external {
        answer = a;
        roundId++;
        answeredInRound = roundId;
        startedAt = block.timestamp;
        updatedAt = block.timestamp;
    }

    // ---------------------------------------------------------------- AggregatorV3Interface

    function decimals() external view returns (uint8) {
        if (revertDecimals) revert("MockOracle: decimals reverts");
        return _decimals;
    }

    function description() external pure returns (string memory) {
        return "MockOracle";
    }

    function version() external pure returns (uint256) {
        return 6;
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        if (revertLatestRoundData) revert("MockOracle: latestRoundData reverts");
        return (roundId, answer, startedAt, updatedAt, answeredInRound);
    }
}
