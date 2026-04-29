// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {
    CommunityPool,
    CommunityPool__TokenNotWhitelisted
} from "../src/CommunityPool.sol";
import {MockV3Aggregator} from "./pricefeeds/V3Aggregator.sol";
import {MockMintableERC20} from "./MockMintableERC20.sol";
import {MockFeeOnTransferERC20} from "./MockFeeOnTransferERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Locks down the allowlist + mixed-decimals USD valuation paths that mainnet readiness
/// depends on (PAXG / XAU₮ side-by-side, unsupported-token rejection, fee-mechanism baseline).
/// @dev Per-funder credit accounting was removed in the gas-review pass — these tests now
/// assert against on-chain pool balance directly.
contract TokenAllowlistTest is Test {
    receive() external payable {}

    address internal constant USER = address(0xBEEF);
    uint64 internal expiresAt;

    MockV3Aggregator internal ethFeed;
    MockV3Aggregator internal paxgFeed; // 8-dec feed, ~$2,000/oz
    MockV3Aggregator internal xautFeed; // 8-dec feed, ~$2,000/oz
    MockMintableERC20 internal paxg18;
    MockMintableERC20 internal xaut6;
    MockMintableERC20 internal nonWhitelisted;
    MockFeeOnTransferERC20 internal feeToken;

    CommunityPool internal pool;

    function setUp() public {
        ethFeed = new MockV3Aggregator(8, int256(2000e8));
        paxgFeed = new MockV3Aggregator(8, int256(2000e8));
        xautFeed = new MockV3Aggregator(8, int256(2000e8));

        paxg18 = new MockMintableERC20("PAX Gold", "PAXG", 18);
        xaut6 = new MockMintableERC20("Tether Gold", "XAUT", 6);
        nonWhitelisted = new MockMintableERC20("Random", "RND", 18);
        // Deployed with 0 bps fee — flipped per-test to simulate Paxos re-enabling its fee.
        feeToken = new MockFeeOnTransferERC20("PAX Gold (fee on)", "PAXG-FEE", 18, 0);

        expiresAt = uint64(block.timestamp + 30 days);

        // Whitelist PAXG (18-dec), XAU₮ (6-dec), and a fee-mechanism stand-in. Random ERC20 stays out.
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](3);
        tks[0] = CommunityPool.TokenConfig({token: address(paxg18), usdFeed: address(paxgFeed), decimals: 18});
        tks[1] = CommunityPool.TokenConfig({token: address(xaut6), usdFeed: address(xautFeed), decimals: 6});
        tks[2] = CommunityPool.TokenConfig({token: address(feeToken), usdFeed: address(paxgFeed), decimals: 18});

        address[] memory cos = new address[](0);
        // 5 USD minimum so 1 oz of PAXG ($2,000) and 1 oz of XAU₮ ($2,000) both clearly exceed it.
        pool = new CommunityPool("Allowlist", "test", 5e18, cos, expiresAt, address(ethFeed), tks);

        paxg18.mint(USER, 100e18);
        xaut6.mint(USER, 100e6);
        feeToken.mint(USER, 100e18);
        nonWhitelisted.mint(USER, 100e18);
    }

    /// Funding a non-whitelisted ERC20 must revert with the allowlist error.
    function testFundUnsupportedTokenReverts() public {
        vm.startPrank(USER);
        nonWhitelisted.approve(address(pool), 1e18);
        vm.expectRevert(CommunityPool__TokenNotWhitelisted.selector);
        pool.fundERC20(IERC20(address(nonWhitelisted)), 1e18);
        vm.stopPrank();
    }

    /// 18-decimal PAXG and 6-decimal XAU₮ must both be accepted and credited at face value.
    /// Pool balance is the source of truth.
    function testMixedDecimalsAcceptedAtFaceValue() public {
        // PAXG: 1 token (18 dec)
        uint256 paxgAmount = 1e18;
        vm.startPrank(USER);
        paxg18.approve(address(pool), paxgAmount);
        pool.fundERC20(IERC20(address(paxg18)), paxgAmount);
        vm.stopPrank();

        // XAU₮: 1 token (6 dec)
        uint256 xautAmount = 1e6;
        vm.startPrank(USER);
        xaut6.approve(address(pool), xautAmount);
        pool.fundERC20(IERC20(address(xaut6)), xautAmount);
        vm.stopPrank();

        assertEq(paxg18.balanceOf(address(pool)), paxgAmount);
        assertEq(xaut6.balanceOf(address(pool)), xautAmount);
    }

    /// With fee=0 a fee-mechanism token behaves like a vanilla ERC20.
    function testFeeMechanismAtZeroBpsTransfersRequestedAmount() public {
        uint256 amount = 1e18;
        vm.startPrank(USER);
        feeToken.approve(address(pool), amount);
        pool.fundERC20(IERC20(address(feeToken)), amount);
        vm.stopPrank();

        assertEq(feeToken.balanceOf(address(pool)), amount);
    }

    /// After a fee-on-transfer fund, the post-expiry release sweeps the actual on-chain balance
    /// (no per-funder credit ledger to diverge from balance).
    function testReleaseAfterExpirySucceedsWithFeeOnTransferFunding() public {
        feeToken.setFeeBps(50); // 0.5%
        uint256 requested = 2e18;
        vm.startPrank(USER);
        feeToken.approve(address(pool), requested);
        pool.fundERC20(IERC20(address(feeToken)), requested);
        vm.stopPrank();

        uint256 poolBal = feeToken.balanceOf(address(pool));
        vm.warp(expiresAt + 1);
        pool.releaseExpiredFundsToDeployer();

        // Deployer is `this`; receives the actual pool balance (a second fee is taken on the way out).
        assertEq(feeToken.balanceOf(address(pool)), 0);
        uint256 expectedDeployerReceived = poolBal - (poolBal * 50) / 10_000;
        assertEq(feeToken.balanceOf(address(this)), expectedDeployerReceived);
    }
}
