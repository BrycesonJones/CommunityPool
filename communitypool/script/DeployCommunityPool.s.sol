// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Script, console} from "forge-std/Script.sol";
import {CommunityPool} from "../src/CommunityPool.sol";
import {HelperConfig} from "./HelperConfig.s.sol";

/// @dev Default ERC20 whitelist matches `lib/onchain/pool-chain-config.ts` (WBTC + PAXG + XAU₮ on
/// mainnet; Sepolia: optional env vars, same names as typical `.env` without NEXT_PUBLIC_ prefix).
contract DeployCommunityPool is Script {
    address internal constant MAINNET_WBTC = 0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599;
    address internal constant MAINNET_WBTC_USD_FEED = 0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c;
    address internal constant MAINNET_PAXG = 0x45804880De22913dAFE09f4980848ECE6EcbAf78;
    address internal constant MAINNET_PAXG_USD_FEED = 0x9944D86CEB9160aF5C5feB251FD671923323f8C3;
    address internal constant MAINNET_XAUT = 0x68749665FF8D2d112Fa859AA293F07A622782F38;
    // XAU / USD per troy ounce — XAU₮ is 1 token == 1 troy ounce.
    address internal constant MAINNET_XAU_USD_FEED = 0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6;

    function run() external returns (CommunityPool) {
        HelperConfig helperConfig = new HelperConfig();
        (address ethUsdFeed) = helperConfig.activeNetworkConfig();

        string memory name = vm.envOr("POOL_NAME", string("CommunityPool"));
        string memory description = vm.envOr("POOL_DESCRIPTION", string(""));
        uint256 minUsd = vm.envOr("MINIMUM_USD", uint256(1e16));
        uint64 expiresAt = uint64(vm.envOr("POOL_EXPIRES_AT", uint256(block.timestamp + 365 days)));

        address[] memory coOwners = new address[](0);

        CommunityPool.TokenConfig[] memory tokenConfigs = _defaultTokenConfigs();

        vm.startBroadcast();
        CommunityPool pool = new CommunityPool(
            name, description, minUsd, coOwners, expiresAt, ethUsdFeed, tokenConfigs
        );
        vm.stopBroadcast();
        console.log("CommunityPool deployed at:", address(pool));
        return pool;
    }

    function _defaultTokenConfigs() internal view returns (CommunityPool.TokenConfig[] memory) {
        if (block.chainid == 1) {
            CommunityPool.TokenConfig[] memory c = new CommunityPool.TokenConfig[](3);
            c[0] = CommunityPool.TokenConfig({
                token: MAINNET_WBTC, usdFeed: MAINNET_WBTC_USD_FEED, decimals: 8
            });
            c[1] = CommunityPool.TokenConfig({
                token: MAINNET_PAXG, usdFeed: MAINNET_PAXG_USD_FEED, decimals: 18
            });
            c[2] = CommunityPool.TokenConfig({
                token: MAINNET_XAUT, usdFeed: MAINNET_XAU_USD_FEED, decimals: 6
            });
            return c;
        }
        if (block.chainid == 11155111) {
            address wbtcTok = vm.envOr("SEPOLIA_WBTC_TOKEN", address(0));
            address wbtcFeed = vm.envOr("SEPOLIA_WBTC_USD_FEED", address(0));
            uint8 wbtcDec = uint8(vm.envOr("SEPOLIA_WBTC_DECIMALS", uint256(8)));

            address paxgTok = vm.envOr("SEPOLIA_PAXG_TOKEN", address(0));
            address paxgFeed = vm.envOr("SEPOLIA_PAXG_USD_FEED", address(0));
            uint8 paxgDec = uint8(vm.envOr("SEPOLIA_PAXG_DECIMALS", uint256(18)));

            address xautTok = vm.envOr("SEPOLIA_XAUT_TOKEN", address(0));
            address xautFeed = vm.envOr("SEPOLIA_XAUT_USD_FEED", address(0));
            uint8 xautDec = uint8(vm.envOr("SEPOLIA_XAUT_DECIMALS", uint256(6)));

            uint256 n = 0;
            if (wbtcTok != address(0) && wbtcFeed != address(0)) n++;
            if (paxgTok != address(0) && paxgFeed != address(0)) n++;
            if (xautTok != address(0) && xautFeed != address(0)) n++;

            CommunityPool.TokenConfig[] memory c = new CommunityPool.TokenConfig[](n);
            uint256 i = 0;
            if (wbtcTok != address(0) && wbtcFeed != address(0)) {
                c[i++] = CommunityPool.TokenConfig({token: wbtcTok, usdFeed: wbtcFeed, decimals: wbtcDec});
            }
            if (paxgTok != address(0) && paxgFeed != address(0)) {
                c[i++] = CommunityPool.TokenConfig({token: paxgTok, usdFeed: paxgFeed, decimals: paxgDec});
            }
            if (xautTok != address(0) && xautFeed != address(0)) {
                c[i++] = CommunityPool.TokenConfig({token: xautTok, usdFeed: xautFeed, decimals: xautDec});
            }
            return c;
        }
        // Anvil / other: optional single token (legacy env) or empty
        address legacyTok = vm.envOr("POOL_WHITELIST_TOKEN", address(0));
        if (legacyTok != address(0)) {
            CommunityPool.TokenConfig[] memory one = new CommunityPool.TokenConfig[](1);
            one[0] = CommunityPool.TokenConfig({
                token: legacyTok,
                usdFeed: vm.envAddress("POOL_TOKEN_USD_FEED"),
                decimals: uint8(vm.envOr("POOL_TOKEN_DECIMALS", uint256(18)))
            });
            return one;
        }
        return new CommunityPool.TokenConfig[](0);
    }
}
