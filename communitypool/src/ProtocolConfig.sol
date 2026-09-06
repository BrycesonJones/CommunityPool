// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";
import {ProtocolConstants} from "./ProtocolConstants.sol";

error ProtocolConfig__NotAdmin();
error ProtocolConfig__NotPendingAdmin();
error ProtocolConfig__ZeroAddress();
error ProtocolConfig__FeeExceedsMaximum(uint256 requestedBps, uint256 maxBps);

/// @title ProtocolConfig
/// @notice Shared, non-upgradeable protocol configuration read by every fee-enabled
/// CommunityPool on a chain: the protocol fee rate (basis points) and the fee recipient.
///
/// Authority model:
///   - `admin` may change the fee rate (0..MAX_PROTOCOL_FEE_BPS), change the fee recipient, and
///     begin a two-step transfer of the admin role. Nothing else.
///   - The admin has NO authority over any CommunityPool's assets. This contract never holds,
///     receives, or moves ETH or tokens, never calls into pools, and cannot alter pool
///     ownership, expiry, minimums, or allowlists. Being admin here grants no pool ownership.
///   - `MAX_PROTOCOL_FEE_BPS` is a compile-time constant. No function can raise it.
///   - Admin rotation is two-step (propose, then the proposed account accepts) so control can
///     later move from an EOA to a multisig without a single mistyped transaction handing the
///     role to an unreachable address. There is deliberately no renounce function.
///
/// The contract has no payable functions, no receive/fallback, no delegatecall, no external
/// calls of any kind, and no upgrade path.
contract ProtocolConfig is IProtocolConfig {
    /// @notice Basis-point denominator: 10_000 bps == 100%. Shared with CommunityPool via
    /// ProtocolConstants so the money-moving contract enforces the same policy defensively.
    uint256 public constant BPS_DENOMINATOR = ProtocolConstants.BPS_DENOMINATOR;

    /// @notice Hard ceiling on the protocol fee for this contract version: 300 bps == 3%.
    uint256 public constant MAX_PROTOCOL_FEE_BPS = ProtocolConstants.MAX_PROTOCOL_FEE_BPS;

    /// @notice Account that may change configuration and propose its successor.
    address public admin;

    /// @notice Account proposed to become admin; zero when no transfer is in progress.
    address public pendingAdmin;

    /// @inheritdoc IProtocolConfig
    address public override feeRecipient;

    /// @inheritdoc IProtocolConfig
    uint256 public override protocolFeeBps;

    event ProtocolFeeUpdated(uint256 previousFeeBps, uint256 newFeeBps);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    /// @param admin_ Initial configuration authority. Must be non-zero.
    /// @param feeRecipient_ Initial fee recipient (EOA or contract). Must be non-zero.
    /// @param initialProtocolFeeBps_ Initial fee rate; must not exceed MAX_PROTOCOL_FEE_BPS.
    constructor(address admin_, address feeRecipient_, uint256 initialProtocolFeeBps_) {
        if (admin_ == address(0) || feeRecipient_ == address(0)) revert ProtocolConfig__ZeroAddress();
        if (initialProtocolFeeBps_ > MAX_PROTOCOL_FEE_BPS) {
            revert ProtocolConfig__FeeExceedsMaximum(initialProtocolFeeBps_, MAX_PROTOCOL_FEE_BPS);
        }
        admin = admin_;
        feeRecipient = feeRecipient_;
        protocolFeeBps = initialProtocolFeeBps_;
        emit AdminTransferred(address(0), admin_);
        emit FeeRecipientUpdated(address(0), feeRecipient_);
        emit ProtocolFeeUpdated(0, initialProtocolFeeBps_);
    }

    modifier onlyAdmin() {
        if (msg.sender != admin) revert ProtocolConfig__NotAdmin();
        _;
    }

    /// @notice Set the protocol fee rate. Bounded by MAX_PROTOCOL_FEE_BPS in Solidity; the
    /// ceiling is not adjustable by anyone.
    function setProtocolFeeBps(uint256 newFeeBps) external onlyAdmin {
        if (newFeeBps > MAX_PROTOCOL_FEE_BPS) {
            revert ProtocolConfig__FeeExceedsMaximum(newFeeBps, MAX_PROTOCOL_FEE_BPS);
        }
        uint256 previous = protocolFeeBps;
        protocolFeeBps = newFeeBps;
        emit ProtocolFeeUpdated(previous, newFeeBps);
    }

    /// @notice Set the fee recipient. Any non-zero address is accepted, including contracts, so a
    /// treasury may be a Safe/multisig.
    function setFeeRecipient(address newFeeRecipient) external onlyAdmin {
        if (newFeeRecipient == address(0)) revert ProtocolConfig__ZeroAddress();
        address previous = feeRecipient;
        feeRecipient = newFeeRecipient;
        emit FeeRecipientUpdated(previous, newFeeRecipient);
    }

    /// @notice Step 1 of admin rotation: propose a successor. The current admin keeps full
    /// authority until the successor calls acceptAdmin. Proposing again overwrites the pending
    /// proposal.
    function transferAdmin(address newAdmin) external onlyAdmin {
        if (newAdmin == address(0)) revert ProtocolConfig__ZeroAddress();
        pendingAdmin = newAdmin;
        emit AdminTransferStarted(msg.sender, newAdmin);
    }

    /// @notice Step 2 of admin rotation: the proposed successor claims the role. Only the
    /// pending admin may call this; the previous admin loses authority atomically.
    function acceptAdmin() external {
        address pending = pendingAdmin;
        if (pending == address(0) || msg.sender != pending) revert ProtocolConfig__NotPendingAdmin();
        address previous = admin;
        admin = pending;
        pendingAdmin = address(0);
        emit AdminTransferred(previous, pending);
    }
}
