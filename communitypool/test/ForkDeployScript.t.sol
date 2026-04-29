// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Test} from "forge-std/Test.sol";
import {CommunityPool} from "../src/CommunityPool.sol";
import {DeployCommunityPool} from "../script/DeployCommunityPool.s.sol";

/// @notice Runs the real DeployCommunityPool script against a mainnet fork and asserts the
/// resulting pool's whitelist matches the intended mainnet asset set (WBTC + PAXG + XAU₮).
/// Gated behind MAINNET_RPC_URL so CI without secrets skips cleanly.
contract ForkDeployScriptTest is Test {
    address internal constant MAINNET_WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address internal constant MAINNET_PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78;
    address internal constant MAINNET_XAUT = 0x68749665FF8D2d112Fa859AA293F07A622782F38;

    function testFork_MainnetDeployIncludesWbtcPaxgAndXaut() public {
        string memory rpc = vm.envOr("MAINNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            vm.skip(true);
            return;
        }
        vm.createSelectFork(rpc);
        // Force the script's chain-id branch even if the fork reports something else.
        vm.chainId(1);

        DeployCommunityPool script = new DeployCommunityPool();
        // The script reads optional env vars — ensure defaults are sane.
        vm.setEnv("POOL_NAME", "ForkDeployTest");
        vm.setEnv("POOL_DESCRIPTION", "fork");
        // 1e16 minimum (~$0.01 / hour, well under any sane fund) so we don't trip on price.
        CommunityPool pool = script.run();

        address[] memory list = pool.getWhitelistedTokens();
        assertEq(list.length, 3, "mainnet deploy must whitelist 3 tokens");

        bool sawWbtc;
        bool sawPaxg;
        bool sawXaut;
        for (uint256 i = 0; i < list.length; i++) {
            if (list[i] == MAINNET_WBTC) sawWbtc = true;
            if (list[i] == MAINNET_PAXG) sawPaxg = true;
            if (list[i] == MAINNET_XAUT) sawXaut = true;
        }
        assertTrue(sawWbtc, "WBTC missing from mainnet allowlist");
        assertTrue(sawPaxg, "PAXG missing from mainnet allowlist");
        assertTrue(sawXaut, unicode"XAU₮ missing from mainnet allowlist");
    }
}
