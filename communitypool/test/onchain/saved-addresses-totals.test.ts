import { describe, expect, it } from "vitest";
import { toStoredJson } from "@/lib/onchain/cache";
import {
  computeSavedAddressesTotals,
  dedupeNetworksById,
} from "@/lib/onchain/saved-addresses-totals";
import type { NetworkBundle, NormalizedLookupResult } from "@/lib/onchain/types";

function bundle(
  networkId: string,
  native: { formatted: string; usd: number; symbol?: string },
): NetworkBundle {
  return {
    networkId,
    nativeBalance: {
      network: networkId,
      symbol: native.symbol ?? "ETH",
      rawBalance: "0",
      formattedBalance: native.formatted,
      decimals: 18,
      usdValue: native.usd,
    },
    tokens: [],
    transactions: [],
    errors: [],
    uniqueTransactionCount: 0,
    transactionCountComplete: true,
  };
}

function resultFrom(networks: NetworkBundle[]): NormalizedLookupResult {
  return {
    input: {
      kind: "evm_address",
      raw: "0xabc",
      chainFamily: "evm",
      normalized: "0xabc",
    },
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    networks,
    errors: [],
  };
}

describe("dedupeNetworksById", () => {
  it("keeps first bundle per networkId", () => {
    const nets: NetworkBundle[] = [
      bundle("eth-mainnet", { formatted: "1", usd: 100 }),
      bundle("eth-mainnet", { formatted: "99", usd: 9999 }),
      bundle("eth-sepolia", { formatted: "2", usd: 50 }),
    ];
    const d = dedupeNetworksById(nets);
    expect(d).toHaveLength(2);
    expect(d[0]?.nativeBalance?.formattedBalance).toBe("1");
    expect(d[1]?.networkId).toBe("eth-sepolia");
  });
});

describe("computeSavedAddressesTotals", () => {
  it("does not double-count duplicate networkId in one snapshot for USD", () => {
    const r = resultFrom([
      bundle("eth-mainnet", { formatted: "1", usd: 100 }),
      bundle("eth-mainnet", { formatted: "50", usd: 5000 }),
    ]);
    const totals = computeSavedAddressesTotals([
      {
        address_id: "0x0000000000000000000000000000000000000001",
        onchain_snapshot: toStoredJson(r),
        address_balance: null,
      },
    ]);
    expect(totals.totalUsd).toBe(100);
    expect(totals.tokenTotals.find((t) => t.symbol === "ETH")?.amount).toBe(1);
  });

  it("sums USD and ETH across multiple saved rows", () => {
    const row1 = resultFrom([bundle("eth-mainnet", { formatted: "2", usd: 6000 })]);
    const row2 = resultFrom([bundle("eth-mainnet", { formatted: "1", usd: 3000 })]);
    const totals = computeSavedAddressesTotals([
      {
        address_id: "0x0000000000000000000000000000000000000001",
        onchain_snapshot: toStoredJson(row1),
        address_balance: null,
      },
      {
        address_id: "0x0000000000000000000000000000000000000002",
        onchain_snapshot: toStoredJson(row2),
        address_balance: null,
      },
    ]);
    expect(totals.totalUsd).toBe(9000);
    const eth = totals.tokenTotals.find((t) => t.symbol === "ETH");
    expect(eth?.amount).toBeCloseTo(3, 5);
  });

  it("uses address_balance for USD when snapshot has no usd parts", () => {
    const r = resultFrom([
      {
        networkId: "eth-mainnet",
        nativeBalance: {
          network: "eth-mainnet",
          symbol: "ETH",
          rawBalance: "0",
          formattedBalance: "0",
          decimals: 18,
        },
        tokens: [],
        transactions: [],
        errors: [],
        uniqueTransactionCount: 0,
        transactionCountComplete: true,
      },
    ]);
    const totals = computeSavedAddressesTotals([
      {
        address_id: "0x0000000000000000000000000000000000000001",
        onchain_snapshot: toStoredJson(r),
        address_balance: 42.5,
      },
    ]);
    expect(totals.totalUsd).toBe(42.5);
  });
});
