import { afterEach, describe, expect, it, vi } from "vitest";
import { createAlchemyEvmAdapter } from "@/lib/onchain/providers/alchemy-evm";

const ADDR = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";

describe("createAlchemyEvmAdapter getTransactions parallel pulls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("issues both fromAddress and toAddress asset transfer requests", async () => {
    const directions: string[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: string | URL, init?: RequestInit) => {
        const body =
          typeof init?.body === "string"
            ? (JSON.parse(init.body) as {
                method?: string;
                params?: { fromAddress?: string; toAddress?: string }[];
              })
            : {};
        if (body.method === "alchemy_getAssetTransfers" && body.params?.[0]) {
          const p = body.params[0];
          if (p.fromAddress) directions.push("from");
          if (p.toAddress) directions.push("to");
        }
        return new Response(
          JSON.stringify({
            jsonrpc: "2.0",
            id: 1,
            result: { transfers: [] },
          }),
        );
      }),
    );

    const adapter = createAlchemyEvmAdapter({
      apiKey: "k",
      rpcUrlForNetwork: () => "https://eth-mainnet.g.alchemy.com/v2/k",
    });

    const res = await adapter.getTransactions({
      network: "eth-mainnet",
      address: ADDR,
    });

    expect(res.ok).toBe(true);
    expect(directions).toContain("from");
    expect(directions).toContain("to");
  });
});
