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
import { formatTokenAmount, previewFundingSplit } from "@/lib/onchain/protocol-fee";

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
