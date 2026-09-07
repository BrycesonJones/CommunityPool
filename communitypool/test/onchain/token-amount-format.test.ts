/**
 * Token-amount display formatting.
 *
 * The production smoke test showed a $0.01 ETH contribution as
 *   Funding amount 0.000003 ETH / Protocol fee 0.00000003 ETH / Pool receives 0.000003 ETH
 * — gross and net identical, hiding the deduction the row exists to disclose. These tests pin the
 * precision rules per asset and prove formatting never touches the underlying arithmetic.
 */

import { describe, it, expect } from "vitest";
import { parseUnits } from "ethers";
import {
  formatTokenAmount,
  formatTokenAmountExact,
  previewFundingSplit,
} from "@/lib/onchain/protocol-fee";

/** The exact wei the smoke test computed for $0.01 at $2509.88611728/ETH. */
const SMOKE_GROSS_WEI = 3_984_242_408_842n;

describe("small ETH amounts stay visually distinct", () => {
  const split = previewFundingSplit(SMOKE_GROSS_WEI, 100n);
  const g = formatTokenAmount(split.grossAmount, 18);
  const f = formatTokenAmount(split.feeAmount, 18);
  const n = formatTokenAmount(split.netAmount, 18);

  it("renders gross, fee and net as three different numbers", () => {
    expect(g).not.toBe(n);
    expect(f).not.toBe(g);
    expect(f).not.toBe(n);
  });

  it("shows the 1% fee rather than collapsing it", () => {
    expect(g).toBe("0.00000398424");
    expect(f).toBe("0.0000000398424");
    expect(n).toBe("0.00000394439");
  });

  it("keeps the displayed values faithful to the underlying bigints", () => {
    // Display is a prefix of the exact decimal expansion — never rounded up, never invented.
    expect("0.000003984242408842").toContain(g);
    expect("0.000000039842424088").toContain(f);
    expect("0.000003944399984754").toContain(n);
  });

  it("does not alter the arithmetic it displays", () => {
    expect(split.feeAmount + split.netAmount).toBe(split.grossAmount);
    expect(split.grossAmount).toBe(SMOKE_GROSS_WEI);
  });
});

describe("per-asset precision limits", () => {
  it("WBTC shows its full 8 decimals and no more", () => {
    expect(formatTokenAmount(12_345_678n, 8)).toBe("0.12345678");
    expect(formatTokenAmount(1n, 8)).toBe("0.00000001");
    const split = previewFundingSplit(12_345_678n, 100n);
    expect(formatTokenAmount(split.feeAmount, 8)).toBe("0.00123456");
    for (const raw of [1n, 999n, 12_345_678n, 100_000_000n]) {
      const frac = formatTokenAmount(raw, 8).split(".")[1] ?? "";
      expect(frac.length).toBeLessThanOrEqual(8);
    }
  });

  it("XAU₮ never displays beyond its 6 decimals", () => {
    expect(formatTokenAmount(10_000n, 6)).toBe("0.01");
    expect(formatTokenAmount(1n, 6)).toBe("0.000001");
    expect(formatTokenAmount(1_234_567n, 6)).toBe("1.234567");
    for (const raw of [1n, 12n, 999_999n, 1_000_000n]) {
      const frac = formatTokenAmount(raw, 6).split(".")[1] ?? "";
      expect(frac.length).toBeLessThanOrEqual(6);
    }
  });

  it("PAXG keeps useful precision on 18-decimal amounts", () => {
    expect(formatTokenAmount(parseUnits("1", 18), 18)).toBe("1");
    expect(formatTokenAmount(parseUnits("0.01", 18), 18)).toBe("0.01");
    const split = previewFundingSplit(parseUnits("0.000001234567", 18), 100n);
    expect(formatTokenAmount(split.grossAmount, 18)).not.toBe(
      formatTokenAmount(split.netAmount, 18),
    );
  });

  it("ETH whole and simple amounts keep their familiar form", () => {
    expect(formatTokenAmount(parseUnits("1", 18), 18)).toBe("1");
    expect(formatTokenAmount(parseUnits("0.99", 18), 18)).toBe("0.99");
    expect(formatTokenAmount(parseUnits("0.0075", 18), 18)).toBe("0.0075");
    expect(formatTokenAmount(parseUnits("0.9925", 18), 18)).toBe("0.9925");
    expect(formatTokenAmount(0n, 18)).toBe("0");
  });
});

