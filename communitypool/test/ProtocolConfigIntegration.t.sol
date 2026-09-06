// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {
    CommunityPool,
    CommunityPool__NotOwner,
    CommunityPool__ProtocolConfigNotContract,
    CommunityPool__ZeroAddress
} from "../src/CommunityPool.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockV3Aggregator} from "./pricefeeds/V3Aggregator.sol";
import {MockMintableERC20} from "./MockMintableERC20.sol";

/// @notice CommunityPool <-> ProtocolConfig integration for the V2 candidate:
///   - pools read the SHARED config live (no per-pool snapshot)
///   - funding economics are byte-for-byte V1: 100% stays in the pool, the treasury gets nothing
///   - control-plane authority (config admin / fee recipient) implies no pool asset authority
contract ProtocolConfigIntegrationTest is Test {
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

    address internal protocolAdmin = makeAddr("protocolAdmin");
    address internal treasuryA = makeAddr("treasuryA");
    address internal treasuryB = makeAddr("treasuryB");
    address internal poolDeployer = makeAddr("poolDeployer");
    address internal funder = makeAddr("funder");

    uint256 internal constant INITIAL_FEE_BPS = 100; // 1% represented as configuration only

    ProtocolConfig internal config;
    MockV3Aggregator internal ethFeed;
    MockV3Aggregator internal tokenFeed;
    MockMintableERC20 internal token;
    uint64 internal expiresAt;

    CommunityPool internal poolA;
    CommunityPool internal poolB;

    function setUp() public {
        config = new ProtocolConfig(protocolAdmin, treasuryA, INITIAL_FEE_BPS);
        ethFeed = new MockV3Aggregator(8, int256(2000e8));
        tokenFeed = new MockV3Aggregator(8, int256(60_000e8)); // WBTC-like
        token = new MockMintableERC20("Wrapped BTC", "WBTC", 8);
        expiresAt = uint64(block.timestamp + 30 days);

        vm.startPrank(poolDeployer);
        poolA = _deployPool("Alpha");
        poolB = _deployPool("Beta");
        vm.stopPrank();

        vm.deal(funder, 10 ether);
        token.mint(funder, 1_000_000_000); // 10 WBTC (8 decimals)
    }

    function _tokenConfigs() internal view returns (CommunityPool.TokenConfig[] memory tks) {
        tks = new CommunityPool.TokenConfig[](1);
        tks[0] = CommunityPool.TokenConfig({token: address(token), usdFeed: address(tokenFeed), decimals: 8});
    }

    function _deployPool(string memory name) internal returns (CommunityPool) {
        address[] memory cos = new address[](0);
        return new CommunityPool(name, "desc", 5e18, cos, expiresAt, address(ethFeed), _tokenConfigs(), address(config));
    }

    // ------------------------------------------------------------------ constructor binding

    function testPoolStoresImmutableConfigReference() public view {
        assertEq(address(poolA.protocolConfig()), address(config));
        assertEq(address(poolB.protocolConfig()), address(config));
    }

    function testConstructorRejectsZeroConfig() public {
        address[] memory cos = new address[](0);
        vm.expectRevert(CommunityPool__ZeroAddress.selector);
        new CommunityPool("Z", "d", 5e18, cos, expiresAt, address(ethFeed), _tokenConfigs(), address(0));
    }

    function testConstructorRejectsConfigWithoutCode() public {
        address[] memory cos = new address[](0);
        address eoa = makeAddr("notAContract");
        assertEq(eoa.code.length, 0);
        vm.expectRevert(CommunityPool__ProtocolConfigNotContract.selector);
        new CommunityPool("E", "d", 5e18, cos, expiresAt, address(ethFeed), _tokenConfigs(), eoa);
    }

    function testPoolCreatedEventCarriesConfigAddress() public {
        address[] memory cos = new address[](0);
        address[] memory toks = new address[](1);
        toks[0] = address(token);
        vm.prank(poolDeployer);
        vm.expectEmit(true, true, false, true);
        emit PoolCreated(poolDeployer, "Gamma", "desc", 5e18, expiresAt, cos, toks, address(config));
        new CommunityPool("Gamma", "desc", 5e18, cos, expiresAt, address(ethFeed), _tokenConfigs(), address(config));
    }

    // ------------------------------------------------------------------ shared dynamic reads

    function testBothPoolsReadSharedConfigLive() public {
        (uint256 feeA, address recA) = poolA.getProtocolFeeConfig();
        (uint256 feeB, address recB) = poolB.getProtocolFeeConfig();
        assertEq(feeA, 100);
        assertEq(feeB, 100);
        assertEq(recA, treasuryA);
        assertEq(recB, treasuryA);

        // One admin change on the shared config, no interaction with either pool.
        vm.startPrank(protocolAdmin);
        config.setProtocolFeeBps(75);
        config.setFeeRecipient(treasuryB);
        vm.stopPrank();

        (feeA, recA) = poolA.getProtocolFeeConfig();
        (feeB, recB) = poolB.getProtocolFeeConfig();
        assertEq(feeA, 75, "pool A must observe the new fee without redeploy");
        assertEq(feeB, 75, "pool B must observe the new fee without redeploy");
        assertEq(recA, treasuryB);
        assertEq(recB, treasuryB);

        // And back to zero: a pool never caches anything.
        vm.prank(protocolAdmin);
        config.setProtocolFeeBps(0);
        (feeA,) = poolA.getProtocolFeeConfig();
        (feeB,) = poolB.getProtocolFeeConfig();
        assertEq(feeA, 0);
        assertEq(feeB, 0);
    }

    function testPoolsFollowAdminRotation() public {
        address newAdmin = makeAddr("safeMultisig");
        vm.prank(protocolAdmin);
        config.transferAdmin(newAdmin);
        vm.prank(newAdmin);
        config.acceptAdmin();
        vm.prank(newAdmin);
        config.setProtocolFeeBps(300);
        (uint256 feeA,) = poolA.getProtocolFeeConfig();
        assertEq(feeA, 300);
        // Rotating the config admin creates no pool authority for either admin.
        assertFalse(poolA.isOwner(newAdmin));
        assertFalse(poolA.isOwner(protocolAdmin));
    }

    // ------------------------------------------------------------------ economics unchanged

    function testEthFundingRetainsOneHundredPercentDespiteConfiguredFee() public {
        assertEq(config.protocolFeeBps(), 100, "1% is configured");
        uint256 treasuryBefore = treasuryA.balance;
        uint256 funderBefore = funder.balance;

        vm.prank(funder);
        poolA.fund{value: 0.1 ether}();

        assertEq(address(poolA).balance, 0.1 ether, "pool must receive the full contribution");
        assertEq(treasuryA.balance, treasuryBefore, "treasury must receive nothing");
        assertEq(funder.balance, funderBefore - 0.1 ether, "funder debited exactly the contribution");
    }

    function testEthFundingViaReceiveRetainsOneHundredPercent() public {
        uint256 treasuryBefore = treasuryA.balance;
        vm.prank(funder);
        (bool ok,) = address(poolB).call{value: 0.1 ether}("");
        assertTrue(ok);
        assertEq(address(poolB).balance, 0.1 ether);
        assertEq(treasuryA.balance, treasuryBefore);
    }

    function testErc20FundingRetainsOneHundredPercentDespiteConfiguredFee() public {
        uint256 amount = 200_000; // 0.002 WBTC ~= $120 at $60k, above the $5 minimum
        uint256 treasuryBefore = token.balanceOf(treasuryA);
        uint256 funderBefore = token.balanceOf(funder);

        vm.startPrank(funder);
        token.approve(address(poolA), amount);
        poolA.fundERC20(IERC20(address(token)), amount);
        vm.stopPrank();

        assertEq(token.balanceOf(address(poolA)), amount, "pool must hold the full token amount");
        assertEq(token.balanceOf(treasuryA), treasuryBefore, "treasury token balance unchanged");
        assertEq(token.balanceOf(funder), funderBefore - amount, "funder debited exactly the amount");
    }

    function testMaxFeeConfiguredStillMovesNothing() public {
        vm.prank(protocolAdmin);
        config.setProtocolFeeBps(300);
        uint256 treasuryBefore = treasuryA.balance;
        vm.prank(funder);
        poolA.fund{value: 1 ether}();
        assertEq(address(poolA).balance, 1 ether);
        assertEq(treasuryA.balance, treasuryBefore);
    }

    // ------------------------------------------------------------------ authority isolation

    function testConfigAdminIsNotPoolOwner() public view {
        assertFalse(poolA.isOwner(protocolAdmin));
        assertFalse(poolB.isOwner(protocolAdmin));
        assertTrue(poolA.isOwner(poolDeployer));
    }

    function testFeeRecipientIsNotPoolOwner() public view {
        assertFalse(poolA.isOwner(treasuryA));
        assertFalse(poolB.isOwner(treasuryA));
    }

    function testConfigAdminCannotWithdrawEth() public {
        vm.prank(funder);
        poolA.fund{value: 1 ether}();

        vm.startPrank(protocolAdmin);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        poolA.withdraw(0.5 ether);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        poolA.cheaperWithdraw();
        vm.stopPrank();

        assertEq(address(poolA).balance, 1 ether, "nothing left the pool");
    }

    function testConfigAdminCannotWithdrawErc20() public {
        vm.startPrank(funder);
        token.approve(address(poolA), 200_000);
        poolA.fundERC20(IERC20(address(token)), 200_000);
        vm.stopPrank();

        vm.startPrank(protocolAdmin);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        poolA.withdrawToken(IERC20(address(token)));
        vm.expectRevert(CommunityPool__NotOwner.selector);
        poolA.withdrawTokenAmount(IERC20(address(token)), 1);
        vm.stopPrank();

        assertEq(token.balanceOf(address(poolA)), 200_000);
    }

    function testFeeRecipientCannotWithdraw() public {
        vm.prank(funder);
        poolA.fund{value: 1 ether}();
        vm.startPrank(treasuryA);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        poolA.cheaperWithdraw();
        vm.expectRevert(CommunityPool__NotOwner.selector);
        poolA.withdrawToken(IERC20(address(token)));
        vm.stopPrank();
    }

    function testExplicitCoOwnershipIsTheOnlyPathToPoolAuthority() public {
        // A deployer may deliberately list any address, including the config admin, as a
        // co-owner. That is pool-level consent, not something the config grants.
        address[] memory cos = new address[](1);
        cos[0] = protocolAdmin;
        vm.prank(poolDeployer);
        CommunityPool consenting =
            new CommunityPool("Consent", "d", 5e18, cos, expiresAt, address(ethFeed), _tokenConfigs(), address(config));
        assertTrue(consenting.isOwner(protocolAdmin));
        // ...and that grant does not leak to the other pools sharing the same config.
        assertFalse(poolA.isOwner(protocolAdmin));
    }

    function testConfigHasNoPathToPoolAssets() public {
        vm.prank(funder);
        poolA.fund{value: 1 ether}();
        // The config contract itself is not an owner and holds no reference to any pool.
        assertFalse(poolA.isOwner(address(config)));
        vm.prank(address(config));
        vm.expectRevert(CommunityPool__NotOwner.selector);
        poolA.cheaperWithdraw();
    }
}
