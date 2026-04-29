// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {CommunityPool} from "../src/CommunityPool.sol";
import {MockV3Aggregator} from "./pricefeeds/V3Aggregator.sol";
import {FundCommunityPool} from "../script/Interactions.s.sol";

contract InteractionsTest is Test {
    CommunityPool internal pool;
    address internal owner = address(0xA11CE);

    function setUp() public {
        MockV3Aggregator feed = new MockV3Aggregator(8, int256(2000e8));
        address[] memory cos;
        CommunityPool.TokenConfig[] memory tks;
        vm.startPrank(owner);
        pool = new CommunityPool(
            "T", "", 5e18, cos, uint64(block.timestamp + 365 days), address(feed), tks
        );
        vm.stopPrank();
    }

    function testFundAndWithdrawInteractions() public {
        FundCommunityPool fundScript = new FundCommunityPool();
        vm.deal(address(fundScript), 1 ether);
        vm.startBroadcast(address(fundScript));
        fundScript.fundCommunityPool(address(pool));
        vm.stopBroadcast();

        uint256 beforeBal = owner.balance;
        vm.startBroadcast(owner);
        pool.cheaperWithdraw();
        vm.stopBroadcast();

        assertEq(address(pool).balance, 0);
        assertGt(owner.balance, beforeBal);
    }
}
