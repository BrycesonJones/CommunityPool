import { describe, expect, it } from "vitest";
import type { Json } from "@/lib/supabase/database.types";
import { SNAPSHOT_VERSION } from "@/lib/onchain/constants";
import {
  explorerUrlForChainAddress,
  explorerUrlForChainTx,
  explorerUrlForUserAddressRow,
} from "@/lib/onchain/explorer-urls";
import type { NormalizedLookupResult } from "@/lib/onchain/types";

const EVM_ADDR = "0x7e34543e7ef9a4f0e91649203381ea7bb0b47693";
const EVM_TX =
  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function snapshotJson(result: NormalizedLookupResult): Json {
  return { v: SNAPSHOT_VERSION, result } as unknown as Json;
}

function minimalLookup(overrides: Partial<NormalizedLookupResult>): NormalizedLookupResult {
  return {
    input: {
      kind: "evm_address",
      raw: EVM_ADDR,
      chainFamily: "evm",
      normalized: EVM_ADDR,
    },
    fetchedAt: "2026-01-01T00:00:00.000Z",
    fromCache: false,
    networks: [],
    errors: [],
    ...overrides,
  };
}

describe("explorerUrlForUserAddressRow", () => {
  it("links BTC addresses to mempool.space", () => {
    const url = explorerUrlForUserAddressRow({
      address_id: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
      onchain_snapshot: null,
    });
    expect(url).toBe(
      "https://mempool.space/address/bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4",
    );
  });

  it("uses Sepolia Etherscan when the first network with balances is Sepolia", () => {
    const result = minimalLookup({
      input: {
        kind: "evm_address",
        raw: EVM_ADDR,
        chainFamily: "evm",
        normalized: EVM_ADDR,
      },
      networks: [
        {
          networkId: "eth-mainnet",
          nativeBalance: null,
          tokens: [],
          transactions: [],
          errors: [],
          uniqueTransactionCount: 0,
          transactionCountComplete: false,
        },
        {
          networkId: "eth-sepolia",
          nativeBalance: {
            network: "eth-sepolia",
            symbol: "ETH",
            rawBalance: "1",
            formattedBalance: "0.1",
            decimals: 18,
          },
          tokens: [],
          transactions: [],
          errors: [],
          uniqueTransactionCount: 0,
          transactionCountComplete: false,
        },
      ],
    });
    const url = explorerUrlForUserAddressRow({
      address_id: EVM_ADDR,
      onchain_snapshot: snapshotJson(result),
    });
    expect(url).toBe(
      `https://sepolia.etherscan.io/address/${EVM_ADDR.toLowerCase()}`,
    );
  });

  it("uses resolved tx network for EVM tx hashes", () => {
    const result: NormalizedLookupResult = {
      input: {
        kind: "evm_tx_hash",
        raw: EVM_TX,
        chainFamily: "evm",
        normalized: EVM_TX,
      },
      fetchedAt: "2026-01-01T00:00:00.000Z",
      fromCache: false,
      networks: [],
      errors: [],
      resolvedTx: {
        hash: EVM_TX,
        networkId: "eth-sepolia",
        from: "0x" + "1".repeat(40),
        to: "0x" + "2".repeat(40),
      },
    };
    const url = explorerUrlForUserAddressRow({
      address_id: EVM_TX,
      onchain_snapshot: snapshotJson(result),
    });
    expect(url).toBe(`https://sepolia.etherscan.io/tx/${EVM_TX.toLowerCase()}`);
  });

  it("falls back to mainnet Etherscan for EVM tx when snapshot is missing", () => {
    const url = explorerUrlForUserAddressRow({
      address_id: EVM_TX,
      onchain_snapshot: null,
    });
    expect(url).toBe(`https://etherscan.io/tx/${EVM_TX.toLowerCase()}`);
  });

  it("falls back to mainnet for EVM address when snapshot is missing", () => {
    const url = explorerUrlForUserAddressRow({
      address_id: EVM_ADDR,
      onchain_snapshot: null,
    });
    expect(url).toBe(`https://etherscan.io/address/${EVM_ADDR.toLowerCase()}`);
  });

  it("falls back to mainnet for unknown networkId with balances", () => {
    const result = minimalLookup({
      networks: [
        {
          networkId: "some-future-chain",
          nativeBalance: {
            network: "some-future-chain",
            symbol: "ETH",
            rawBalance: "1",
            formattedBalance: "1",
            decimals: 18,
          },
          tokens: [],
          transactions: [],
          errors: [],
          uniqueTransactionCount: 0,
          transactionCountComplete: false,
        },
      ],
    });
    const url = explorerUrlForUserAddressRow({
      address_id: EVM_ADDR,
      onchain_snapshot: snapshotJson(result),
    });
    expect(url).toBe(`https://etherscan.io/address/${EVM_ADDR.toLowerCase()}`);
  });

  it("returns null for unrecognized paste", () => {
    expect(
      explorerUrlForUserAddressRow({
        address_id: "not-an-address",
        onchain_snapshot: null,
      }),
    ).toBeNull();
  });
});

describe("explorerUrlForChainAddress / explorerUrlForChainTx", () => {
  const ADDR = "0x1234567890123456789012345678901234567890";
  const TX = "0x" + "a".repeat(64);

  it("links mainnet addresses to etherscan.io", () => {
    expect(explorerUrlForChainAddress(1, ADDR)).toBe(
      `https://etherscan.io/address/${ADDR.toLowerCase()}`,
    );
  });

  it("links Sepolia addresses to sepolia.etherscan.io", () => {
    expect(explorerUrlForChainAddress(11155111, ADDR)).toBe(
      `https://sepolia.etherscan.io/address/${ADDR.toLowerCase()}`,
    );
  });

  it("returns null for local (31337) and unknown chains", () => {
    expect(explorerUrlForChainAddress(31337, ADDR)).toBeNull();
    expect(explorerUrlForChainAddress(42, ADDR)).toBeNull();
  });

  it("returns null for malformed addresses even on supported chains", () => {
    expect(explorerUrlForChainAddress(1, "not-an-address")).toBeNull();
  });

  it("links mainnet tx hashes to etherscan.io/tx/…", () => {
    expect(explorerUrlForChainTx(1, TX)).toBe(
      `https://etherscan.io/tx/${TX.toLowerCase()}`,
    );
  });

  it("links Sepolia tx hashes to sepolia.etherscan.io/tx/…", () => {
    expect(explorerUrlForChainTx(11155111, TX)).toBe(
      `https://sepolia.etherscan.io/tx/${TX.toLowerCase()}`,
    );
  });

  it("returns null when the tx hash is missing", () => {
    expect(explorerUrlForChainTx(1, null)).toBeNull();
    expect(explorerUrlForChainTx(1, undefined)).toBeNull();
    expect(explorerUrlForChainTx(1, "")).toBeNull();
  });

  it("returns null for unsupported chains", () => {
    expect(explorerUrlForChainTx(31337, TX)).toBeNull();
  });
});
