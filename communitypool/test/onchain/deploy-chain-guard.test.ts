import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { assertChainMatchesExpected } from "@/lib/onchain/community-pool";

const ENV = "NEXT_PUBLIC_EXPECTED_CHAIN_ID";

describe("assertChainMatchesExpected", () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[ENV];
  });

  afterEach(() => {
    if (saved == null) delete process.env[ENV];
    else process.env[ENV] = saved;
  });

  it("passes when wallet chain matches the expected mainnet chain", () => {
    process.env[ENV] = "1";
    expect(() => assertChainMatchesExpected(BigInt(1))).not.toThrow();
  });

  it("throws a clear error when a mainnet build is connected to Sepolia", () => {
    process.env[ENV] = "1";
    expect(() => assertChainMatchesExpected(BigInt(11155111))).toThrow(/Wrong network/);
    expect(() => assertChainMatchesExpected(BigInt(11155111))).toThrow(/chain 1/);
    expect(() => assertChainMatchesExpected(BigInt(11155111))).toThrow(/chain 11155111/);
  });

  it("throws when a Sepolia build is connected to mainnet", () => {
    process.env[ENV] = "11155111";
    expect(() => assertChainMatchesExpected(BigInt(1))).toThrow(/Wrong network/);
  });

  it("accepts an explicit override (used by integration tests on local Anvil)", () => {
    process.env[ENV] = "1";
    expect(() => assertChainMatchesExpected(BigInt(31337), BigInt(31337))).not.toThrow();
  });
});
