import { afterEach, describe, expect, it, vi } from "vitest";
import { createEtherscanEvmAdapter } from "@/lib/onchain/providers/etherscan-evm";

const ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

function txRow(
  hash: string,
  block: string,
  from: string,
  to: string,
  value = "0",
) {
  return {
    hash,
    blockNumber: block,
    timeStamp: "1",
    from,
    to,
    value,
  };
}

describe("createEtherscanEvmAdapter getTransactions metadata", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("dedupes hashes across normal, internal, tokentx, tokennfttx and marks complete when pages end short", async () => {
    const h1 = `0x${"a".repeat(64)}`;
    const h2 = `0x${"b".repeat(64)}`;
    const h3 = `0x${"c".repeat(64)}`;

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL) => {
        const u = new URL(String(input));
        expect(u.hostname).toContain("etherscan");
        const action = u.searchParams.get("action");
        const page = u.searchParams.get("page") ?? "1";

        if (action === "txlist" && page === "1") {
          return new Response(
            JSON.stringify({
              status: "1",
              message: "OK",
              result: [
                txRow(h1, "100", ADDR, ADDR, "1"),
                txRow(h2, "99", ADDR, ADDR, "2"),
              ],
            }),
          );
        }
        if (action === "txlistinternal" && page === "1") {
          return new Response(
            JSON.stringify({
              status: "1",
              message: "OK",
              result: [txRow(h1, "100", ADDR, ADDR, "0")],
            }),
          );
        }
        if (action === "tokentx" && page === "1") {
          return new Response(
            JSON.stringify({
              status: "1",
              message: "OK",
              result: [txRow(h3, "98", ADDR, ADDR, "0")],
            }),
          );
        }
        if (action === "tokennfttx" && page === "1") {
          return new Response(
            JSON.stringify({
              status: "1",
              message: "OK",
              result: [],
            }),
          );
        }
        return new Response(JSON.stringify({ status: "0", result: "unknown stub" }), {
          status: 200,
        });
      }),
    );

    const adapter = createEtherscanEvmAdapter({
      apiKey: "test-key",
      rpcUrlForNetwork: () => undefined,
    });

    const res = await adapter.getTransactions({
      network: "eth-mainnet",
      address: ADDR,
    });

    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.data.uniqueTransactionCount).toBe(3);
    expect(res.data.transactionCountComplete).toBe(true);
    expect(res.data.transactions.length).toBeLessThanOrEqual(40);
    const previewHashes = new Set(res.data.transactions.map((t) => t.hash.toLowerCase()));
    expect(previewHashes.has(h1.toLowerCase())).toBe(true);
    expect(previewHashes.has(h2.toLowerCase())).toBe(true);
  });
});
