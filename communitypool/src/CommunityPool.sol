// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {AggregatorV3Interface} from "@chainlink/contracts/src/v0.8/shared/interfaces/AggregatorV3Interface.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {PriceConverter} from "./PriceConverter.sol";

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

/// @title CommunityPool
/// @notice ETH + whitelisted ERC20 funding with USD minimums via Chainlink. Any owner may withdraw
/// balances before expiresAt. After expiresAt, owner withdraws are disabled; call
/// releaseExpiredFundsToDeployer to send all remaining assets to the immutable deployer.
/// @dev Pool name, description, and per-funder accounting are not stored on-chain — consume
/// `PoolCreated`, `Funded`, and `FundedERC20` events for those.
contract CommunityPool {
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
        address[] whitelistedTokens
    );
    event Funded(address indexed funder, uint256 amount);
    event FundedERC20(address indexed token, address indexed funder, uint256 amount);
    event Withdrawn(address indexed owner, uint256 amount);
    event WithdrawnToken(address indexed token, address indexed owner, uint256 amount);

    constructor(
        string memory name_,
        string memory description_,
        uint256 minimumUsd_,
        address[] memory coOwners,
        uint64 expiresAt_,
        address ethUsdFeed,
        TokenConfig[] memory tokenConfigs
    ) {
        if (ethUsdFeed == address(0)) revert CommunityPool__ZeroAddress();
        deployer = msg.sender;
        minimumUsd = minimumUsd_;
        expiresAt = expiresAt_;
        i_ethUsdFeed = AggregatorV3Interface(ethUsdFeed);

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
            s_tokenInfo[cfg.token] =
                TokenInfo({feed: AggregatorV3Interface(cfg.usdFeed), decimals: cfg.decimals});
            s_whitelistedTokens.push(cfg.token);
            tokenAddrs[j] = cfg.token;
            unchecked {
                ++j;
            }
        }

        emit PoolCreated(
            msg.sender, name_, description_, minimumUsd_, expiresAt_, coOwners, tokenAddrs
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

    function fund() public payable notExpiredForFunding {
        if (msg.value.getConversionRate(i_ethUsdFeed) < minimumUsd) {
            revert CommunityPool__BelowMinimumUsd();
        }
        emit Funded(msg.sender, msg.value);
    }

    function fundERC20(IERC20 token, uint256 amount) external notExpiredForFunding {
        TokenInfo memory info = s_tokenInfo[address(token)];
        if (address(info.feed) == address(0)) revert CommunityPool__TokenNotWhitelisted();
        if (amount == 0) revert CommunityPool__BelowMinimumUsd();
        if (amount.getUsdValue(info.decimals, info.feed) < minimumUsd) {
            revert CommunityPool__BelowMinimumUsd();
        }

        token.safeTransferFrom(msg.sender, address(this), amount);
        emit FundedERC20(address(token), msg.sender, amount);
    }

    /// @notice Partial ETH owner withdraw before expiry.
    function withdraw(uint256 amount) external onlyOwner onlyBeforeExpiryOwnerWithdraw {
        _withdrawEthAmount(msg.sender, amount);
    }

    /// @notice Full ETH owner withdraw before expiry. After expiresAt, use
    /// releaseExpiredFundsToDeployer instead.
    function cheaperWithdraw() external onlyOwner onlyBeforeExpiryOwnerWithdraw {
        uint256 bal = address(this).balance;
        if (bal == 0) return;
        _withdrawEthAmount(msg.sender, bal);
    }

    /// @notice Partial ERC20 owner withdraw before expiry.
    function withdrawTokenAmount(IERC20 token, uint256 amount)
        external
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
    function withdrawToken(IERC20 token) external onlyOwner onlyBeforeExpiryOwnerWithdraw {
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
    function releaseExpiredFundsToDeployer() external {
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
