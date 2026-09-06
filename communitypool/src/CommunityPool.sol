// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {PriceConverter} from "./PriceConverter.sol";
import {IProtocolConfig} from "./interfaces/IProtocolConfig.sol";
import {ProtocolConstants} from "./ProtocolConstants.sol";

error CommunityPool__NotOwner();
error CommunityPool__PoolExpired();
error CommunityPool__TokenNotWhitelisted();
error CommunityPool__ZeroAddress();
error CommunityPool__BelowMinimumUsd();
error CommunityPool__DuplicateOwner();
error CommunityPool__DuplicateToken();
error CommunityPool__NotYetExpiredForRelease();
error CommunityPool__WithdrawDisabledAfterExpiry();
error CommunityPool__InvalidWithdrawAmount();
error CommunityPool__InsufficientBalance();
error CommunityPool__EthTransferFailed();
error CommunityPool__ProtocolConfigNotContract();
error CommunityPool__ProtocolFeeExceedsMaximum(uint256 observedBps, uint256 maxBps);
error CommunityPool__InvalidFeeRecipient();
error CommunityPool__ProtocolFeeTransferFailed();
error CommunityPool__UnsupportedTokenBehavior();

/// @title CommunityPool
/// @notice ETH + whitelisted ERC20 funding with USD minimums via Chainlink. Any owner may withdraw
/// balances before expiresAt. After expiresAt, owner withdraws are disabled; call
/// releaseExpiredFundsToDeployer to send all remaining assets to the immutable deployer.
/// @dev Pool name, description, and per-funder accounting are not stored on-chain — consume
/// `PoolCreated`, `Funded`, and `FundedERC20` events for those.
///
/// Protocol fee (V2 candidate). Each pool holds an immutable reference to the shared
/// `ProtocolConfig` for its chain and reads the current fee rate and fee recipient at
/// transaction time; nothing is snapshotted into pool storage, so one admin change is observed
/// by every pool. On every contribution:
///
///   grossAmount = amount the funder chose (msg.value, or the ERC-20 `grossAmount` argument)
///   feeAmount   = floor(grossAmount * protocolFeeBps / 10_000)      (never rounded up)
///   netAmount   = grossAmount - feeAmount                             (fee + net == gross)
///
///   feeAmount -> protocolConfig.feeRecipient()      netAmount -> stays in this pool
///
/// - The fee is deducted FROM the gross amount; a funder is never charged gross + fee, and the
///   ERC-20 path never pulls more than `grossAmount` (an allowance of exactly `grossAmount`
///   suffices).
/// - `minimumUsd` is evaluated against the GROSS contribution, before the fee.
/// - The fee is capped at ProtocolConstants.MAX_PROTOCOL_FEE_BPS (3%) here as well as in
///   ProtocolConfig: an observed rate above the cap makes funding revert (fail closed).
/// - A rounding result of feeAmount == 0 is valid and makes no transfer.
/// - ETH fees are sent with a checked low-level call. A fee recipient that rejects ETH makes the
///   whole contribution revert; funding is blocked until the protocol admin corrects the
///   recipient. The fee is never silently skipped or retained.
/// - ERC-20 assets must have exact transfer accounting: the pool must receive exactly
///   `grossAmount` and the recipient exactly `feeAmount`, otherwise the contribution reverts
///   (`CommunityPool__UnsupportedTokenBehavior`). Fee-on-transfer, rebasing, and similar
///   tokens are unsupported in this contract version.
/// - `fund`, `receive` and `fallback` are economically identical; ETH cannot bypass the fee.
/// - Every state-changing function shares one reentrancy guard (funding, owner withdrawals and
///   expiry release). While a contribution is settling, no other pool action can execute, even
///   from a fee recipient that is also an authorized owner. Owner rights are unchanged; they
///   simply cannot be exercised from inside a fee callback, so settlement, balances and event
///   ordering stay coherent (Phase 2.5 finding).
///
/// The ProtocolConfig admin has no authority here: it is not an owner, cannot withdraw, and
/// cannot change expiry, minimums, owners, or the token allowlist. Fees go exclusively to the
/// configured fee recipient, never to the admin, deployer, owners, or msg.sender unless one of
/// them independently is the configured recipient.
contract CommunityPool is ReentrancyGuard {
    using PriceConverter for uint256;
    using SafeERC20 for IERC20;

    struct TokenConfig {
        address token;
        address usdFeed;
        uint8 decimals;
    }

    /// @dev Packed: AggregatorV3Interface (20B) + uint8 (1B) fit in a single storage slot.
    /// A non-zero `feed` doubles as the whitelist flag.
    struct TokenInfo {
        AggregatorV3Interface feed;
        uint8 decimals;
    }

    uint256 public immutable minimumUsd;
    uint64 public immutable expiresAt;
    address public immutable deployer;
    AggregatorV3Interface private immutable i_ethUsdFeed;

    /// @notice Shared protocol configuration this pool reads fee parameters from. Immutable: a
    /// pool can never be re-pointed at a different configuration.
    IProtocolConfig public immutable protocolConfig;

    mapping(address => bool) private s_isOwner;
    mapping(address => TokenInfo) private s_tokenInfo;
    address[] private s_whitelistedTokens;

    event PoolCreated(
        address indexed deployer,
        string name,
        string description,
        uint256 minimumUsd,
        uint64 expiresAt,
        address[] coOwners,
        address[] whitelistedTokens,
        address indexed protocolConfig
    );
    /// @notice Emitted after an ETH contribution and its protocol fee (if any) have settled.
    /// `grossAmount == feeAmount + netAmount`. `feeRecipient` is address(0) when feeAmount == 0.
    event Funded(
        address indexed funder, address indexed feeRecipient, uint256 grossAmount, uint256 feeAmount, uint256 netAmount
    );
    /// @notice Emitted after an ERC-20 contribution and its protocol fee (if any) have settled.
    /// `grossAmount == feeAmount + netAmount`. `feeRecipient` is address(0) when feeAmount == 0.
    event FundedERC20(
        address indexed token,
        address indexed funder,
        address indexed feeRecipient,
        uint256 grossAmount,
        uint256 feeAmount,
        uint256 netAmount
    );
    event Withdrawn(address indexed owner, uint256 amount);
    event WithdrawnToken(address indexed token, address indexed owner, uint256 amount);

    constructor(
        string memory name_,
        string memory description_,
        uint256 minimumUsd_,
        address[] memory coOwners,
        uint64 expiresAt_,
        address ethUsdFeed,
        TokenConfig[] memory tokenConfigs,
        address protocolConfig_
    ) {
        if (ethUsdFeed == address(0)) revert CommunityPool__ZeroAddress();
        if (protocolConfig_ == address(0)) revert CommunityPool__ZeroAddress();
        // The reference is immutable and, once fee collection exists, `fund` paths will call
        // into it on every contribution. A pool bound to an address with no code would have
        // every future fee-aware funding call revert on the missing return data, bricking the
        // pool permanently. Requiring deployed code at construction catches a mistyped or
        // not-yet-deployed config address at the only moment it can still be corrected.
        if (protocolConfig_.code.length == 0) revert CommunityPool__ProtocolConfigNotContract();
        deployer = msg.sender;
        minimumUsd = minimumUsd_;
        expiresAt = expiresAt_;
        i_ethUsdFeed = AggregatorV3Interface(ethUsdFeed);
        protocolConfig = IProtocolConfig(protocolConfig_);

        s_isOwner[msg.sender] = true;

        uint256 coOwnersLen = coOwners.length;
        for (uint256 i = 0; i < coOwnersLen;) {
            address a = coOwners[i];
            if (a == address(0)) revert CommunityPool__ZeroAddress();
            if (a == msg.sender) revert CommunityPool__DuplicateOwner();
            if (s_isOwner[a]) revert CommunityPool__DuplicateOwner();
            s_isOwner[a] = true;
            unchecked {
                ++i;
            }
        }

        uint256 tokenLen = tokenConfigs.length;
        address[] memory tokenAddrs = new address[](tokenLen);
        for (uint256 j = 0; j < tokenLen;) {
            TokenConfig memory cfg = tokenConfigs[j];
            if (cfg.token == address(0) || cfg.usdFeed == address(0)) {
                revert CommunityPool__ZeroAddress();
            }
            if (address(s_tokenInfo[cfg.token].feed) != address(0)) {
                revert CommunityPool__DuplicateToken();
            }
            s_tokenInfo[cfg.token] = TokenInfo({feed: AggregatorV3Interface(cfg.usdFeed), decimals: cfg.decimals});
            s_whitelistedTokens.push(cfg.token);
            tokenAddrs[j] = cfg.token;
            unchecked {
                ++j;
            }
        }

        emit PoolCreated(
            msg.sender, name_, description_, minimumUsd_, expiresAt_, coOwners, tokenAddrs, protocolConfig_
        );
    }

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    function _checkOwner() internal view {
        if (!s_isOwner[msg.sender]) revert CommunityPool__NotOwner();
    }

    modifier notExpiredForFunding() {
        if (block.timestamp > expiresAt) revert CommunityPool__PoolExpired();
        _;
    }

    modifier onlyBeforeExpiryOwnerWithdraw() {
        if (block.timestamp > expiresAt) revert CommunityPool__WithdrawDisabledAfterExpiry();
        _;
    }

    function isOwner(address account) external view returns (bool) {
        return s_isOwner[account];
    }

    function getVersion() external view returns (uint256) {
        return i_ethUsdFeed.version();
    }

    /// @dev Returns the account that deployed the pool (for UI / legacy `getOwner` callers).
    function getOwner() external view returns (address) {
        return deployer;
    }

    function getWhitelistedTokens() external view returns (address[] memory) {
        return s_whitelistedTokens;
    }

    /// @notice Current protocol fee parameters, read live from the shared ProtocolConfig.
    /// @dev These are the values a funding call would use if mined now; each funding call
    /// re-reads them at execution time (one coherent snapshot per contribution).
    /// @return feeBps Protocol fee in basis points (10_000 bps == 100%).
    /// @return recipient Address that receives protocol fees.
    function getProtocolFeeConfig() external view returns (uint256 feeBps, address recipient) {
        feeBps = protocolConfig.protocolFeeBps();
        recipient = protocolConfig.feeRecipient();
    }

    /// @notice Contribute ETH. `msg.value` is the gross contribution; the protocol fee is
    /// deducted from it and forwarded to the configured fee recipient, the remainder stays here.
    /// @dev Order: expiry, gross USD minimum, one config snapshot, fee transfer, event. The pool
    /// already holds `msg.value`, so sending only the fee out leaves exactly `netAmount`.
    function fund() public payable nonReentrant notExpiredForFunding {
        uint256 grossAmount = msg.value;
        if (grossAmount.getConversionRate(i_ethUsdFeed) < minimumUsd) {
            revert CommunityPool__BelowMinimumUsd();
        }
        (uint256 feeAmount, address recipient) = _protocolFeeFor(grossAmount);
        if (feeAmount > 0) {
            (bool ok,) = payable(recipient).call{value: feeAmount}("");
            if (!ok) revert CommunityPool__ProtocolFeeTransferFailed();
        }
        emit Funded(msg.sender, recipient, grossAmount, feeAmount, grossAmount - feeAmount);
    }

    /// @notice Contribute a whitelisted ERC-20. `grossAmount` is the gross contribution and the
    /// maximum ever pulled from the funder; the protocol fee is paid out of it.
    /// @dev Order: whitelist, non-zero, gross USD minimum, one config snapshot, pull exactly
    /// `grossAmount`, forward exactly `feeAmount`, verify both deltas, event. Any deviation
    /// from exact-transfer accounting reverts the whole contribution.
    function fundERC20(IERC20 token, uint256 grossAmount) external nonReentrant notExpiredForFunding {
        TokenInfo memory info = s_tokenInfo[address(token)];
        if (address(info.feed) == address(0)) revert CommunityPool__TokenNotWhitelisted();
        if (grossAmount == 0) revert CommunityPool__BelowMinimumUsd();
        if (grossAmount.getUsdValue(info.decimals, info.feed) < minimumUsd) {
            revert CommunityPool__BelowMinimumUsd();
        }
        (uint256 feeAmount, address recipient) = _protocolFeeFor(grossAmount);

        uint256 poolBefore = token.balanceOf(address(this));
        token.safeTransferFrom(msg.sender, address(this), grossAmount);
        uint256 poolAfterPull = token.balanceOf(address(this));
        if (poolAfterPull < poolBefore || poolAfterPull - poolBefore != grossAmount) {
            revert CommunityPool__UnsupportedTokenBehavior();
        }

        if (feeAmount > 0) {
            uint256 recipientBefore = token.balanceOf(recipient);
            token.safeTransfer(recipient, feeAmount);
            if (
                token.balanceOf(address(this)) != poolAfterPull - feeAmount
                    || token.balanceOf(recipient) != recipientBefore + feeAmount
            ) {
                revert CommunityPool__UnsupportedTokenBehavior();
            }
        }

        emit FundedERC20(address(token), msg.sender, recipient, grossAmount, feeAmount, grossAmount - feeAmount);
    }

    /// @dev One coherent fee snapshot for a single contribution. Reads the rate, enforces the
    /// protocol cap defensively (the official ProtocolConfig already cannot exceed it), floors
    /// the fee, and only when a fee is actually due reads and validates the recipient. A
    /// reverting config call propagates and the contribution fails closed.
    function _protocolFeeFor(uint256 grossAmount) internal view returns (uint256 feeAmount, address recipient) {
        uint256 feeBps = protocolConfig.protocolFeeBps();
        if (feeBps > ProtocolConstants.MAX_PROTOCOL_FEE_BPS) {
            revert CommunityPool__ProtocolFeeExceedsMaximum(feeBps, ProtocolConstants.MAX_PROTOCOL_FEE_BPS);
        }
        feeAmount = Math.mulDiv(grossAmount, feeBps, ProtocolConstants.BPS_DENOMINATOR);
        if (feeAmount == 0) return (0, address(0));
        recipient = protocolConfig.feeRecipient();
        if (recipient == address(0) || recipient == address(this)) revert CommunityPool__InvalidFeeRecipient();
    }

    /// @notice Partial ETH owner withdraw before expiry.
    function withdraw(uint256 amount) external nonReentrant onlyOwner onlyBeforeExpiryOwnerWithdraw {
        _withdrawEthAmount(msg.sender, amount);
    }

    /// @notice Full ETH owner withdraw before expiry. After expiresAt, use
    /// releaseExpiredFundsToDeployer instead.
    function cheaperWithdraw() external nonReentrant onlyOwner onlyBeforeExpiryOwnerWithdraw {
        uint256 bal = address(this).balance;
        if (bal == 0) return;
        _withdrawEthAmount(msg.sender, bal);
    }

    /// @notice Partial ERC20 owner withdraw before expiry.
    function withdrawTokenAmount(IERC20 token, uint256 amount)
        external
        nonReentrant
        onlyOwner
        onlyBeforeExpiryOwnerWithdraw
    {
        if (address(s_tokenInfo[address(token)].feed) == address(0)) {
            revert CommunityPool__TokenNotWhitelisted();
        }
        if (amount == 0) revert CommunityPool__InvalidWithdrawAmount();

        uint256 bal = token.balanceOf(address(this));
        if (amount > bal) revert CommunityPool__InsufficientBalance();
        token.safeTransfer(msg.sender, amount);
        emit WithdrawnToken(address(token), msg.sender, amount);
    }

    /// @notice Full ERC20 owner withdraw before expiry. After expiresAt, use
    /// releaseExpiredFundsToDeployer instead.
    function withdrawToken(IERC20 token) external nonReentrant onlyOwner onlyBeforeExpiryOwnerWithdraw {
        if (address(s_tokenInfo[address(token)].feed) == address(0)) {
            revert CommunityPool__TokenNotWhitelisted();
        }

        uint256 bal = token.balanceOf(address(this));
        if (bal > 0) {
            token.safeTransfer(msg.sender, bal);
            emit WithdrawnToken(address(token), msg.sender, bal);
        }
    }

    /// @notice Callable by anyone after expiresAt. Sends all ETH and all whitelisted ERC20
    /// balances to deployer.
    function releaseExpiredFundsToDeployer() external nonReentrant {
        if (block.timestamp <= expiresAt) revert CommunityPool__NotYetExpiredForRelease();

        uint256 ethBal = address(this).balance;
        if (ethBal > 0) {
            (bool ok,) = payable(deployer).call{value: ethBal}("");
            if (!ok) revert CommunityPool__EthTransferFailed();
            emit Withdrawn(deployer, ethBal);
        }

        uint256 n = s_whitelistedTokens.length;
        for (uint256 i = 0; i < n;) {
            address t = s_whitelistedTokens[i];
            IERC20 erc = IERC20(t);
            uint256 bal = erc.balanceOf(address(this));
            if (bal > 0) {
                erc.safeTransfer(deployer, bal);
                emit WithdrawnToken(t, deployer, bal);
            }
            unchecked {
                ++i;
            }
        }
    }

    function _withdrawEthAmount(address recipient, uint256 amount) internal {
        if (amount == 0) revert CommunityPool__InvalidWithdrawAmount();
        uint256 bal = address(this).balance;
        if (amount > bal) revert CommunityPool__InsufficientBalance();
        (bool ok,) = payable(recipient).call{value: amount}("");
        if (!ok) revert CommunityPool__EthTransferFailed();
        emit Withdrawn(recipient, amount);
    }

    fallback() external payable {
        fund();
    }

    receive() external payable {
        fund();
    }
}
