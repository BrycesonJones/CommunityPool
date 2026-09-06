// SPDX-License-Identifier: MIT
pragma solidity ^0.8.18;

import {Script, console} from "forge-std/Script.sol";
import {CommunityPool} from "../src/CommunityPool.sol";
import {ProtocolConfig} from "../src/ProtocolConfig.sol";
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

    // Immutable per-feed maximum accepted price age (seconds). Values verified against Chainlink's
    // reference data and on-chain aggregator reads on 2026-09-06; rationale and evidence in
    // docs/deployment/phase-2-7-mainnet-canary.md. Policy: 2x the documented heartbeat, so one
    // delayed round is tolerated while multi-heartbeat-old data is rejected.
    //   ETH/USD  heartbeat 3600  -> 7200
    //   BTC/USD  heartbeat 3600  -> 7200   (WBTC is priced via BTC/USD; no WBTC/USD feed exists)
    //   PAXG/USD heartbeat 86400 -> 172800
    //   XAU/USD  heartbeat 86400 -> 172800
    //
    // XAU/USD is labelled a Precious Metals market-hours feed, so a weekend publishing pause was
    // assumed at first. Measurement disproved it: walking consecutive aggregator rounds across
    // three multi-week windows (Nov-Dec 2024, Jul-Aug 2025, Jan-Feb 2026) plus the Christmas 2025
    // and Good Friday 2026 closures, the largest gap between consecutive rounds was 24.01 h - the
    // feed honours its 86400 s heartbeat 24/7/365 and republishes the frozen last-close price while
    // the spot market is shut. XAU/USD therefore takes the same 2x-heartbeat policy as PAXG/USD;
    // no market-hours exemption exists anywhere in the contracts. Evidence, methodology and the
    // fail-closed consequence if that cadence ever changes: docs/deployment/phase-2-7-mainnet-canary.md.
    uint32 internal constant MAINNET_ETH_USD_MAX_AGE = 7_200;
    uint32 internal constant MAINNET_BTC_USD_MAX_AGE = 7_200;
    uint32 internal constant MAINNET_PAXG_USD_MAX_AGE = 172_800;
    uint32 internal constant MAINNET_XAU_USD_MAX_AGE = 172_800;

    function run() external returns (CommunityPool) {
        HelperConfig helperConfig = new HelperConfig();
        (address ethUsdFeed) = helperConfig.activeNetworkConfig();

        string memory name = vm.envOr("POOL_NAME", string("CommunityPool"));
        string memory description = vm.envOr("POOL_DESCRIPTION", string(""));
        uint256 minUsd = vm.envOr("MINIMUM_USD", uint256(1e16));
        uint64 expiresAt = uint64(vm.envOr("POOL_EXPIRES_AT", uint256(block.timestamp + 365 days)));

        address[] memory coOwners = new address[](0);
        uint32 ethMaxAge = _ethUsdMaxPriceAge();

        CommunityPool.TokenConfig[] memory tokenConfigs = _defaultTokenConfigs();

        address protocolConfig = _resolveProtocolConfig();

        vm.startBroadcast();
        CommunityPool pool = new CommunityPool(
            name, description, minUsd, coOwners, expiresAt, ethUsdFeed, ethMaxAge, tokenConfigs, protocolConfig
        );
        vm.stopBroadcast();
        console.log("CommunityPool deployed at:", address(pool));
        return pool;
    }

    /// @dev Every V2 pool must point at the official ProtocolConfig for its chain. On mainnet
    /// and Sepolia that address MUST be supplied explicitly (PROTOCOL_CONFIG_ADDRESS); there is
    /// no placeholder and nothing is hardcoded. On a local chain, if no address is supplied, a
    /// throwaway fixture config is deployed whose admin/recipient default to the broadcaster.
    function _resolveProtocolConfig() internal returns (address) {
        address configured = vm.envOr("PROTOCOL_CONFIG_ADDRESS", address(0));
        if (configured != address(0)) {
            require(configured.code.length > 0, "PROTOCOL_CONFIG_ADDRESS has no code");
            return configured;
        }
        require(
            block.chainid != 1 && block.chainid != 11155111,
            "PROTOCOL_CONFIG_ADDRESS is required on mainnet and Sepolia"
        );
        address admin = vm.envOr("PROTOCOL_ADMIN", msg.sender);
        address recipient = vm.envOr("PROTOCOL_FEE_RECIPIENT", msg.sender);
        uint256 feeBps = vm.envOr("PROTOCOL_FEE_BPS", uint256(100));
        vm.startBroadcast();
        ProtocolConfig fixture = new ProtocolConfig(admin, recipient, feeBps);
        vm.stopBroadcast();
        console.log("Local fixture ProtocolConfig deployed at:", address(fixture));
        return address(fixture);
    }

    /// @dev Mainnet: verified constant. Sepolia: must be supplied explicitly (no placeholder).
    /// Local chains: 1 day unless overridden; the mock feed is fresh at deploy time.
    function _ethUsdMaxPriceAge() internal view returns (uint32) {
        if (block.chainid == 1) return MAINNET_ETH_USD_MAX_AGE;
        if (block.chainid == 11155111) return uint32(vm.envUint("SEPOLIA_ETH_USD_MAX_AGE"));
        return uint32(vm.envOr("POOL_ETH_USD_MAX_AGE", uint256(1 days)));
    }

    function _defaultTokenConfigs() internal view returns (CommunityPool.TokenConfig[] memory) {
        if (block.chainid == 1) {
            CommunityPool.TokenConfig[] memory c = new CommunityPool.TokenConfig[](3);
            c[0] = CommunityPool.TokenConfig({
                token: MAINNET_WBTC, usdFeed: MAINNET_WBTC_USD_FEED, decimals: 8, maxPriceAge: MAINNET_BTC_USD_MAX_AGE
            });
            c[1] = CommunityPool.TokenConfig({
                token: MAINNET_PAXG, usdFeed: MAINNET_PAXG_USD_FEED, decimals: 18, maxPriceAge: MAINNET_PAXG_USD_MAX_AGE
            });
            c[2] = CommunityPool.TokenConfig({
                token: MAINNET_XAUT, usdFeed: MAINNET_XAU_USD_FEED, decimals: 6, maxPriceAge: MAINNET_XAU_USD_MAX_AGE
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
            // Sepolia feeds have looser heartbeats than mainnet; require an explicit value.
            uint32 tokenMaxAge = uint32(vm.envUint("SEPOLIA_TOKEN_USD_MAX_AGE"));

            uint256 n = 0;
            if (wbtcTok != address(0) && wbtcFeed != address(0)) n++;
            if (paxgTok != address(0) && paxgFeed != address(0)) n++;
            if (xautTok != address(0) && xautFeed != address(0)) n++;

            CommunityPool.TokenConfig[] memory c = new CommunityPool.TokenConfig[](n);
            uint256 i = 0;
            if (wbtcTok != address(0) && wbtcFeed != address(0)) {
                c[i++] = CommunityPool.TokenConfig({
                    token: wbtcTok, usdFeed: wbtcFeed, decimals: wbtcDec, maxPriceAge: tokenMaxAge
                });
            }
            if (paxgTok != address(0) && paxgFeed != address(0)) {
                c[i++] = CommunityPool.TokenConfig({
                    token: paxgTok, usdFeed: paxgFeed, decimals: paxgDec, maxPriceAge: tokenMaxAge
                });
            }
            if (xautTok != address(0) && xautFeed != address(0)) {
                c[i++] = CommunityPool.TokenConfig({
                    token: xautTok, usdFeed: xautFeed, decimals: xautDec, maxPriceAge: tokenMaxAge
                });
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
                decimals: uint8(vm.envOr("POOL_TOKEN_DECIMALS", uint256(18))),
                maxPriceAge: uint32(vm.envOr("POOL_TOKEN_USD_MAX_AGE", uint256(1 days)))
            });
            return one;
        }
        return new CommunityPool.TokenConfig[](0);
    }
}
