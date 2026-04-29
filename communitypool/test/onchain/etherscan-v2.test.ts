import { describe, expect, it } from "vitest";
import {
  etherscanIsHardError,
  etherscanResultToArray,
} from "@/lib/onchain/etherscan-v2";

describe("etherscanResultToArray", () => {
  it("returns arrays as-is", () => {
    expect(etherscanResultToArray([{ a: 1 }])).toEqual([{ a: 1 }]);
    expect(etherscanResultToArray([])).toEqual([]);
  });

  it("treats benign empty strings as empty arrays", () => {
    expect(etherscanResultToArray("No transactions found")).toEqual([]);
    expect(etherscanResultToArray("No records found")).toEqual([]);
  });

  it("parses JSON array strings", () => {
    expect(etherscanResultToArray('[{"hash":"0x1"}]')).toEqual([{ hash: "0x1" }]);
  });

  it("returns null for non-array JSON strings", () => {
    expect(etherscanResultToArray('{"foo":1}')).toBeNull();
  });
});

describe("etherscanIsHardError", () => {
  it("returns null for success status", () => {
    expect(etherscanIsHardError({ status: "1", result: "100" })).toBeNull();
  });

  it("returns null for status 0 with empty array", () => {
    expect(
      etherscanIsHardError({ status: "0", message: "No transactions found", result: [] }),
    ).toBeNull();
  });

  it("returns message for rate limit", () => {
    expect(
      etherscanIsHardError({
        status: "0",
        message: "NOTOK",
        result: "Max rate limit reached",
      }),
    ).toBe("Max rate limit reached");
  });

  it("returns null when status 0 but result parses to array", () => {
    expect(
      etherscanIsHardError({ status: "0", message: "OK", result: "[]" }),
    ).toBeNull();
  });
});
