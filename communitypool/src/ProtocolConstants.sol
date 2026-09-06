// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/// @title ProtocolConstants
/// @notice Protocol-wide basis-point policy shared by ProtocolConfig (which enforces it on
/// configuration writes) and CommunityPool (which enforces it again, defensively, at the
/// money-moving funding boundary). Neither value is admin-configurable in this contract version.
library ProtocolConstants {
    /// @notice Basis-point denominator: 10_000 bps == 100%.
    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Hard ceiling on the protocol fee: 300 bps == 3%.
    uint256 internal constant MAX_PROTOCOL_FEE_BPS = 300;
}
