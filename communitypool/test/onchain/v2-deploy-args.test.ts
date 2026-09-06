/**
 * New-pool deployment configuration (Phase 2.8).
 *
 * Every value the pool is permanently bound to — ProtocolConfig, each oracle feed, each freshness
 * threshold, the supported asset set — is a protocol parameter, not user input. A mistake here is
 * unfixable after deployment because all of it is immutable, so these assertions pin the exact
 * mainnet wiring validated by the Phase 2.7 canary.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getAddress, parseUnits } from "ethers";
import { buildV2DeployArgs } from "@/lib/onchain/community-pool";
import { getPoolChainConfig } from "@/lib/onchain/pool-chain-config";

const MAINNET = 1n;
const MAINNET_PROTOCOL_CONFIG = "0x2eD7F089a6C2971B24eA91121aD65f9242F622c0";
const ETH_USD = "0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419";
const WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";
const BTC_USD = "0xF4030086522a5bEEa4988F8cA5B36dbC97BeE88c";
const PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
const PAXG_USD = "0x9944D86CEB9160aF5C5feB251FD671923323f8C3";
const XAUT = "0x68749665FF8D2d112Fa859AA293F07A622782F38";
const XAU_USD = "0x214eD9Da11D2fbe465a6fc601a91E62EbEc1a0D6";

const params = {
  name: "  Trip Fund  ",
  description: " shared costs ",
  minimumUsdHuman: "5",
  coOwnerAddresses: [] as string[],
  expirationDateYmd: "2099-12-31",
};

describe("mainnet V2 deploy arguments", () => {
  const build = () => buildV2DeployArgs(MAINNET, params);

  it("points every new pool at the one shared ProtocolConfig", () => {
    const { args, protocolConfig } = build();
    expect(protocolConfig).toBe(getAddress(MAINNET_PROTOCOL_CONFIG));
    expect(args[8]).toBe(getAddress(MAINNET_PROTOCOL_CONFIG));
    expect(getPoolChainConfig(MAINNET).protocolConfig).toBe(MAINNET_PROTOCOL_CONFIG);
  });

  it("wires the ETH/USD feed with the 2x-heartbeat threshold", () => {
    const { args } = build();
    expect(args[5]).toBe(getAddress(ETH_USD));
    expect(args[6]).toBe(7_200);
  });

  it("supports exactly ETH + WBTC + PAXG + XAU₮, each with its canonical feed and threshold", () => {
    const { args } = build();
    expect(args[7]).toEqual([
      { token: getAddress(WBTC), usdFeed: getAddress(BTC_USD), decimals: 8, maxPriceAge: 7_200 },
      { token: getAddress(PAXG), usdFeed: getAddress(PAXG_USD), decimals: 18, maxPriceAge: 172_800 },
      { token: getAddress(XAUT), usdFeed: getAddress(XAU_USD), decimals: 6, maxPriceAge: 172_800 },
    ]);
  });

  it("uses hourly thresholds for hourly feeds and daily for daily feeds", () => {
    const { args } = build();
    const ages = Object.fromEntries(args[7].map((t) => [t.token, t.maxPriceAge]));
    // ETH/USD and BTC/USD publish on a 3600 s heartbeat; PAXG/USD and XAU/USD on 86400 s.
    expect(args[6]).toBe(2 * 3_600);
    expect(ages[getAddress(WBTC)]).toBe(2 * 3_600);
    expect(ages[getAddress(PAXG)]).toBe(2 * 86_400);
    expect(ages[getAddress(XAUT)]).toBe(2 * 86_400);
  });

  it("carries the user's own pool settings through unchanged", () => {
    const { args } = build();
    expect(args[0]).toBe("Trip Fund");
    expect(args[1]).toBe("shared costs");
    expect(args[2]).toBe(parseUnits("5", 18));
    expect(args[3]).toEqual([]);
    expect(args[4]).toBe(BigInt(Math.floor(Date.parse("2099-12-31T23:59:59.999Z") / 1000)));
  });

  it("preserves co-owners", () => {
    const coOwner = "0x00000000000000000000000000000000000000d4";
    const { args } = buildV2DeployArgs(MAINNET, { ...params, coOwnerAddresses: [coOwner] });
    expect(args[3]).toEqual([getAddress(coOwner)]);
  });

  it("rejects an expiry that is not in the future", () => {
    expect(() =>
      buildV2DeployArgs(MAINNET, { ...params, expirationDateYmd: "2020-01-01" }),
    ).toThrow(/expiration must be in the future/i);
  });

  it("never lets a caller substitute the oracle or config wiring", () => {
    // The builder takes only chain id + user-facing params; there is no seam for a caller to pass
    // a different ProtocolConfig, feed or threshold.
    expect(buildV2DeployArgs.length).toBeLessThanOrEqual(3);
    const a = buildV2DeployArgs(MAINNET, params).args;
    const b = buildV2DeployArgs(MAINNET, { ...params, name: "other" }).args;
    expect(a.slice(5)).toEqual(b.slice(5));
  });
});

describe("chains without a configured ProtocolConfig", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_SEPOLIA_PROTOCOL_CONFIG;
    delete process.env.NEXT_PUBLIC_SEPOLIA_ETH_USD_MAX_AGE;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("still READ as a config, so existing pools keep working", () => {
    const cfg = getPoolChainConfig(11155111n);
    expect(cfg.protocolConfig).toBeNull();
    expect(cfg.ethUsdPriceFeed).toBeTruthy();
  });

  it("but block a new deployment with a clear message", () => {
    expect(() => buildV2DeployArgs(11155111n, params)).toThrow(/No ProtocolConfig is configured/i);
  });

  it("block deployment when the freshness threshold is unset", () => {
    process.env.NEXT_PUBLIC_SEPOLIA_PROTOCOL_CONFIG = "0x00000000000000000000000000000000000000E5";
    expect(() => buildV2DeployArgs(11155111n, params)).toThrow(/freshness threshold/i);
  });

  it("never fall back to another chain's ProtocolConfig", () => {
    process.env.NEXT_PUBLIC_SEPOLIA_PROTOCOL_CONFIG = "0x00000000000000000000000000000000000000E5";
    process.env.NEXT_PUBLIC_SEPOLIA_ETH_USD_MAX_AGE = "7200";
    const { protocolConfig } = buildV2DeployArgs(11155111n, params);
    expect(protocolConfig).not.toBe(getAddress(MAINNET_PROTOCOL_CONFIG));
  });
});
