import { afterEach, beforeEach, describe, it, expect } from "vitest";
import {
  primaryAssetBalanceFor,
  readOnlyProviderForChain,
  type PoolAssetBalance,
  type PoolOnChainBalances,
} from "@/lib/onchain/pool-balances";

function makeAsset(partial: Partial<PoolAssetBalance>): PoolAssetBalance {
  return {
    symbol: "X",
    isNative: false,
    tokenAddress: "0x0000000000000000000000000000000000000000",
    decimals: 18,
    raw: BigInt(0),
    human: "0",
    usdPerUnit: 0,
    usd: 0,
    ...partial,
  };
}

function makeBalances(partial: Partial<PoolOnChainBalances>): PoolOnChainBalances {
  const nativeEth = makeAsset({
    symbol: "ETH",
    isNative: true,
    tokenAddress: null,
    decimals: 18,
    human: "0.1",
    usdPerUnit: 2000,
    usd: 200,
  });
  return {
    pool: "0xAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAaAa",
    chainId: 1,
    blockNumber: 1,
    nativeEth,
    tokens: [],
    totalUsd: nativeEth.usd,
    readAt: 0,
    ...partial,
  };
}

describe("primaryAssetBalanceFor", () => {
  it("returns nativeEth for empty / ETH asset_type", () => {
    const b = makeBalances({});
    expect(primaryAssetBalanceFor(b, "").symbol).toBe("ETH");
    expect(primaryAssetBalanceFor(b, "ETH").symbol).toBe("ETH");
    expect(primaryAssetBalanceFor(b, "eth").symbol).toBe("ETH");
  });

  it("returns the matching ERC20 entry, case-insensitive", () => {
    const wbtc = makeAsset({
      symbol: "WBTC",
      tokenAddress: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599",
      decimals: 8,
      human: "0.5",
      usdPerUnit: 60000,
      usd: 30000,
    });
    const b = makeBalances({ tokens: [wbtc], totalUsd: 30200 });
    expect(primaryAssetBalanceFor(b, "WBTC").symbol).toBe("WBTC");
    expect(primaryAssetBalanceFor(b, "wbtc").symbol).toBe("WBTC");
  });

  it("falls back to nativeEth when asset_type is unknown", () => {
    const b = makeBalances({});
    expect(primaryAssetBalanceFor(b, "UNKNOWN").symbol).toBe("ETH");
  });
});

describe("readOnlyProviderForChain", () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.NEXT_PUBLIC_READ_RPC_URL_1;
    delete process.env.NEXT_PUBLIC_READ_RPC_URL_11155111;
    delete process.env.NEXT_PUBLIC_READ_RPC_URL_9999;
  });
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it("returns a provider for mainnet using CHAIN_METADATA fallback", () => {
    const p = readOnlyProviderForChain(1);
    expect(p).not.toBeNull();
  });

  it("returns a provider for sepolia using CHAIN_METADATA fallback", () => {
    const p = readOnlyProviderForChain(11155111);
    expect(p).not.toBeNull();
  });

  it("prefers the per-chain NEXT_PUBLIC override when set", () => {
    process.env.NEXT_PUBLIC_READ_RPC_URL_1 = "https://custom.example/rpc";
    const p = readOnlyProviderForChain(1);
    expect(p).not.toBeNull();
    // ethers exposes the connection URL as `_getConnection().url`; we just
    // verify via JSON that the configured url was picked up.
    const conn = (p as unknown as { _getConnection: () => { url: string } })
      ._getConnection();
    expect(conn.url).toBe("https://custom.example/rpc");
  });

  it("returns null for an unknown chain with no override", () => {
    expect(readOnlyProviderForChain(9999)).toBeNull();
  });
});
