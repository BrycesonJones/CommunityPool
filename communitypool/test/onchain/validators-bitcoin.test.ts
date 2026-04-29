import { describe, expect, it } from "vitest";
import { classifyInput } from "@/lib/onchain/validators";

describe("BTC input classification", () => {
  it("classifies native bech32 addresses and preserves canonical lowercase", () => {
    const input = classifyInput("bc1q274c4dres2kgj7ghmekuu7kmlfxw9hqcqlr8ft");
    expect(input.kind).toBe("btc_address");
    expect(input.chainFamily).toBe("bitcoin");
    expect(input.normalized).toBe("bc1q274c4dres2kgj7ghmekuu7kmlfxw9hqcqlr8ft");
  });

  it("accepts BIP21 bitcoin: URIs and extracts address", () => {
    const input = classifyInput(
      "bitcoin:bc1q274c4dres2kgj7ghmekuu7kmlfxw9hqcqlr8ft?amount=0.001",
    );
    expect(input.kind).toBe("btc_address");
    expect(input.chainFamily).toBe("bitcoin");
    expect(input.normalized).toBe("bc1q274c4dres2kgj7ghmekuu7kmlfxw9hqcqlr8ft");
  });

  it("rejects mixed-case bech32 strings", () => {
    const input = classifyInput("bc1Q274c4dres2kgj7ghmekuu7kmlfxw9hqcqlr8ft");
    expect(input.kind).toBe("invalid");
    expect(input.chainFamily).toBe("unknown");
  });
});
