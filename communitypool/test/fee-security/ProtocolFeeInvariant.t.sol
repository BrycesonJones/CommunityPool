// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test, StdInvariant} from "forge-std/Test.sol";
import {CommunityPool} from "../../src/CommunityPool.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockV3Aggregator} from "../pricefeeds/V3Aggregator.sol";
import {MockMintableERC20} from "../MockMintableERC20.sol";

/// @notice Stateful handler: random sequences of funding (ETH via fund/receive/fallback, ERC-20),
/// configuration changes, two-step admin rotation, owner withdrawals, time travel, and expiry
/// release, from distinct actors. Ghost accounting reconciles lifetime gross/fee/net against the
/// pool, treasuries, owners and the deployer. Treasuries are pure recipients (they never fund or
/// withdraw), so their balances equal the lifetime fees paid to them exactly.
contract FeeHandler is Test {
    CommunityPool public pool;
    ProtocolConfig public config;
    MockMintableERC20 public token;
    uint64 public expiresAt;

    address public owner; // deployer
    address public coOwner;
    address[2] public funders;
    address public attacker;
    address[2] public admins; // A (initial) and B (rotation target)
    address[2] public treasuries; // A and B, EOAs

    // ghost accounting
    uint256 public totalGrossEth;
    uint256 public totalFeeEth;
    uint256 public totalNetEth;
    uint256 public ownerEthOut;
    uint256 public releaseEthOut;
    uint256 public totalGrossTok;
    uint256 public totalFeeTok;
    uint256 public totalNetTok;
    uint256 public ownerTokOut;
    uint256 public releaseTokOut;
    mapping(address => uint256) public feeEthTo;
    mapping(address => uint256) public feeTokTo;
    uint256 public contributions;
    uint256 public rejectedContributions;
    uint256 public maxObservedFeeBps;
    uint256 public unauthorizedAttempts;
    uint256 public adminRotations;

    constructor(CommunityPool p, ProtocolConfig c, MockMintableERC20 t, uint64 exp, address o, address co) {
        pool = p;
        config = c;
        token = t;
        expiresAt = exp;
        owner = o;
        coOwner = co;
        funders = [makeAddr("hFunderA"), makeAddr("hFunderB")];
        attacker = makeAddr("hAttacker");
        admins = [c.admin(), makeAddr("hAdminB")];
        treasuries = [c.feeRecipient(), makeAddr("hTreasuryB")];
        for (uint256 i = 0; i < 2; i++) {
            vm.deal(funders[i], 1_000_000 ether);
            token.mint(funders[i], 1e30);
            vm.prank(funders[i]);
            token.approve(address(pool), type(uint256).max);
        }
        vm.deal(attacker, 1_000 ether);
        token.mint(attacker, 1e24);
        vm.prank(attacker);
        token.approve(address(pool), type(uint256).max);
    }

    function _fee(uint256 gross) internal view returns (uint256) {
        return (gross * config.protocolFeeBps()) / 10_000;
    }

    function _expired() internal view returns (bool) {
        return block.timestamp > expiresAt;
    }

    // ---------------------------------------------------------------- funding

    function fundEth(uint8 who, uint96 amountRaw, uint8 path) external {
        address f = funders[who % 2];
        uint256 gross = bound(uint256(amountRaw), 1, 100 ether);
        uint256 bps = config.protocolFeeBps();
        address recipient = config.feeRecipient();
        uint256 fee = _fee(gross);
        uint256 poolBefore = address(pool).balance;
        uint256 recipBefore = recipient.balance;
        vm.prank(f);
        bool ok;
        if (path % 3 == 0) {
            (ok,) = address(pool).call{value: gross}(abi.encodeWithSelector(pool.fund.selector));
        } else if (path % 3 == 1) {
            (ok,) = address(pool).call{value: gross}("");
        } else {
            (ok,) = address(pool).call{value: gross}(hex"deadbeef");
        }
        if (!ok) {
            rejectedContributions++;
            assertEq(address(pool).balance, poolBefore, "rejected ETH: pool unchanged");
            assertEq(recipient.balance, recipBefore, "rejected ETH: treasury unchanged");
            return;
        }
        assertFalse(_expired(), "funding must not succeed after expiry");
        assertLe(bps, 300, "observed rate within cap");
        if (bps > maxObservedFeeBps) maxObservedFeeBps = bps;
        assertEq(address(pool).balance - poolBefore, gross - fee, "ETH pool delta == net");
        assertEq(recipient.balance - recipBefore, fee, "ETH treasury delta == fee");
        totalGrossEth += gross;
        totalFeeEth += fee;
        totalNetEth += gross - fee;
        feeEthTo[recipient] += fee;
        contributions++;
    }

    function fundToken(uint8 who, uint96 amountRaw) external {
        address f = funders[who % 2];
        uint256 gross = bound(uint256(amountRaw), 1, 1e22);
        address recipient = config.feeRecipient();
        uint256 fee = _fee(gross);
        uint256 poolBefore = token.balanceOf(address(pool));
        uint256 recipBefore = token.balanceOf(recipient);
        uint256 fBefore = token.balanceOf(f);
        vm.prank(f);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(pool.fundERC20.selector, token, gross));
        if (!ok) {
            rejectedContributions++;
            assertEq(token.balanceOf(address(pool)), poolBefore, "rejected token: pool unchanged");
            assertEq(token.balanceOf(recipient), recipBefore, "rejected token: treasury unchanged");
            assertEq(token.balanceOf(f), fBefore, "rejected token: funder unchanged");
            return;
        }
        assertFalse(_expired(), "funding must not succeed after expiry");
        assertEq(token.balanceOf(address(pool)) - poolBefore, gross - fee, "token pool delta == net");
        assertEq(token.balanceOf(recipient) - recipBefore, fee, "token treasury delta == fee");
        assertEq(fBefore - token.balanceOf(f), gross, "token funder delta == gross");
        totalGrossTok += gross;
        totalFeeTok += fee;
        totalNetTok += gross - fee;
        feeTokTo[recipient] += fee;
        contributions++;
    }

    // ---------------------------------------------------------------- configuration

    function setFee(uint16 bpsRaw, bool asAttacker) external {
        uint256 bps = bound(uint256(bpsRaw), 0, 320); // includes out-of-range attempts
        address caller = asAttacker ? attacker : config.admin();
        vm.prank(caller);
        (bool ok,) = address(config).call(abi.encodeWithSelector(config.setProtocolFeeBps.selector, bps));
        if (asAttacker || bps > 300) {
            assertFalse(ok, "non-admin or over-cap fee change must fail");
            if (asAttacker) unauthorizedAttempts++;
        } else {
            assertTrue(ok);
        }
        assertLe(config.protocolFeeBps(), 300, "stored rate within cap");
    }

    function setTreasury(uint8 which, bool asAttacker) external {
        address t = treasuries[which % 2];
        address caller = asAttacker ? attacker : config.admin();
        vm.prank(caller);
        (bool ok,) = address(config).call(abi.encodeWithSelector(config.setFeeRecipient.selector, t));
        if (asAttacker) {
            assertFalse(ok);
            unauthorizedAttempts++;
        } else {
            assertTrue(ok);
        }
    }

    function proposeAdmin(uint8 which, bool asAttacker) external {
        address target = admins[which % 2];
        address caller = asAttacker ? attacker : config.admin();
        vm.prank(caller);
        (bool ok,) = address(config).call(abi.encodeWithSelector(config.transferAdmin.selector, target));
        if (asAttacker) {
            assertFalse(ok);
            unauthorizedAttempts++;
        }
    }

    function acceptAdmin(uint8 who) external {
        address caller = who % 3 == 2 ? attacker : admins[who % 2];
        address pending = config.pendingAdmin();
        address before = config.admin();
        vm.prank(caller);
        (bool ok,) = address(config).call(abi.encodeWithSelector(config.acceptAdmin.selector));
        if (pending != address(0) && caller == pending) {
            assertTrue(ok);
            assertEq(config.admin(), caller);
            assertEq(config.pendingAdmin(), address(0));
            adminRotations++;
        } else {
            assertFalse(ok, "only the pending admin can accept");
            assertEq(config.admin(), before);
        }
    }

    // ---------------------------------------------------------------- withdrawals

    function withdrawEth(uint8 who, uint96 amountRaw, bool full) external {
        address caller = who % 3 == 0 ? owner : (who % 3 == 1 ? coOwner : attacker);
        uint256 bal = address(pool).balance;
        uint256 amount = full ? bal : bound(uint256(amountRaw), 0, bal + 1);
        uint256 callerBefore = caller.balance;
        vm.prank(caller);
        (bool ok,) = full
            ? address(pool).call(abi.encodeWithSelector(pool.cheaperWithdraw.selector))
            : address(pool).call(abi.encodeWithSelector(pool.withdraw.selector, amount));
        if (caller == attacker) {
            assertFalse(ok, "attacker cannot withdraw");
            unauthorizedAttempts++;
            return;
        }
        if (ok) {
            uint256 got = caller.balance - callerBefore;
            ownerEthOut += got;
            assertEq(address(pool).balance, bal - got);
        }
    }

    function withdrawToken(uint8 who, uint96 amountRaw, bool full) external {
        address caller = who % 3 == 0 ? owner : (who % 3 == 1 ? coOwner : attacker);
        uint256 bal = token.balanceOf(address(pool));
        uint256 amount = full ? bal : bound(uint256(amountRaw), 0, bal + 1);
        uint256 callerBefore = token.balanceOf(caller);
        vm.prank(caller);
        (bool ok,) = full
            ? address(pool).call(abi.encodeWithSelector(pool.withdrawToken.selector, token))
            : address(pool).call(abi.encodeWithSelector(pool.withdrawTokenAmount.selector, token, amount));
        if (caller == attacker) {
            assertFalse(ok);
            unauthorizedAttempts++;
            return;
        }
        if (ok) ownerTokOut += token.balanceOf(caller) - callerBefore;
    }

    function warp(uint32 secondsRaw) external {
        uint256 s = bound(uint256(secondsRaw), 0, 3 days);
        vm.warp(block.timestamp + s);
    }

    function release(uint8 who) external {
        address caller = who % 2 == 0 ? attacker : funders[0]; // anyone may call after expiry
        uint256 ethBefore = owner.balance;
        uint256 tokBefore = token.balanceOf(owner);
        vm.prank(caller);
        (bool ok,) = address(pool).call(abi.encodeWithSelector(pool.releaseExpiredFundsToDeployer.selector));
        if (ok) {
            assertTrue(_expired(), "release only after expiry");
            releaseEthOut += owner.balance - ethBefore;
            releaseTokOut += token.balanceOf(owner) - tokBefore;
        }
    }

    // ---------------------------------------------------------------- views for invariants

    function treasuryEthTotal() external view returns (uint256 s) {
        s = treasuries[0].balance + treasuries[1].balance;
    }

    function treasuryTokTotal() external view returns (uint256 s) {
        s = token.balanceOf(treasuries[0]) + token.balanceOf(treasuries[1]);
    }

    function treasury(uint256 i) external view returns (address) {
        return treasuries[i];
    }

    function adminAddr(uint256 i) external view returns (address) {
        return admins[i];
    }
}

