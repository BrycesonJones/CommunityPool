/**
 * Safe classification of funding failures.
 *
 * Production rendered a raw ethers exception into the funding modal — calldata, nested provider
 * objects and all. These pin the mapping from revert selector to a sentence a person can act on,
 * and that nothing internal leaks through.
 */

import { describe, it, expect } from "vitest";
import { AllowanceBelowAmountError, classifyFundingError } from "@/lib/onchain/funding-errors";

/** The exact exception shape the production smoke test produced. */
const PRODUCTION_ERROR = Object.assign(
  new Error(
    'execution reverted (unknown custom error) (action="estimateGas", data="0x13be252b", ' +
      'reason=null, transaction={ "data": "0x59e1397a00000000000000000000000045804880de22913dafe09f4980848ece6ecbaf78", ' +
      '"from": "0xB80f58dfA29e0382C458ADb8b0768045b89e5D43", "to": "0xBbE309861cB8Cbf840e4F67303F22d3d464d0B81" }, ' +
      "invocation=null, revert=null, code=CALL_EXCEPTION, version=6.17.0)",
  ),
  { code: "CALL_EXCEPTION", data: "0x13be252b" },
);

describe("classifyFundingError", () => {
  it("recognises the production PAXG InsufficientAllowance revert", () => {
    const c = classifyFundingError(PRODUCTION_ERROR, "funding", "PAXG");
    expect(c.kind).toBe("insufficient_allowance");
    expect(c.message).toMatch(/spending cap you approved for PAXG/i);
  });

  it("leaks no calldata, addresses or provider internals", () => {
    const { message } = classifyFundingError(PRODUCTION_ERROR, "funding", "PAXG");
    expect(message).not.toMatch(/0x[0-9a-fA-F]{8}/);
    expect(message).not.toMatch(/CALL_EXCEPTION|estimateGas|transaction=|version=/);
  });

  it("finds the selector however the wallet nests it", () => {
    const nested = { info: { error: { data: "0x13be252b" } } };
    expect(classifyFundingError(nested, "funding").kind).toBe("insufficient_allowance");
    const deeper = { error: { cause: { data: "0xe450d38c" } } };
    expect(classifyFundingError(deeper, "funding").kind).toBe("insufficient_balance");
  });

  it.each([
    ["0xfb8f41b2", "insufficient_allowance"],
    ["0xe450d38c", "insufficient_balance"],
    ["0x4a72670c", "below_minimum"],
    ["0x2f9a5459", "token_not_accepted"],
    ["0x1668c223", "pool_expired"],
    ["0x633227f5", "price_unavailable"],
    ["0x2bcaf7fb", "price_unavailable"],
    ["0xf88289bb", "fee_unavailable"],
    ["0x3d9ef63e", "token_unsupported"],
    ["0x5274afe7", "token_unsupported"],
  ])("maps %s to %s", (data, kind) => {
    expect(classifyFundingError({ data }, "funding", "PAXG").kind).toBe(kind);
  });

  it("names the right wallet step when the user cancels", () => {
    const rejected = Object.assign(new Error("user rejected action"), { code: "ACTION_REJECTED" });
    expect(classifyFundingError(rejected, "approval").message).toMatch(/cancelled the approval/i);
    expect(classifyFundingError(rejected, "funding").message).toMatch(/cancelled the funding/i);
    expect(classifyFundingError({ info: { error: { code: 4001 } } }, "funding").kind).toBe(
      "user_rejected",
    );
  });

  it("falls back to a plain sentence for anything unrecognised", () => {
    const c = classifyFundingError(new Error("kaboom"), "funding");
    expect(c.kind).toBe("failed");
    expect(c.message).toMatch(/funding transaction failed/i);
    expect(c.message).not.toMatch(/kaboom/);
  });

  it("says nothing was sent, because nothing was", () => {
    for (const stage of ["approval", "funding"] as const) {
      expect(classifyFundingError(new Error("x"), stage).message).toMatch(/nothing was sent/i);
    }
  });
});

describe("AllowanceBelowAmountError", () => {
  it("carries both numbers so the UI can show the shortfall", () => {
    const e = new AllowanceBelowAmountError(2_259_000_000_000n, 2_259_006_291_456n);
    expect(e.allowance).toBe(2_259_000_000_000n);
    expect(e.required).toBe(2_259_006_291_456n);
    expect(e.required).toBeGreaterThan(e.allowance);
    expect(e).toBeInstanceOf(Error);
  });
});
