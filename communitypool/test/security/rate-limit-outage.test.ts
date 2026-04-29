import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("rate-limit outage handling", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("fails closed in production when Upstash config is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");

    const mod = await import("@/lib/security/rate-limit");
    const res = await mod.enforceRateLimits([
      { name: "otp_send_ip", identifier: "1.2.3.4" },
    ]);
    expect(res?.status).toBe(503);
    await expect(res?.json()).resolves.toMatchObject({
      code: "service_unavailable",
    });
  });

  it("returns safe 503 when Upstash backend throws", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("UPSTASH_REDIS_REST_URL", "https://upstash.example");
    vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "token");

    vi.doMock("@upstash/redis", () => ({
      Redis: class RedisMock {},
    }));
    vi.doMock("@upstash/ratelimit", () => ({
      Ratelimit: class RatelimitMock {
        static slidingWindow() {
          return {};
        }
        async limit() {
          throw new Error("upstash transport failure");
        }
      },
    }));

    const mod = await import("@/lib/security/rate-limit");
    const res = await mod.enforceRateLimits([
      { name: "stripe_checkout_user", identifier: "user_1" },
    ]);
    expect(res?.status).toBe(503);
    const body = await res?.json();
    expect(body.code).toBe("service_unavailable");
    expect(body.error).toMatch(/service unavailable/i);
    expect(JSON.stringify(body)).not.toContain("upstash");
    expect(JSON.stringify(body)).not.toContain("transport");
  });
});
