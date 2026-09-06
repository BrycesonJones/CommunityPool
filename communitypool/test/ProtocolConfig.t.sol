// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {
    ProtocolConfig,
    ProtocolConfig__FeeExceedsMaximum,
    ProtocolConfig__NotAdmin,
    ProtocolConfig__NotPendingAdmin,
    ProtocolConfig__ZeroAddress
} from "../src/ProtocolConfig.sol";
import {IProtocolConfig} from "../src/interfaces/IProtocolConfig.sol";

/// @dev A contract recipient stand-in (a future treasury may be a Safe). Has code; that is all
/// the config needs to accept it.
contract TreasuryContractStub {
    receive() external payable {}
}

/// @notice Unit coverage for ProtocolConfig: constructor validation, the 300 bps hard cap, fee
/// recipient administration, and the two-step admin handoff. Uses deterministic fixture
/// addresses; the intended mainnet admin/treasury addresses are deployment-time values and are
/// deliberately not referenced here.
contract ProtocolConfigTest is Test {
    event ProtocolFeeUpdated(uint256 previousFeeBps, uint256 newFeeBps);
    event FeeRecipientUpdated(address indexed previousRecipient, address indexed newRecipient);
    event AdminTransferStarted(address indexed currentAdmin, address indexed pendingAdmin);
    event AdminTransferred(address indexed previousAdmin, address indexed newAdmin);

    address internal admin = makeAddr("protocolAdmin");
    address internal treasury = makeAddr("treasury");
    address internal stranger = makeAddr("stranger");
    address internal successor = makeAddr("successorAdmin");

    uint256 internal constant INITIAL_FEE_BPS = 100; // 1%

    ProtocolConfig internal config;

    function setUp() public {
        config = new ProtocolConfig(admin, treasury, INITIAL_FEE_BPS);
    }

    // ------------------------------------------------------------------ constructor

    function testConstructorStoresAdmin() public view {
        assertEq(config.admin(), admin);
        assertEq(config.pendingAdmin(), address(0));
    }

    function testConstructorStoresRecipient() public view {
        assertEq(config.feeRecipient(), treasury);
    }

    function testConstructorStoresInitialFee() public view {
        assertEq(config.protocolFeeBps(), INITIAL_FEE_BPS);
    }

    function testConstants() public view {
        assertEq(config.BPS_DENOMINATOR(), 10_000);
        assertEq(config.MAX_PROTOCOL_FEE_BPS(), 300);
    }

    function testConstructorEmitsInitialState() public {
        vm.expectEmit(true, true, false, true);
        emit AdminTransferred(address(0), admin);
        vm.expectEmit(true, true, false, true);
        emit FeeRecipientUpdated(address(0), treasury);
        vm.expectEmit(false, false, false, true);
        emit ProtocolFeeUpdated(0, 50);
        new ProtocolConfig(admin, treasury, 50);
    }

    function testConstructorRejectsZeroAdmin() public {
        vm.expectRevert(ProtocolConfig__ZeroAddress.selector);
        new ProtocolConfig(address(0), treasury, INITIAL_FEE_BPS);
    }

    function testConstructorRejectsZeroRecipient() public {
        vm.expectRevert(ProtocolConfig__ZeroAddress.selector);
        new ProtocolConfig(admin, address(0), INITIAL_FEE_BPS);
    }

    function testConstructorRejectsFeeAboveMaximum() public {
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig__FeeExceedsMaximum.selector, 301, 300));
        new ProtocolConfig(admin, treasury, 301);
    }

    function testConstructorAcceptsBoundaryFees() public {
        assertEq(new ProtocolConfig(admin, treasury, 0).protocolFeeBps(), 0);
        assertEq(new ProtocolConfig(admin, treasury, 300).protocolFeeBps(), 300);
    }

    function testImplementsIProtocolConfig() public view {
        IProtocolConfig viewOnly = IProtocolConfig(address(config));
        assertEq(viewOnly.protocolFeeBps(), INITIAL_FEE_BPS);
        assertEq(viewOnly.feeRecipient(), treasury);
    }

    // ------------------------------------------------------------------ fee administration

    function testAdminSetsFeeWithinRange() public {
        uint256[4] memory allowed = [uint256(0), 1, 100, 300];
        for (uint256 i = 0; i < allowed.length; i++) {
            uint256 previous = config.protocolFeeBps();
            vm.prank(admin);
            vm.expectEmit(false, false, false, true);
            emit ProtocolFeeUpdated(previous, allowed[i]);
            config.setProtocolFeeBps(allowed[i]);
            assertEq(config.protocolFeeBps(), allowed[i]);
        }
    }

    function testFeeAboveMaximumRevertsInSolidity() public {
        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig__FeeExceedsMaximum.selector, 301, 300));
        config.setProtocolFeeBps(301);

        vm.prank(admin);
        vm.expectRevert(abi.encodeWithSelector(ProtocolConfig__FeeExceedsMaximum.selector, 10_000, 300));
        config.setProtocolFeeBps(10_000);

        assertEq(config.protocolFeeBps(), INITIAL_FEE_BPS, "fee must be unchanged after rejected updates");
    }

    function testFuzzFeeNeverExceedsMaximum(uint256 bps) public {
        vm.prank(admin);
        if (bps > 300) {
            vm.expectRevert(abi.encodeWithSelector(ProtocolConfig__FeeExceedsMaximum.selector, bps, 300));
            config.setProtocolFeeBps(bps);
            assertEq(config.protocolFeeBps(), INITIAL_FEE_BPS);
        } else {
            config.setProtocolFeeBps(bps);
            assertEq(config.protocolFeeBps(), bps);
        }
        assertLe(config.protocolFeeBps(), config.MAX_PROTOCOL_FEE_BPS());
    }

    function testNonAdminCannotSetFee() public {
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setProtocolFeeBps(50);

        // The fee recipient is not an administrator either.
        vm.prank(treasury);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setProtocolFeeBps(50);
    }

    // ------------------------------------------------------------------ recipient administration

    function testAdminSetsRecipientEoa() public {
        address newTreasury = makeAddr("treasury2");
        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit FeeRecipientUpdated(treasury, newTreasury);
        config.setFeeRecipient(newTreasury);
        assertEq(config.feeRecipient(), newTreasury);
    }

    function testAdminSetsRecipientContract() public {
        TreasuryContractStub safe = new TreasuryContractStub();
        assertGt(address(safe).code.length, 0);
        vm.prank(admin);
        config.setFeeRecipient(address(safe));
        assertEq(config.feeRecipient(), address(safe));
    }

    function testNonAdminCannotSetRecipient() public {
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setFeeRecipient(stranger);
    }

    function testZeroRecipientRejected() public {
        vm.prank(admin);
        vm.expectRevert(ProtocolConfig__ZeroAddress.selector);
        config.setFeeRecipient(address(0));
    }

    // ------------------------------------------------------------------ two-step admin handoff

    function testTransferAdminRecordsPendingWithoutTransferring() public {
        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit AdminTransferStarted(admin, successor);
        config.transferAdmin(successor);

        assertEq(config.pendingAdmin(), successor);
        assertEq(config.admin(), admin, "authority must not move on proposal");
    }

    function testOldAdminRemainsActiveBeforeAcceptance() public {
        vm.prank(admin);
        config.transferAdmin(successor);
        vm.prank(admin);
        config.setProtocolFeeBps(42);
        assertEq(config.protocolFeeBps(), 42);
    }

    function testPendingAdminCannotAdministerBeforeAcceptance() public {
        vm.prank(admin);
        config.transferAdmin(successor);

        vm.startPrank(successor);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setProtocolFeeBps(42);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setFeeRecipient(successor);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.transferAdmin(stranger);
        vm.stopPrank();
    }

    function testRandomAccountCannotAccept() public {
        vm.prank(admin);
        config.transferAdmin(successor);
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig__NotPendingAdmin.selector);
        config.acceptAdmin();
        // The current admin cannot "accept" on the successor's behalf either.
        vm.prank(admin);
        vm.expectRevert(ProtocolConfig__NotPendingAdmin.selector);
        config.acceptAdmin();
    }

    function testAcceptWithNoPendingProposalReverts() public {
        vm.prank(stranger);
        vm.expectRevert(ProtocolConfig__NotPendingAdmin.selector);
        config.acceptAdmin();
    }

    function testPendingAdminAcceptsAndAuthorityMoves() public {
        vm.prank(admin);
        config.transferAdmin(successor);

        vm.prank(successor);
        vm.expectEmit(true, true, false, true);
        emit AdminTransferred(admin, successor);
        config.acceptAdmin();

        assertEq(config.admin(), successor);
        assertEq(config.pendingAdmin(), address(0), "pending must reset");

        // New admin has authority.
        vm.prank(successor);
        config.setProtocolFeeBps(7);
        assertEq(config.protocolFeeBps(), 7);

        // Old admin has none.
        vm.startPrank(admin);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.setProtocolFeeBps(8);
        vm.expectRevert(ProtocolConfig__NotAdmin.selector);
        config.transferAdmin(admin);
        vm.stopPrank();

        // Acceptance is single-use.
        vm.prank(successor);
        vm.expectRevert(ProtocolConfig__NotPendingAdmin.selector);
        config.acceptAdmin();
    }

    function testZeroPendingAdminRejected() public {
        vm.prank(admin);
        vm.expectRevert(ProtocolConfig__ZeroAddress.selector);
        config.transferAdmin(address(0));
    }

    function testProposalCanBeOverwrittenByAdmin() public {
        address other = makeAddr("otherSuccessor");
        vm.startPrank(admin);
        config.transferAdmin(successor);
        config.transferAdmin(other);
        vm.stopPrank();
        assertEq(config.pendingAdmin(), other);
        vm.prank(successor);
        vm.expectRevert(ProtocolConfig__NotPendingAdmin.selector);
        config.acceptAdmin();
    }

    // ------------------------------------------------------------------ no custody surface

    function testConfigRejectsEth() public {
        vm.deal(stranger, 1 ether);
        vm.prank(stranger);
        (bool ok,) = address(config).call{value: 1 ether}("");
        assertFalse(ok, "ProtocolConfig must not accept ETH");
        assertEq(address(config).balance, 0);
    }
}