contract ProtocolFeeInvariantTest is StdInvariant, Test {
    FeeHandler internal h;
    CommunityPool internal pool;
    ProtocolConfig internal config;
    /// @dev Oracle max age for fixtures: generous so time-travel tests exercise expiry, not staleness.
    uint32 internal constant ORACLE_MAX_AGE = 365 days;
    MockMintableERC20 internal token;

    function setUp() public {
        address admin = makeAddr("iAdmin");
        address treasuryA = makeAddr("iTreasuryA");
        address owner = makeAddr("iOwner");
        address coOwner = makeAddr("iCoOwner");
        config = new ProtocolConfig(admin, treasuryA, 100);
        MockV3Aggregator ethFeed = new MockV3Aggregator(8, 2000e8);
        MockV3Aggregator tokFeed = new MockV3Aggregator(8, 60_000e8);
        token = new MockMintableERC20("Wrapped BTC", "WBTC", 8);
        uint64 expiresAt = uint64(block.timestamp + 20 days);
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](1);
        tks[0] = CommunityPool.TokenConfig({
            token: address(token), usdFeed: address(tokFeed), decimals: 8, maxPriceAge: ORACLE_MAX_AGE
        });
        address[] memory cos = new address[](1);
        cos[0] = coOwner;
        vm.prank(owner);
        pool =
            new CommunityPool("Inv", "i", 5e18, cos, expiresAt, address(ethFeed), ORACLE_MAX_AGE, tks, address(config));
        h = new FeeHandler(pool, config, token, expiresAt, owner, coOwner);
        targetContract(address(h));
    }

    function invariant_EthGrossEqualsFeePlusNet() public view {
        assertEq(h.totalGrossEth(), h.totalFeeEth() + h.totalNetEth());
    }

    function invariant_TokenGrossEqualsFeePlusNet() public view {
        assertEq(h.totalGrossTok(), h.totalFeeTok() + h.totalNetTok());
    }

    function invariant_EthPoolReconciles() public view {
        // lifetime net == current balance + owner withdrawals + expiry releases
        assertEq(h.totalNetEth(), address(pool).balance + h.ownerEthOut() + h.releaseEthOut());
    }

    function invariant_TokenPoolReconciles() public view {
        assertEq(h.totalNetTok(), token.balanceOf(address(pool)) + h.ownerTokOut() + h.releaseTokOut());
    }

    function invariant_TreasuriesHoldExactlyLifetimeFees() public view {
        assertEq(h.treasuryEthTotal(), h.totalFeeEth());
        assertEq(h.treasuryTokTotal(), h.totalFeeTok());
        assertEq(h.feeEthTo(h.treasury(0)) + h.feeEthTo(h.treasury(1)), h.totalFeeEth());
        assertEq(h.feeTokTo(h.treasury(0)) + h.feeTokTo(h.treasury(1)), h.totalFeeTok());
    }

    function invariant_FeeNeverAboveCap() public view {
        assertLe(config.protocolFeeBps(), 300);
        assertLe(h.maxObservedFeeBps(), 300);
        assertLe(h.totalFeeEth() * 10_000, h.totalGrossEth() * 300 + 10_000); // aggregate <= 3% (+rounding slack)
    }

    function invariant_ControlPlaneNeverOwnsPool() public view {
        assertFalse(pool.isOwner(config.admin()));
        assertFalse(pool.isOwner(config.pendingAdmin()));
        assertFalse(pool.isOwner(h.adminAddr(0)));
        assertFalse(pool.isOwner(h.adminAddr(1)));
        assertFalse(pool.isOwner(h.treasury(0)));
        assertFalse(pool.isOwner(h.treasury(1)));
        assertFalse(pool.isOwner(address(config)));
        assertFalse(pool.isOwner(h.attacker()));
    }

    function invariant_AdminIsOneOfKnownAdminsAndPendingIsBounded() public view {
        address a = config.admin();
        assertTrue(a == h.adminAddr(0) || a == h.adminAddr(1));
        address p = config.pendingAdmin();
        assertTrue(p == address(0) || p == h.adminAddr(0) || p == h.adminAddr(1));
    }

    function invariant_ConfigNeverHoldsAssets() public view {
        assertEq(address(config).balance, 0);
        assertEq(token.balanceOf(address(config)), 0);
    }

    function invariant_CallSummary() public view {
        // Not a property; surfaces coverage in -vv output via assertions that always hold.
        assertGe(h.contributions() + h.rejectedContributions(), 0);
    }
}
