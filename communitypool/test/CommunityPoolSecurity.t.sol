// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {
    CommunityPool,
    CommunityPool__DuplicateOwner,
    CommunityPool__NotOwner
} from "../src/CommunityPool.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockV3Aggregator} from "./pricefeeds/V3Aggregator.sol";
import {MockMintableERC20} from "./MockMintableERC20.sol";

/// @notice Validates the v1 owner model and the gas budget of the withdraw/release paths after the
/// per-funder accounting was removed (gas review F-1). The funder-spam tests are the regression
/// guard: under the legacy reset-loop these calls grew O(funders); under the current contract they
/// are constant-cost in the funder count.
contract CommunityPoolSecurityTest is Test {
    receive() external payable {}

    CommunityPool internal pool;
    MockV3Aggregator internal ethFeed;
    MockV3Aggregator internal wbtcFeed;
    MockMintableERC20 internal wbtc;

    address internal constant CO_OWNER = address(0xCAFE);
    address internal constant USER = address(0xBEEF);
    uint256 internal constant SEND_VALUE = 0.1 ether; // ~$200 @ $2k/ETH
    uint64 internal expiresAt;

    function setUp() public {
        ethFeed = new MockV3Aggregator(8, int256(2000e8));
        wbtcFeed = new MockV3Aggregator(8, int256(50_000e8));
        wbtc = new MockMintableERC20("Wrapped BTC", "WBTC", 8);

        expiresAt = uint64(block.timestamp + 30 days);

        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](1);
        tks[0] = CommunityPool.TokenConfig({token: address(wbtc), usdFeed: address(wbtcFeed), decimals: 8});

        address[] memory cos = new address[](1);
        cos[0] = CO_OWNER;

        pool = new CommunityPool("Sec", "desc", 5e18, cos, expiresAt, address(ethFeed), tks);

        vm.deal(USER, 10 ether);
        wbtc.mint(USER, 1e12);
    }

    /* ---------------------------------------- no funder loop in withdraw/release */

    /// @dev Spam many distinct ETH funders, then assert that a full-balance owner withdraw uses
    /// bounded gas. Under the prior reset loop this cost ~5k gas per funder in zero-out SSTOREs;
    /// after the F-1 fix the cost is constant in funder count.
    function testFunderSpamDoesNotLoopOnFullEthWithdraw() public {
        uint256 each = 0.005 ether; // ~$10 @ $2k/ETH > $5 minimum
        uint256 spam = 200;
        for (uint256 i = 0; i < spam; i++) {
            address f = address(uint160(0x1000 + i));
            vm.deal(f, each);
            vm.prank(f);
            pool.fund{value: each}();
        }

        assertEq(address(pool).balance, each * spam);

        uint256 g0 = gasleft();
        vm.prank(CO_OWNER);
        pool.cheaperWithdraw();
        uint256 used = g0 - gasleft();

        assertEq(address(pool).balance, 0);
        // 200 × 5k ≈ 1_000_000 gas just to reset funder records under the legacy code.
        assertLt(used, 200_000);
    }

    function testFunderSpamDoesNotLoopOnExpirySweep() public {
        uint256 each = 0.005 ether;
        uint256 spam = 200;
        for (uint256 i = 0; i < spam; i++) {
            address f = address(uint160(0x2000 + i));
            vm.deal(f, each);
            vm.prank(f);
            pool.fund{value: each}();
        }

        vm.warp(expiresAt + 1);
        uint256 g0 = gasleft();
        pool.releaseExpiredFundsToDeployer();
        uint256 used = g0 - gasleft();

        assertEq(address(pool).balance, 0);
        // The token leg is bounded by the constructor-set whitelist (1 token here).
        // Stays well under any plausible O(funders) reset cost.
        assertLt(used, 300_000);
    }

    /* ---------------------------------------- v1 owner model */

    function testConstructorCoOwnersAreOwners() public view {
        assertTrue(pool.isOwner(address(this))); // deployer
        assertTrue(pool.isOwner(CO_OWNER));
        assertFalse(pool.isOwner(USER));
    }

    function testConstructorRejectsDuplicateCoOwner() public {
        address[] memory cos = new address[](2);
        cos[0] = CO_OWNER;
        cos[1] = CO_OWNER;
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](0);
        vm.expectRevert(CommunityPool__DuplicateOwner.selector);
        new CommunityPool("Dup", "d", 5e18, cos, expiresAt, address(ethFeed), tks);
    }

    function testConstructorRejectsDeployerAsCoOwner() public {
        address[] memory cos = new address[](1);
        cos[0] = address(this); // deployer listed again
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](0);
        vm.expectRevert(CommunityPool__DuplicateOwner.selector);
        new CommunityPool("Dup", "d", 5e18, cos, expiresAt, address(ethFeed), tks);
    }

    function testNoAddOwnerExistsPostDeploy() public {
        // No on-chain path to add owners post-deploy: a non-listed account stays a non-owner forever.
        assertFalse(pool.isOwner(USER));
        vm.prank(USER);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        pool.cheaperWithdraw();
    }

    /* ---------------------------------------- partial withdraws (sanity) */

    function testOwnerPartialEthWithdrawWorks() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
        uint256 partialAmt = SEND_VALUE / 4;
        uint256 before_ = CO_OWNER.balance;
        vm.prank(CO_OWNER);
        pool.withdraw(partialAmt);
        assertEq(CO_OWNER.balance, before_ + partialAmt);
        assertEq(address(pool).balance, SEND_VALUE - partialAmt);
    }

    function testOwnerPartialErc20WithdrawWorks() public {
        vm.startPrank(USER);
        wbtc.approve(address(pool), 200_000);
        pool.fundERC20(IERC20(address(wbtc)), 200_000);
        vm.stopPrank();

        vm.prank(CO_OWNER);
        pool.withdrawTokenAmount(IERC20(address(wbtc)), 50_000);
        assertEq(wbtc.balanceOf(CO_OWNER), 50_000);
        assertEq(wbtc.balanceOf(address(pool)), 150_000);
    }

    function testNonOwnerCannotPartialWithdraw() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
        vm.expectRevert(CommunityPool__NotOwner.selector);
        vm.prank(USER);
        pool.withdraw(0.01 ether);
    }
}