describe("fee rates render correctly at every supported bps", () => {
  it.each([
    [0n, "0", "1"],
    [75n, "0.0075", "0.9925"],
    [100n, "0.01", "0.99"],
    [300n, "0.03", "0.97"],
  ])("1 ETH at %s bps", (bps, fee, net) => {
    const split = previewFundingSplit(parseUnits("1", 18), bps as bigint);
    expect(formatTokenAmount(split.feeAmount, 18)).toBe(fee as string);
    expect(formatTokenAmount(split.netAmount, 18)).toBe(net as string);
    // Never a surcharge: what is displayed as fee + net is what leaves the wallet.
    expect(split.feeAmount + split.netAmount).toBe(split.grossAmount);
  });

  it("a zero fee renders as 0 and leaves the gross intact", () => {
    const split = previewFundingSplit(SMOKE_GROSS_WEI, 0n);
    expect(formatTokenAmount(split.feeAmount, 18)).toBe("0");
    expect(formatTokenAmount(split.netAmount, 18)).toBe(formatTokenAmount(split.grossAmount, 18));
  });

  it("a fee that floors to zero is shown as zero, not invented", () => {
    const split = previewFundingSplit(99n, 100n); // floor(0.99) == 0
    expect(split.feeAmount).toBe(0n);
    expect(formatTokenAmount(split.feeAmount, 18)).toBe("0");
  });
});

/**
 * Exact formatting, for values users copy into a wallet or compare against each other.
 *
 * The production PAXG approval was blocked with a message that read as an equality: the readable
 * formatter shortened an allowance of 2,270,850,000,000 and a requirement of 2,270,857,687,598
 * into the same "0.00000227085". Exact formatting must never do that.
 */
describe("formatTokenAmountExact", () => {
  /** The real production values, read from chain. */
  const APPROVED = 2_270_850_000_000n;
  const CANONICAL_GROSS = 2_270_857_687_598n;

  it("renders the two production amounts as visibly different strings", () => {
    const a = formatTokenAmountExact(APPROVED, 18);
    const g = formatTokenAmountExact(CANONICAL_GROSS, 18);
    expect(a).toBe("0.00000227085");
    expect(g).toBe("0.000002270857687598");
    expect(a).not.toBe(g);
    // The readable formatter is what collapsed them; that is why this one exists.
    expect(formatTokenAmount(APPROVED, 18)).toBe(formatTokenAmount(CANONICAL_GROSS, 18));
  });

  it("round-trips back to the exact raw bigint", () => {
    for (const [raw, decimals] of [
      [CANONICAL_GROSS, 18],
      [APPROVED, 18],
      [1n, 18],
      [12_345_678n, 8],
      [1n, 8],
      [1n, 6],
      [1_234_567n, 6],
      [10n ** 18n, 18],
    ] as const) {
      expect(parseUnits(formatTokenAmountExact(raw, decimals), decimals)).toBe(raw);
    }
  });

  it("preserves PAXG's full 18 decimals when they are meaningful", () => {
    const raw = 1_234_567_890_123_456_789n;
    expect(formatTokenAmountExact(raw, 18)).toBe("1.234567890123456789");
    expect(parseUnits(formatTokenAmountExact(raw, 18), 18)).toBe(raw);
  });

  it("never exceeds WBTC's 8 or XAU₮'s 6 decimals", () => {
    for (const raw of [1n, 999n, 12_345_678n, 100_000_001n]) {
      expect((formatTokenAmountExact(raw, 8).split(".")[1] ?? "").length).toBeLessThanOrEqual(8);
    }
    for (const raw of [1n, 999_999n, 1_000_001n]) {
      expect((formatTokenAmountExact(raw, 6).split(".")[1] ?? "").length).toBeLessThanOrEqual(6);
    }
  });

  it("trims only trailing zeros, never meaningful digits", () => {
    expect(formatTokenAmountExact(parseUnits("1.500000", 18), 18)).toBe("1.5");
    expect(formatTokenAmountExact(10n ** 18n, 18)).toBe("1");
    expect(formatTokenAmountExact(0n, 18)).toBe("0");
    expect(formatTokenAmountExact(1_020_000n, 6)).toBe("1.02");
  });

  it("distinguishes amounts one raw unit apart, at every asset's precision", () => {
    for (const decimals of [6, 8, 18]) {
      for (const base of [1n, 1_000_000n, 2_270_850_000_000n]) {
        expect(formatTokenAmountExact(base, decimals)).not.toBe(
          formatTokenAmountExact(base + 1n, decimals),
        );
      }
    }
  });

  it("stays exact where a float would not", () => {
    // 0.1 + 0.2 style loss: this value is not representable as a double.
    const raw = 123_456_789_012_345_678n;
    const s = formatTokenAmountExact(raw, 18);
    expect(s).toBe("0.123456789012345678");
    expect(Number(s).toString()).not.toBe(s); // proves a float round-trip would lose digits
    expect(parseUnits(s, 18)).toBe(raw);
  });
});
