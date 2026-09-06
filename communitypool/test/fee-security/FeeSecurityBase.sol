// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test, Vm} from "forge-std/Test.sol";
import {CommunityPool} from "../../src/CommunityPool.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockV3Aggregator} from "../pricefeeds/V3Aggregator.sol";
import {MockMintableERC20} from "../MockMintableERC20.sol";

/// @notice Shared fixture for the Phase 2.5 security suites. Deterministic fixture addresses; the
/// intended mainnet admin/treasury addresses are never referenced.
abstract contract FeeSecurityBase is Test {
    event Funded(
        address indexed funder, address indexed feeRecipient, uint256 grossAmount, uint256 feeAmount, uint256 netAmount
    );
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

    uint256 internal constant BPS = 10_000;
    uint256 internal constant MAX_BPS = 300;
    uint256 internal constant MIN_USD = 5e18;
    int256 internal constant ETH_PRICE = 2000e8; // $2,000
    int256 internal constant WBTC_PRICE = 60_000e8;
    int256 internal constant PAXG_PRICE = 2_000e8;
    uint256 internal constant ETH_MIN_WEI = 0.0025 ether; // $5 at $2,000
    uint256 internal constant WBTC_MIN_RAW = 8_334; // first raw amount >= $5 at $60k, 8 dec

    address internal admin = makeAddr("protocolAdmin");
    address internal pendingAdmin = makeAddr("pendingAdmin");
    address internal treasuryA = makeAddr("treasuryA");
    address internal treasuryB = makeAddr("treasuryB");
    address internal treasuryC = makeAddr("treasuryC");
    address internal owner = makeAddr("poolOwner");
    address internal coOwner = makeAddr("coOwner");
    address internal funder = makeAddr("funder");
    address internal funderB = makeAddr("funderB");
    address internal attacker = makeAddr("attacker");

    ProtocolConfig internal config;
    MockV3Aggregator internal ethFeed;
    MockV3Aggregator internal wbtcFeed;
    MockV3Aggregator internal paxgFeed;
    MockMintableERC20 internal wbtc;
    MockMintableERC20 internal paxg;
    uint64 internal expiresAt;
    CommunityPool internal pool;

    function _baseSetUp(uint256 initialBps) internal {
        config = new ProtocolConfig(admin, treasuryA, initialBps);
        ethFeed = new MockV3Aggregator(8, ETH_PRICE);
        wbtcFeed = new MockV3Aggregator(8, WBTC_PRICE);
        paxgFeed = new MockV3Aggregator(8, PAXG_PRICE);
        wbtc = new MockMintableERC20("Wrapped BTC", "WBTC", 8);
        paxg = new MockMintableERC20("PAX Gold", "PAXG", 18);
        expiresAt = uint64(block.timestamp + 30 days);
        address[] memory cos = new address[](1);
        cos[0] = coOwner;
        pool = _newPool(owner, cos, address(config), MIN_USD, expiresAt);
        _fundActors();
    }

    function _fundActors() internal {
        address[4] memory actors = [funder, funderB, attacker, owner];
        for (uint256 i = 0; i < actors.length; i++) {
            vm.deal(actors[i], 1_000 ether);
            wbtc.mint(actors[i], 1_000e8);
            paxg.mint(actors[i], 10_000e18);
            vm.startPrank(actors[i]);
            wbtc.approve(address(pool), type(uint256).max);
            paxg.approve(address(pool), type(uint256).max);
            vm.stopPrank();
        }
    }

    function _tokenConfigs() internal view returns (CommunityPool.TokenConfig[] memory tks) {
        tks = new CommunityPool.TokenConfig[](2);
        tks[0] = CommunityPool.TokenConfig({token: address(wbtc), usdFeed: address(wbtcFeed), decimals: 8});
        tks[1] = CommunityPool.TokenConfig({token: address(paxg), usdFeed: address(paxgFeed), decimals: 18});
    }

    function _newPool(address deployer, address[] memory cos, address cfg, uint256 minUsd, uint64 exp)
        internal
        returns (CommunityPool p)
    {
        vm.prank(deployer);
        p = new CommunityPool("Sec", "d", minUsd, cos, exp, address(ethFeed), _tokenConfigs(), cfg);
    }

    function _newPoolWithExtraToken(address deployer, address cfg, address tok, address feed, uint8 dec)
        internal
        returns (CommunityPool p)
    {
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](3);
        tks[0] = CommunityPool.TokenConfig({token: address(wbtc), usdFeed: address(wbtcFeed), decimals: 8});
        tks[1] = CommunityPool.TokenConfig({token: address(paxg), usdFeed: address(paxgFeed), decimals: 18});
        tks[2] = CommunityPool.TokenConfig({token: tok, usdFeed: feed, decimals: dec});
        address[] memory cos = new address[](0);
        vm.prank(deployer);
        p = new CommunityPool("Sec", "d", MIN_USD, cos, expiresAt, address(ethFeed), tks, cfg);
    }

    function _setFee(uint256 bps) internal {
        vm.prank(config.admin());
        config.setProtocolFeeBps(bps);
    }

    function _setRecipient(address r) internal {
        vm.prank(config.admin());
        config.setFeeRecipient(r);
    }

    function _fee(uint256 gross, uint256 bps) internal pure returns (uint256) {
        return (gross * bps) / BPS;
    }

    function _countEvents(Vm.Log[] memory logs, address emitter, bytes32 sig) internal pure returns (uint256 n) {
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].emitter == emitter && logs[i].topics[0] == sig) n++;
        }
    }

    /// @dev Asserts one ETH contribution's full accounting from a caller that is NOT the recipient.
    function _fundEthExpect(CommunityPool p, address from, uint256 gross, uint256 bps, address recipient) internal {
        uint256 poolBefore = address(p).balance;
        uint256 recipBefore = recipient.balance;
        uint256 fromBefore = from.balance;
        uint256 fee = _fee(gross, bps);
        vm.recordLogs();
        vm.prank(from);
        p.fund{value: gross}();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertEq(_countEvents(logs, address(p), Funded.selector), 1, "exactly one Funded");
        assertEq(address(p).balance - poolBefore, gross - fee, "pool delta == net");
        if (recipient != from) {
            assertEq(recipient.balance - recipBefore, fee, "treasury delta == fee");
            assertEq(fromBefore - from.balance, gross, "funder debited gross");
        }
    }
}
