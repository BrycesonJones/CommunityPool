// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {CommunityPool} from "../../src/CommunityPool.sol";
import {ProtocolConfig} from "../../src/ProtocolConfig.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Mainnet-fork compatibility of the V2 candidate's exact-transfer fee split with the real
/// canonical assets. Addresses are the ones already committed in script/DeployCommunityPool.s.sol
/// and lib/onchain/pool-chain-config.ts. Local fork only: balances are set with `deal`, no real
/// transaction is ever broadcast. Skips cleanly without MAINNET_RPC_URL.
contract ForkProtocolFeeMainnetTest is Test {
    address internal constant MAINNET_ETH_USD = 0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419;
    address internal constant MAINNET_WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address internal constant MAINNET_WBTC_USD_FEED = 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c;
    address internal constant MAINNET_PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78;
    address internal constant MAINNET_PAXG_USD_FEED = 0x9944D86CEB9160aF5C5feB251FD671923323f8C3;

    address internal admin = makeAddr("forkAdmin");
    address internal treasury = makeAddr("forkTreasury");
    address internal owner = makeAddr("forkOwner");
    address internal funder = makeAddr("forkFunder");

    function _pool() internal returns (CommunityPool p, ProtocolConfig c) {
        c = new ProtocolConfig(admin, treasury, 100);
        CommunityPool.TokenConfig[] memory tks = new CommunityPool.TokenConfig[](2);
        tks[0] = CommunityPool.TokenConfig({token: MAINNET_WBTC, usdFeed: MAINNET_WBTC_USD_FEED, decimals: 8});
        tks[1] = CommunityPool.TokenConfig({token: MAINNET_PAXG, usdFeed: MAINNET_PAXG_USD_FEED, decimals: 18});
        address[] memory cos = new address[](0);
        vm.prank(owner);
        p = new CommunityPool(
            "Fork", "f", 5e18, cos, uint64(block.timestamp + 30 days), MAINNET_ETH_USD, tks, address(c)
        );
    }

    function _skipIfNoRpc() internal returns (bool) {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return true;
        }
        vm.createSelectFork(rpc);
        return false;
    }

    function testFork_EthSplitWithRealChainlinkFeed() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        vm.deal(funder, 10 ether);
        vm.prank(funder);
        p.fund{value: 1 ether}();
        assertEq(address(p).balance, 0.99 ether);
        assertEq(treasury.balance, 0.01 ether);
    }

    function testFork_WbtcExactTransferSplitWithExactAllowance() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        uint256 gross = 1_000_000; // 0.01 WBTC
        deal(MAINNET_WBTC, funder, gross);
        vm.startPrank(funder);
        IERC20(MAINNET_WBTC).approve(address(p), gross);
        p.fundERC20(IERC20(MAINNET_WBTC), gross);
        vm.stopPrank();
        assertEq(IERC20(MAINNET_WBTC).balanceOf(address(p)), 990_000);
        assertEq(IERC20(MAINNET_WBTC).balanceOf(treasury), 10_000);
        assertEq(IERC20(MAINNET_WBTC).balanceOf(funder), 0, "debited exactly gross");
        assertEq(IERC20(MAINNET_WBTC).allowance(funder, address(p)), 0);
    }

    function testFork_PaxgExactTransferSplitWithExactAllowance() public {
        if (_skipIfNoRpc()) return;
        (CommunityPool p,) = _pool();
        uint256 gross = 1e18; // 1 PAXG
        deal(MAINNET_PAXG, funder, gross);
        vm.startPrank(funder);
        IERC20(MAINNET_PAXG).approve(address(p), gross);
        // PAXG is fee-on-transfer CAPABLE; its live fee rate is what makes it pass or fail exact
        // accounting. This test records the live outcome either way.
        (bool ok,) = address(p).call(abi.encodeWithSelector(p.fundERC20.selector, IERC20(MAINNET_PAXG), gross));
        vm.stopPrank();
        if (ok) {
            assertEq(IERC20(MAINNET_PAXG).balanceOf(address(p)), 0.99e18, "exact split at live 0 transfer fee");
            assertEq(IERC20(MAINNET_PAXG).balanceOf(treasury), 0.01e18);
            assertEq(IERC20(MAINNET_PAXG).balanceOf(funder), 0);
        } else {
            // Live PAXG transfer fee is non-zero: exact-transfer accounting rejects it atomically.
            assertEq(IERC20(MAINNET_PAXG).balanceOf(address(p)), 0);
            assertEq(IERC20(MAINNET_PAXG).balanceOf(treasury), 0);
            assertEq(IERC20(MAINNET_PAXG).balanceOf(funder), gross);
        }
    }
}
