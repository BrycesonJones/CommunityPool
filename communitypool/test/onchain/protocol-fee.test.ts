/**
 * Protocol-fee detection and preview (Phase 2.8 activation).
 *
 * Two things must never go wrong in this layer:
 *   1. A V1 pool must never be shown a protocol fee — those contracts do not charge one.
 *   2. A failed chain read must never render as "no fee" — a V2 pool still charges the live rate.
 */

import { describe, it, expect } from "vitest";
import { AbiCoder, Interface, getAddress, id, parseUnits } from "ethers";
import type { JsonRpcProvider } from "ethers";
import {
  V2_ONLY_SELECTORS,
  buildFundingPreview,
  classifyPoolCode,
  detectPoolContractVersion,
  formatFeeBpsPercent,
  previewFundingSplit,
  readChainProtocolFeeBps,
  readLiveProtocolFee,
} from "@/lib/onchain/protocol-fee";
import v1Artifact from "@/lib/onchain/community-pool-v1-artifact.json";
import v2Artifact from "@/lib/onchain/community-pool-v2-artifact.json";

const POOL = "0x00000000000000000000000000000000000000A1";
const TREASURY = "0x00000000000000000000000000000000000000B2";
const CONFIG = "0x00000000000000000000000000000000000000C3";
const coder = AbiCoder.defaultAbiCoder();
const feeIface = new Interface([
  "function getProtocolFeeConfig() view returns (uint256 feeBps, address recipient)",
]);

/** Minimal provider stub: only `getCode` and `call` are exercised by this module. */
function stubProvider(opts: {
  code?: string;
  feeBps?: bigint;
  recipient?: string;
  callThrows?: boolean;
  codeThrows?: boolean;
}): JsonRpcProvider {
  return {
    async getCode() {
      if (opts.codeThrows) throw new Error("network error");
      return opts.code ?? "0x";
    },
    async call(tx: { data: string }) {
      if (opts.callThrows) throw new Error("network error");
      if (tx.data.startsWith(V2_ONLY_SELECTORS.getProtocolFeeConfig.padStart(10, "0x"))) {
        // fallthrough below
      }
      return coder.encode(
        ["uint256", "address"],
        [opts.feeBps ?? 100n, getAddress(opts.recipient ?? TREASURY)],
      );
    },
  } as unknown as JsonRpcProvider;
}

describe("V2 capability detection", () => {
  it("pins the two V2-only selectors", () => {
    expect(V2_ONLY_SELECTORS.protocolConfig).toBe(id("protocolConfig()").slice(2, 10));
    expect(V2_ONLY_SELECTORS.getProtocolFeeConfig).toBe(id("getProtocolFeeConfig()").slice(2, 10));
  });

  it("classifies the real committed artifacts correctly", () => {
    // The runtime is embedded in the creation bytecode, so selector presence is decidable from it.
    expect(classifyPoolCode(v2Artifact.bytecode)).toBe("v2");
    expect(classifyPoolCode(v1Artifact.bytecode)).toBe("v1");
  });

  it("requires BOTH selectors before calling a pool V2", () => {
    const onlyOne = "0x60806040" + V2_ONLY_SELECTORS.protocolConfig + "00";
    expect(classifyPoolCode(onlyOne)).toBe("v1");
    const both =
      "0x60806040" + V2_ONLY_SELECTORS.protocolConfig + "00" + V2_ONLY_SELECTORS.getProtocolFeeConfig;
    expect(classifyPoolCode(both)).toBe("v2");
  });

  it("is case-insensitive about the code casing an RPC returns", () => {
    const upper = ("0x60806040" + V2_ONLY_SELECTORS.protocolConfig + V2_ONLY_SELECTORS.getProtocolFeeConfig)
      .toUpperCase()
      .replace("0X", "0x");
    expect(classifyPoolCode(upper)).toBe("v2");
  });

  it("throws rather than guessing when the address holds no contract", async () => {
    await expect(detectPoolContractVersion(stubProvider({ code: "0x" }), POOL)).rejects.toThrow(
      /No contract found/i,
    );
  });
});

describe("fee split arithmetic mirrors the contract", () => {
  const gross = parseUnits("1", 18);

  it.each([
    [0n, "0", "1"],
    [75n, "0.0075", "0.9925"],
    [100n, "0.01", "0.99"],
    [300n, "0.03", "0.97"],
  ])("splits 1.0 at %s bps into %s fee / %s net", (bps, fee, net) => {
    const split = previewFundingSplit(gross, bps as bigint);
    expect(split.feeAmount).toBe(parseUnits(fee as string, 18));
    expect(split.netAmount).toBe(parseUnits(net as string, 18));
  });

  it("never increases the gross: fee + net always equals the amount funded", () => {
    for (const bps of [0n, 1n, 75n, 100n, 299n, 300n]) {
      for (const amount of [1n, 7n, 12_345_678n, parseUnits("3.33", 6), parseUnits("2", 18)]) {
        const s = previewFundingSplit(amount, bps);
        expect(s.feeAmount + s.netAmount).toBe(amount);
        expect(s.grossAmount).toBe(amount);
        expect(s.feeAmount).toBeLessThanOrEqual(amount);
      }
    }
  });

  it("floors the fee exactly like Solidity integer division", () => {
    // 99 raw units at 1% = 0.99 -> floors to 0, so the pool receives all 99.
    expect(previewFundingSplit(99n, 100n).feeAmount).toBe(0n);
    expect(previewFundingSplit(99n, 100n).netAmount).toBe(99n);
    // 199 at 1% = 1.99 -> 1.
    expect(previewFundingSplit(199n, 100n).feeAmount).toBe(1n);
    // 8-decimal WBTC: 0.12345678 at 1% -> 0.00123456 (not rounded up).
    expect(previewFundingSplit(12_345_678n, 100n).feeAmount).toBe(123_456n);
  });

  it("refuses to preview a rate above the on-chain 3% cap", () => {
    expect(() => previewFundingSplit(gross, 301n)).toThrow(/300 bps/);
  });

  it("formats rates for UI labels", () => {
    expect(formatFeeBpsPercent(100n)).toBe("1%");
    expect(formatFeeBpsPercent(75n)).toBe("0.75%");
    expect(formatFeeBpsPercent(0n)).toBe("0%");
    expect(formatFeeBpsPercent(300n)).toBe("3%");
  });
});

