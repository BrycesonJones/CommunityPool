import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("expected-chain production guard", () => {
  it("falls back to Sepolia in non-production when env is missing", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_EXPECTED_CHAIN_ID", "");
    const mod = await import("@/lib/wallet/expected-chain");
    expect(mod.expectedChainId.toString()).toBe("11155111");
  });

  it("uses the env value when set, regardless of NODE_ENV", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_EXPECTED_CHAIN_ID", "1");
    const mod = await import("@/lib/wallet/expected-chain");
    expect(mod.expectedChainId.toString()).toBe("1");
  });

  it("throws at module load when production + env missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_EXPECTED_CHAIN_ID", "");
    await expect(() => import("@/lib/wallet/expected-chain")).rejects.toThrow(
      /NEXT_PUBLIC_EXPECTED_CHAIN_ID must be set in production/,
    );
  });

  it("throws at module load when production + env is non-numeric", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_EXPECTED_CHAIN_ID", "not-a-number");
    await expect(() => import("@/lib/wallet/expected-chain")).rejects.toThrow(
      /NEXT_PUBLIC_EXPECTED_CHAIN_ID must be set in production/,
    );
  });

  it("getExpectedChainId throws in production when env removed at runtime", async () => {
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("NEXT_PUBLIC_EXPECTED_CHAIN_ID", "1");
    const mod = await import("@/lib/wallet/expected-chain");
    // Simulate a production runtime where the env has been wiped between
    // module-load and this call. The runtime guard must still fire.
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_EXPECTED_CHAIN_ID", "");
    expect(() => mod.getExpectedChainId()).toThrow(
      /NEXT_PUBLIC_EXPECTED_CHAIN_ID must be set in production/,
    );
  });
});
