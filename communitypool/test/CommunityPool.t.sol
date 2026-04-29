// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {
    CommunityPool,
    CommunityPool__BelowMinimumUsd,
    CommunityPool__InsufficientBalance,
    CommunityPool__InvalidWithdrawAmount,
    CommunityPool__NotOwner,
    CommunityPool__NotYetExpiredForRelease,
    CommunityPool__PoolExpired,
    CommunityPool__WithdrawDisabledAfterExpiry
} from "../src/CommunityPool.sol";
import {MockV3Aggregator} from "./pricefeeds/V3Aggregator.sol";
import {MockMintableERC20} from "./MockMintableERC20.sol";

contract CommunityPoolTest is Test {
    event Funded(address indexed funder, uint256 amount);
    event FundedERC20(address indexed token, address indexed funder, uint256 amount);

    receive() external payable {}

    CommunityPool internal pool;
    MockV3Aggregator internal ethFeed;
    MockV3Aggregator internal tokenFeed;
    MockMintableERC20 internal token;

    address internal constant USER = address(0xBEEF);
    uint256 internal constant SEND_VALUE = 0.1 ether;
    uint256 internal constant STARTING_BALANCE = 10 ether;
    uint64 internal expiresAt;

    function setUp() public {
        ethFeed = new MockV3Aggregator(8, int256(2000e8));
        tokenFeed = new MockV3Aggregator(8, int256(50_000e8));
        token = new MockMintableERC20("Wrapped BTC", "WBTC", 8);

        expiresAt = uint64(block.timestamp + 30 days);

        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](1);
        tks[0] = CommunityPool.TokenConfig({token: address(token), usdFeed: address(tokenFeed), decimals: 8});

        address[] memory cos = new address[](1);
        cos[0] = address(0xCAFE);

        pool = new CommunityPool("Alpha", "desc", 5e18, cos, expiresAt, address(ethFeed), tks);

        vm.deal(USER, STARTING_BALANCE);
        token.mint(USER, 1e12);
    }

    function testMinimumUsd() public view {
        assertEq(pool.minimumUsd(), 5e18);
    }

    function testDeployerIsOwnerAndCoOwner() public view {
        assertTrue(pool.isOwner(address(this)));
        assertTrue(pool.isOwner(address(0xCAFE)));
        assertEq(pool.getOwner(), address(this));
    }

    function testPriceFeedVersion() public view {
        assertGt(pool.getVersion(), 0);
    }

    function testFundEthFailsBelowMinimum() public {
        vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
        pool.fund();
    }

    function testFundEthUpdatesPoolBalance() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
        assertEq(address(pool).balance, SEND_VALUE);
    }

    function testFundEthEmitsFundedEvent() public {
        vm.expectEmit(true, false, false, true, address(pool));
        emit Funded(USER, SEND_VALUE);
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();

        vm.expectEmit(true, false, false, true, address(pool));
        emit Funded(USER, SEND_VALUE);
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();

        assertEq(address(pool).balance, SEND_VALUE * 2);
    }

    function testNonOwnerCannotWithdraw() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
        vm.expectRevert(CommunityPool__NotOwner.selector);
        vm.prank(USER);
        pool.cheaperWithdraw();
    }

    function testCoOwnerCanWithdrawEth() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
        uint256 beforeBal = address(0xCAFE).balance;
        vm.prank(address(0xCAFE));
        pool.cheaperWithdraw();
        assertEq(address(pool).balance, 0);
        assertEq(address(0xCAFE).balance, beforeBal + SEND_VALUE);
    }

    function testOwnerCanWithdrawPartialEth() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();

        uint256 partialAmount = SEND_VALUE / 2;
        uint256 beforeBal = address(0xCAFE).balance;
        vm.prank(address(0xCAFE));
        pool.withdraw(partialAmount);

        assertEq(address(pool).balance, SEND_VALUE - partialAmount);
        assertEq(address(0xCAFE).balance, beforeBal + partialAmount);
    }

    function testOwnerCanWithdrawExactFullEthWithAmountFunction() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();

        uint256 beforeBal = address(0xCAFE).balance;
        vm.prank(address(0xCAFE));
        pool.withdraw(SEND_VALUE);

        assertEq(address(pool).balance, 0);
        assertEq(address(0xCAFE).balance, beforeBal + SEND_VALUE);
    }

    function testWithdrawEthRevertsWhenAmountExceedsPoolBalance() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();

        vm.expectRevert(CommunityPool__InsufficientBalance.selector);
        vm.prank(address(0xCAFE));
        pool.withdraw(SEND_VALUE + 1);
    }

    function testWithdrawEthRevertsOnZeroAmount() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();

        vm.expectRevert(CommunityPool__InvalidWithdrawAmount.selector);
        vm.prank(address(0xCAFE));
        pool.withdraw(0);
    }

    function testFundErc20() public {
        uint256 amt = 200_000;
        vm.startPrank(USER);
        token.approve(address(pool), amt);
        vm.expectEmit(true, true, false, true, address(pool));
        emit FundedERC20(address(token), USER, amt);
        pool.fundERC20(token, amt);
        vm.stopPrank();
        assertEq(token.balanceOf(address(pool)), amt);
    }

    function testFundErc20FailsBelowMinimum() public {
        vm.startPrank(USER);
        token.approve(address(pool), 1);
        vm.expectRevert(CommunityPool__BelowMinimumUsd.selector);
        pool.fundERC20(token, 1);
        vm.stopPrank();
    }

    function testFundingBlockedAfterExpiry() public {
        vm.warp(expiresAt + 1);
        vm.expectRevert(CommunityPool__PoolExpired.selector);
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
    }

    function testWithdrawTokenByCoOwner() public {
        uint256 amt = 200_000;
        vm.startPrank(USER);
        token.approve(address(pool), amt);
        pool.fundERC20(token, amt);
        vm.stopPrank();

        vm.prank(address(0xCAFE));
        pool.withdrawToken(token);
        assertEq(token.balanceOf(address(0xCAFE)), amt);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function testWithdrawTokenAmountPartialByCoOwner() public {
        uint256 amt = 200_000;
        vm.startPrank(USER);
        token.approve(address(pool), amt);
        pool.fundERC20(token, amt);
        vm.stopPrank();

        uint256 partialAmount = 50_000;
        vm.prank(address(0xCAFE));
        pool.withdrawTokenAmount(token, partialAmount);

        assertEq(token.balanceOf(address(0xCAFE)), partialAmount);
        assertEq(token.balanceOf(address(pool)), amt - partialAmount);
    }

    function testWithdrawTokenAmountRevertsWhenAmountExceedsBalance() public {
        uint256 amt = 200_000;
        vm.startPrank(USER);
        token.approve(address(pool), amt);
        pool.fundERC20(token, amt);
        vm.stopPrank();

        vm.expectRevert(CommunityPool__InsufficientBalance.selector);
        vm.prank(address(0xCAFE));
        pool.withdrawTokenAmount(token, amt + 1);
    }

    function testWithdrawTokenAmountRevertsOnZeroAmount() public {
        uint256 amt = 200_000;
        vm.startPrank(USER);
        token.approve(address(pool), amt);
        pool.fundERC20(token, amt);
        vm.stopPrank();

        vm.expectRevert(CommunityPool__InvalidWithdrawAmount.selector);
        vm.prank(address(0xCAFE));
        pool.withdrawTokenAmount(token, 0);
    }

    function testReleaseRevertsBeforeExpiry() public {
        vm.expectRevert(CommunityPool__NotYetExpiredForRelease.selector);
        pool.releaseExpiredFundsToDeployer();
    }

    function testReleaseAfterExpirySendsEthToDeployer() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();

        vm.warp(expiresAt + 1);
        uint256 deployerBefore = address(this).balance;
        vm.prank(USER);
        pool.releaseExpiredFundsToDeployer();
        assertEq(address(pool).balance, 0);
        assertEq(address(this).balance, deployerBefore + SEND_VALUE);
    }

    function testCheaperWithdrawRevertsAfterExpiry() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
        vm.warp(expiresAt + 1);
        vm.expectRevert(CommunityPool__WithdrawDisabledAfterExpiry.selector);
        vm.prank(address(0xCAFE));
        pool.cheaperWithdraw();
    }

    function testWithdrawTokenRevertsAfterExpiry() public {
        uint256 amt = 200_000;
        vm.startPrank(USER);
        token.approve(address(pool), amt);
        pool.fundERC20(token, amt);
        vm.stopPrank();

        vm.warp(expiresAt + 1);
        vm.expectRevert(CommunityPool__WithdrawDisabledAfterExpiry.selector);
        vm.prank(address(0xCAFE));
        pool.withdrawToken(token);
    }

    function testReleaseAfterExpirySendsErc20ToDeployer() public {
        uint256 amt = 200_000;
        vm.startPrank(USER);
        token.approve(address(pool), amt);
        pool.fundERC20(token, amt);
        vm.stopPrank();

        vm.warp(expiresAt + 1);
        pool.releaseExpiredFundsToDeployer();
        assertEq(token.balanceOf(address(this)), amt);
        assertEq(token.balanceOf(address(pool)), 0);
    }

    function testReleaseIdempotentAfterFullSweep() public {
        vm.prank(USER);
        pool.fund{value: SEND_VALUE}();
        vm.warp(expiresAt + 1);
        vm.prank(USER);
        pool.releaseExpiredFundsToDeployer();
        vm.prank(USER);
        pool.releaseExpiredFundsToDeployer();
        assertEq(address(pool).balance, 0);
    }
}