describe("live fee reads", () => {
  const v2Code = "0x60806040" + V2_ONLY_SELECTORS.protocolConfig + V2_ONLY_SELECTORS.getProtocolFeeConfig;

  it("reads the pool's live rate and recipient", async () => {
    const cfg = await readLiveProtocolFee(stubProvider({ code: v2Code, feeBps: 75n }), POOL);
    expect(cfg.feeBps).toBe(75n);
    expect(cfg.recipient).toBe(getAddress(TREASURY));
  });

  it("refuses a reported rate above the contract cap", async () => {
    await expect(
      readLiveProtocolFee(stubProvider({ code: v2Code, feeBps: 500n }), POOL),
    ).rejects.toThrow(/3%/);
  });

  it("returns null (not a default) when the chain-level config read fails", async () => {
    expect(await readChainProtocolFeeBps(stubProvider({ callThrows: true }), CONFIG)).toBeNull();
  });
});

describe("funding preview", () => {
  const v2Code = "0x60806040" + V2_ONLY_SELECTORS.protocolConfig + V2_ONLY_SELECTORS.getProtocolFeeConfig;
  const base = { poolAddress: POOL, grossAmount: parseUnits("1", 18), symbol: "PAXG", decimals: 18 };

  it("shows no fee for a V1 pool", async () => {
    const preview = await buildFundingPreview({
      ...base,
      provider: stubProvider({ code: v1Artifact.bytecode }),
    });
    expect(preview).toEqual({ kind: "no-fee", version: "v1" });
  });

  it("shows the split for a V2 pool at the live rate", async () => {
    const preview = await buildFundingPreview({
      ...base,
      provider: stubProvider({ code: v2Code, feeBps: 100n }),
    });
    expect(preview.kind).toBe("split");
    if (preview.kind !== "split") return;
    expect(preview.split.grossAmount).toBe(parseUnits("1", 18));
    expect(preview.split.feeAmount).toBe(parseUnits("0.01", 18));
    expect(preview.split.netAmount).toBe(parseUnits("0.99", 18));
    expect(preview.symbol).toBe("PAXG");
  });

  it("tracks an admin rate change without a frontend deploy", async () => {
    const at75 = await buildFundingPreview({ ...base, provider: stubProvider({ code: v2Code, feeBps: 75n }) });
    const at300 = await buildFundingPreview({ ...base, provider: stubProvider({ code: v2Code, feeBps: 300n }) });
    const at0 = await buildFundingPreview({ ...base, provider: stubProvider({ code: v2Code, feeBps: 0n }) });
    expect(at75.kind === "split" && at75.split.feeAmount).toBe(parseUnits("0.0075", 18));
    expect(at300.kind === "split" && at300.split.feeAmount).toBe(parseUnits("0.03", 18));
    expect(at0.kind === "split" && at0.split.feeAmount).toBe(0n);
  });

  it("reports unavailable — never a zero fee — when the fee read fails", async () => {
    const preview = await buildFundingPreview({
      ...base,
      provider: stubProvider({ code: v2Code, callThrows: true }),
    });
    expect(preview.kind).toBe("unavailable");
    if (preview.kind !== "unavailable") return;
    expect(preview.message).toMatch(/could not read/i);
  });

  it("reports unavailable when the code read itself fails", async () => {
    const preview = await buildFundingPreview({ ...base, provider: stubProvider({ codeThrows: true }) });
    expect(preview.kind).toBe("unavailable");
  });

  it("surfaces a wrong address rather than silently treating it as a fee-free pool", async () => {
    const preview = await buildFundingPreview({ ...base, provider: stubProvider({ code: "0x" }) });
    expect(preview.kind).toBe("unavailable");
    if (preview.kind !== "unavailable") return;
    expect(preview.message).toMatch(/No contract found/i);
  });
});

describe("V2 ABI decodes the fee view", () => {
  it("encodes/decodes getProtocolFeeConfig the way the preview expects", () => {
    const encoded = feeIface.encodeFunctionResult("getProtocolFeeConfig", [100n, getAddress(TREASURY)]);
    const [bps, recipient] = feeIface.decodeFunctionResult("getProtocolFeeConfig", encoded);
    expect(BigInt(bps)).toBe(100n);
    expect(getAddress(recipient)).toBe(getAddress(TREASURY));
    expect(v2Artifact.abi.some((x: { name?: string }) => x.name === "getProtocolFeeConfig")).toBe(true);
    expect(v1Artifact.abi.some((x: { name?: string }) => x.name === "getProtocolFeeConfig")).toBe(false);
  });
});
