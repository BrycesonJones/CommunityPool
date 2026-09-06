// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {FeeSecurityBase, CommunityPool, IERC20, Vm} from "./FeeSecurityBase.sol";
import {CommunityPool__InvalidFeeRecipient, CommunityPool__NotOwner} from "../../src/CommunityPool.sol";
import {ProtocolConfig__NotAdmin} from "../../src/ProtocolConfig.sol";

/// @notice Overlapping identities. The protocol never assumes actors are distinct; these tests
/// separate ASSET FLOW (what the pool requested/sent) from FINAL PER-ADDRESS DELTA (which can
/// net out when one address plays two roles). The one hard invariant is that the pool never pulls
/// more than the user-authorized gross amount, and the one prohibited overlap is treasury == pool.
contract ProtocolFeeRoleAliasingTest is FeeSecurityBase {
    function setUp() public {
        _baseSetUp(100);
    }

    // ------------------------------------------------------------ treasury == funder

    function testTreasuryIsFunder_Eth() public {
        _setRecipient(funder);
        uint256 before = funder.balance;
        uint256 poolBefore = address(pool).balance;
        vm.prank(funder);
        vm.expectEmit(true, true, false, true, address(pool));
        emit Funded(funder, funder, 1 ether, 0.01 ether, 0.99 ether); // roles reported, not net deltas
        pool.fund{value: 1 ether}();
        assertEq(address(pool).balance - poolBefore, 0.99 ether, "asset flow: net stays");
        assertEq(before - funder.balance, 0.99 ether, "final delta: gross out, fee back => net");
    }

    function testTreasuryIsFunder_Erc20_PullsExactlyGross() public {
        _setRecipient(funder);
        address tight = makeAddr("tightFunderTreasury");
        _setRecipient(tight);
        wbtc.mint(tight, 200_000);
        vm.startPrank(tight);
        wbtc.approve(address(pool), 200_000); // exactly gross
        pool.fundERC20(IERC20(address(wbtc)), 200_000);
        vm.stopPrank();
        assertEq(wbtc.allowance(tight, address(pool)), 0, "transferFrom requested exactly gross");
        assertEq(wbtc.balanceOf(address(pool)), 198_000, "pool holds net");
        assertEq(wbtc.balanceOf(tight), 2_000, "final delta: gross out, fee back");
    }

    // ------------------------------------------------------------ treasury == owner / co-owner

    function testTreasuryIsOwner_FeeReceiptGrantsNothingExtra() public {
        _setRecipient(owner);
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        assertEq(owner.balance, 1_000 ether + 0.01 ether, "owner received the fee as recipient");
        // Owner rights come from deployment, not from being recipient; they withdraw only net.
        vm.prank(owner);
        pool.cheaperWithdraw();
        assertEq(owner.balance, 1_000 ether + 0.01 ether + 0.99 ether);
        assertEq(address(pool).balance, 0);
    }

    function testTreasuryIsCoOwner() public {
        _setRecipient(coOwner);
        vm.prank(funder);
        pool.fundERC20(IERC20(address(wbtc)), 1e8);
        assertEq(wbtc.balanceOf(coOwner), 0.01e8);
        vm.prank(coOwner);
        pool.withdrawToken(IERC20(address(wbtc)));
        assertEq(wbtc.balanceOf(coOwner), 1e8, "fee + net; nothing beyond gross ever left the funder");
    }

    // ------------------------------------------------------------ treasury == admin, admin == owner/funder

    function testTreasuryIsAdmin_StillNoPoolAuthority() public {
        _setRecipient(admin);
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        assertEq(admin.balance, 0.01 ether);
        assertFalse(pool.isOwner(admin));
        vm.prank(admin);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        pool.cheaperWithdraw();
    }

    function testAdminIsOwner_OwnerRightsComeFromDeploymentOnly() public {
        address[] memory cos = new address[](0);
        CommunityPool p = _newPool(admin, cos, address(config), MIN_USD, expiresAt);
        assertTrue(p.isOwner(admin), "explicit deployer");
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(treasuryA.balance, 0.01 ether, "fee still goes to the recipient, not the admin-owner");
        vm.prank(admin);
        p.cheaperWithdraw();
        assertEq(admin.balance, 0.99 ether);
        // Rotating admin away does not touch that pool's ownership.
        vm.prank(admin);
        config.transferAdmin(pendingAdmin);
        vm.prank(pendingAdmin);
        config.acceptAdmin();
        assertTrue(p.isOwner(admin));
        assertFalse(p.isOwner(pendingAdmin));
    }

    function testAdminIsFunder() public {
        vm.deal(admin, 10 ether);
        vm.prank(admin);
        pool.fund{value: 1 ether}();
        assertEq(treasuryA.balance, 0.01 ether);
        assertEq(address(pool).balance, 0.99 ether);
        assertFalse(pool.isOwner(admin));
    }

    function testFunderIsOwner() public {
        vm.prank(owner);
        pool.fund{value: 1 ether}();
        vm.prank(owner);
        pool.withdraw(0.99 ether);
        assertEq(address(pool).balance, 0);
        assertEq(treasuryA.balance, 0.01 ether, "owner cannot get the fee back");
    }

    // ------------------------------------------------------------ new admin == treasury

    function testNewAdminIsTreasury_FeesFollowRecipientRoleNotAdminRole() public {
        _setRecipient(pendingAdmin);
        vm.prank(admin);
        config.transferAdmin(pendingAdmin);
        vm.prank(pendingAdmin);
        config.acceptAdmin();
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        assertEq(pendingAdmin.balance, 0.01 ether, "received as recipient");
        // Move the recipient away: the admin role alone earns nothing.
        vm.prank(pendingAdmin);
        config.setFeeRecipient(treasuryB);
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        assertEq(pendingAdmin.balance, 0.01 ether, "no fee to the admin once it is not the recipient");
        assertEq(treasuryB.balance, 0.01 ether);
    }

    // ------------------------------------------------------------ prohibited overlap

    function testTreasuryIsPool_Rejected() public {
        // The official config accepts any non-zero address; the pool itself refuses to be its own
        // fee recipient on every fee-bearing path.
        _setRecipient(address(pool));
        vm.prank(funder);
        vm.expectRevert(CommunityPool__InvalidFeeRecipient.selector);
        pool.fund{value: 1 ether}();
        vm.prank(funder);
        vm.expectRevert(CommunityPool__InvalidFeeRecipient.selector);
        pool.fundERC20(IERC20(address(wbtc)), 1e8);
        // A different pool may still be a recipient (it is just an address with a receive()).
        address[] memory cos = new address[](0);
        CommunityPool other = _newPool(owner, cos, address(config), MIN_USD, expiresAt);
        _setRecipient(address(other));
        vm.prank(funder);
        vm.expectRevert(); // other pool's receive() runs fund(): 0.01 ETH is below its $5 minimum -> fee transfer fails closed
        pool.fund{value: 1 ether}();
    }

    // ------------------------------------------------------------ pending admin / treasury compromise

    function testPendingAdminHasNoAuthorityAndNoAssets() public {
        vm.prank(admin);
        config.transferAdmin(pendingAdmin);
        vm.startPrank(pendingAdmin);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setProtocolFeeBps(1);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setFeeRecipient(pendingAdmin);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        pool.cheaperWithdraw();
        vm.stopPrank();
        assertFalse(pool.isOwner(pendingAdmin));
    }

    function testTreasuryKeyCompromiseGrantsNothing() public {
        vm.prank(funder);
        pool.fund{value: 1 ether}();
        vm.startPrank(treasuryA);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setFeeRecipient(treasuryA);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setProtocolFeeBps(300);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.transferAdmin(treasuryA);
        vm.expectRevert(CommunityPool__NotOwner.selector);
        pool.cheaperWithdraw();
        vm.expectRevert(CommunityPool__NotOwner.selector);
        pool.withdrawToken(IERC20(address(wbtc)));
        vm.stopPrank();
        assertFalse(pool.isOwner(treasuryA));
        assertEq(treasuryA.balance, 0.01 ether, "holds only fees already paid");
    }
}
