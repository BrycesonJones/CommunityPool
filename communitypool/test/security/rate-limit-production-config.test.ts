import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  vi.unstubAllEnvs();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("rate-limit production config", () => {
  it("throws and emits critical config event when Upstash is missing", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const mod = await import("@/lib/security/rate-limit");
    await expect(mod.checkRateLimit("otp_send_ip", "198.51.100.1")).rejects.toThrow(
      /UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required in production/i,
    );
    const output = errorSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(output).toContain("security.config.missing_rate_limit_backend");
  });
});
