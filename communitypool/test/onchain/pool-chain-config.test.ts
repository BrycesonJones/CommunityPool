import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  getPoolChainConfig,
  getDefaultErc20TokenConfigs,
  getErc20Presets,
} from "@/lib/onchain/pool-chain-config";

const SEPOLIA_ENV_KEYS = [
  "NEXT_PUBLIC_SEPOLIA_WBTC_TOKEN",
  "NEXT_PUBLIC_SEPOLIA_WBTC_USD_FEED",
  "NEXT_PUBLIC_SEPOLIA_WBTC_DECIMALS",
  "NEXT_PUBLIC_SEPOLIA_PAXG_TOKEN",
  "NEXT_PUBLIC_SEPOLIA_PAXG_USD_FEED",
  "NEXT_PUBLIC_SEPOLIA_PAXG_DECIMALS",
  "NEXT_PUBLIC_SEPOLIA_XAUT_TOKEN",
  "NEXT_PUBLIC_SEPOLIA_XAUT_USD_FEED",
  "NEXT_PUBLIC_SEPOLIA_XAUT_DECIMALS",
] as const;

const MAINNET_PAXG = "0x45804880De22913dAFE09f4980848ECE6EcbAf78";
const MAINNET_XAUT = "0x68749665FF8D2d112Fa859AA293F07A622782F38";
const MAINNET_WBTC = "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599";

describe("getPoolChainConfig — mainnet", () => {
  it("includes WBTC, PAXG, and XAU₮ with the canonical mainnet addresses + decimals", () => {
    const cfg = getPoolChainConfig(BigInt(1));
    expect(cfg.wrappedBtc?.token).toBe(MAINNET_WBTC);
    expect(cfg.wrappedBtc?.decimals).toBe(8);
    expect(cfg.paxGold?.token).toBe(MAINNET_PAXG);
    expect(cfg.paxGold?.decimals).toBe(18);
    expect(cfg.tetherGold?.token).toBe(MAINNET_XAUT);
    expect(cfg.tetherGold?.decimals).toBe(6);
  });

  it("getDefaultErc20TokenConfigs(1) returns 3 tokens for the pool constructor", () => {
    const tks = getDefaultErc20TokenConfigs(BigInt(1));
    expect(tks).toHaveLength(3);
    const tokens = tks.map((t) => t.token);
    expect(tokens).toContain(MAINNET_WBTC);
    expect(tokens).toContain(MAINNET_PAXG);
    expect(tokens).toContain(MAINNET_XAUT);
  });
});

describe("getPoolChainConfig — Sepolia (no mainnet fallback)", () => {
  const saved = new Map<string, string | undefined>();

  beforeEach(() => {
    for (const k of SEPOLIA_ENV_KEYS) {
      saved.set(k, process.env[k]);
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of SEPOLIA_ENV_KEYS) {
      const v = saved.get(k);
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("returns null ERC20 entries when Sepolia env vars are unset (does not leak mainnet addresses)", () => {
    const cfg = getPoolChainConfig(BigInt(11155111));
    expect(cfg.ethUsdPriceFeed).toBe("0x694AA1769357215DE4FAC081bf1f309aDC325306");
    expect(cfg.wrappedBtc).toBeNull();
    expect(cfg.paxGold).toBeNull();
    expect(cfg.tetherGold).toBeNull();
  });

  it("getErc20Presets(sepolia) is empty when no Sepolia env vars are set", () => {
    expect(getErc20Presets(BigInt(11155111))).toEqual([]);
  });

  it("opts in to a Sepolia ERC20 only when both token + feed env vars are set", () => {
    process.env.NEXT_PUBLIC_SEPOLIA_PAXG_TOKEN = "0x1111111111111111111111111111111111111111";
    process.env.NEXT_PUBLIC_SEPOLIA_PAXG_USD_FEED = "0x2222222222222222222222222222222222222222";
    const cfg = getPoolChainConfig(BigInt(11155111));
    expect(cfg.paxGold).not.toBeNull();
    expect(cfg.paxGold?.token).toBe("0x1111111111111111111111111111111111111111");
    // Other tokens stay opted-out — no mainnet fallback.
    expect(cfg.wrappedBtc).toBeNull();
    expect(cfg.tetherGold).toBeNull();
  });
});
