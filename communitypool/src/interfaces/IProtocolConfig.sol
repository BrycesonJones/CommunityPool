// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

/// @title IProtocolConfig
/// @notice The read surface a CommunityPool needs from the shared protocol configuration.
/// @dev Intentionally minimal: pools consume the current fee rate and recipient and nothing
/// else. Administrative functions live on the concrete ProtocolConfig and are not part of the
/// pool-facing interface.
interface IProtocolConfig {
    /// @notice Current protocol fee in basis points (1 bps = 0.01%). Never exceeds the
    /// implementation's immutable maximum.
    function protocolFeeBps() external view returns (uint256);

    /// @notice Address that will receive protocol fees once fee collection is enabled.
    function feeRecipient() external view returns (address);
}
