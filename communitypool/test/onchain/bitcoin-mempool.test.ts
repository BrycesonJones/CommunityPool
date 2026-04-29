import { afterEach, describe, expect, it, vi } from "vitest";
import { createBitcoinAdapter } from "@/lib/onchain/providers/bitcoin";

const BASE = "https://fixture-mempool.test";
const NET = "bitcoin-mainnet" as const;

describe("createBitcoinAdapter (mempool REST)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("computes balance from chain_stats and mempool_stats and applies USD from /api/v1/prices", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        if (u === `${BASE}/api/v1/prices`) {
          return new Response(JSON.stringify({ USD: 100_000 }));
        }
        if (u === `${BASE}/api/address/bc1fixture`) {
          return new Response(
            JSON.stringify({
              chain_stats: {
                funded_txo_sum: 5_000_000_000,
                spent_txo_sum: 1_000_000_000,
              },
              mempool_stats: {
                funded_txo_sum: 100_000_000,
                spent_txo_sum: 50_000_000,
              },
            }),
          );
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const adapter = createBitcoinAdapter({ baseUrl: BASE });
    const res = await adapter.getNativeBalance({
      network: NET,
      address: "bc1fixture",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const balance = res.data;
    expect(balance).not.toBeNull();
    if (balance === null) return;
    expect(balance.rawBalance).toBe("4050000000");
    expect(balance.formattedBalance).toBe("40.5");
    expect(balance.symbol).toBe("BTC");
    expect(balance.decimals).toBe(8);
    expect(balance.usdValue).toBeCloseTo(4_050_000);
  });

  it("maps address txs into NormalizedTransaction without provider errors", async () => {
    const fetchMock = vi.fn(async (input: string | URL) => {
        const u = String(input);
        if (u === `${BASE}/api/address/bc1watch`) {
          return new Response(
            JSON.stringify({
              chain_stats: {
                funded_txo_sum: 0,
                spent_txo_sum: 0,
                tx_count: 99,
              },
            }),
          );
        }
        if (u === `${BASE}/api/address/bc1watch/txs`) {
          return new Response(
            JSON.stringify([
              {
                txid: "aa".repeat(32),
                status: {
                  confirmed: true,
                  block_height: 700_000,
                  block_time: 1_600_000_000,
                },
                vin: [
                  {
                    prevout: {
                      scriptpubkey_address: "1FromOther",
                      value: 2_000_000,
                    },
                  },
                ],
                vout: [
                  {
                    scriptpubkey_address: "bc1watch",
                    value: 500_000,
                  },
                ],
              },
            ]),
          );
        }
        if (
          u ===
          `${BASE}/api/address/bc1watch/txs/chain/${"aa".repeat(32)}`
        ) {
          return new Response(JSON.stringify([]));
        }
        return new Response("not found", { status: 404 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = createBitcoinAdapter({ baseUrl: BASE });
    const res = await adapter.getTransactions({
      network: NET,
      address: "bc1watch",
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.errors).toEqual([]);
    expect(res.data.transactions).toHaveLength(1);
    expect(res.data.uniqueTransactionCount).toBe(99);
    expect(res.data.transactionCountComplete).toBe(true);
    const tx = res.data.transactions[0];
    expect(tx.hash).toBe("aa".repeat(32));
    expect(tx.direction).toBe("in");
    expect(tx.symbol).toBe("BTC");
    expect(tx.blockNumber).toBe("700000");
    expect(tx.timestamp).toBe("1600000000");
    expect(tx.valueNativeDecimal).toBe("0.005");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/api/address/bc1watch/txs/chain/${"aa".repeat(32)}`,
      { cache: "no-store" },
    );
  });

  it("returns provider_http_error when address stats are not OK", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("gone", { status: 502 })),
    );

    const adapter = createBitcoinAdapter({ baseUrl: BASE });
    const res = await adapter.getNativeBalance({
      network: NET,
      address: "bc1x",
    });

    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error.code).toBe("provider_http_error");
    expect(res.error.message).toContain("502");
  });

  it("handles the Strike-style bech32 sample address with zero balance data", async () => {
    const sample = "bc1q274c4dres2kgj7ghmekuu7kmlfxw9hqcqlr8ft";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const u = String(input);
        if (u === `${BASE}/api/v1/prices`) {
          return new Response(JSON.stringify({ USD: 60_000 }));
        }
        if (u === `${BASE}/api/address/${sample}`) {
          return new Response(
            JSON.stringify({
              chain_stats: {
                funded_txo_sum: 0,
                spent_txo_sum: 0,
                tx_count: 0,
              },
              mempool_stats: {
                funded_txo_sum: 0,
                spent_txo_sum: 0,
                tx_count: 0,
              },
            }),
          );
        }
        if (u === `${BASE}/api/address/${sample}/txs`) {
          return new Response(JSON.stringify([]));
        }
        return new Response("not found", { status: 404 });
      }),
    );

    const adapter = createBitcoinAdapter({ baseUrl: BASE });
    const [balRes, txRes] = await Promise.all([
      adapter.getNativeBalance({ network: NET, address: sample }),
      adapter.getTransactions({ network: NET, address: sample }),
    ]);

    expect(balRes.ok).toBe(true);
    if (!balRes.ok) return;
    expect(balRes.data?.formattedBalance).toBe("0");
    expect(balRes.data?.rawBalance).toBe("0");
    expect(balRes.data?.symbol).toBe("BTC");

    expect(txRes.ok).toBe(true);
    if (!txRes.ok) return;
    expect(txRes.data.transactions).toEqual([]);
    expect(txRes.data.uniqueTransactionCount).toBe(0);
    expect(txRes.data.transactionCountComplete).toBe(true);
  });
});
