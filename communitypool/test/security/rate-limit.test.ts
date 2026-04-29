import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Force in-memory backend by clearing Upstash env vars before importing the
// module. The module memoizes its backend on first use, so resetting between
// tests via `__resetRateLimitForTests` is required.
beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  vi.stubEnv("UPSTASH_REDIS_REST_TOKEN", "");
});

afterEach(async () => {
  const mod = await import("@/lib/security/rate-limit");
  mod.__resetRateLimitForTests();
});

describe("rate-limit helper (in-memory backend)", () => {
  it("allows requests up to the configured limit then blocks", async () => {
    const { checkRateLimit, POLICIES } = await import(
      "@/lib/security/rate-limit"
    );
    const limit = POLICIES.otp_send_email.limit;

    for (let i = 0; i < limit; i += 1) {
      const r = await checkRateLimit("otp_send_email", "alice@example.com");
      expect(r.ok).toBe(true);
      expect(r.remaining).toBe(limit - i - 1);
    }

    const blocked = await checkRateLimit("otp_send_email", "alice@example.com");
    expect(blocked.ok).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
  });

  it("isolates buckets by identifier", async () => {
    const { checkRateLimit, POLICIES } = await import(
      "@/lib/security/rate-limit"
    );
    const limit = POLICIES.otp_send_email.limit;

    for (let i = 0; i < limit; i += 1) {
      await checkRateLimit("otp_send_email", "alice@example.com");
    }

    const otherUser = await checkRateLimit("otp_send_email", "bob@example.com");
    expect(otherUser.ok).toBe(true);
  });

  it("isolates buckets by policy name", async () => {
    const { checkRateLimit, POLICIES } = await import(
      "@/lib/security/rate-limit"
    );
    for (let i = 0; i < POLICIES.otp_send_email.limit; i += 1) {
      await checkRateLimit("otp_send_email", "shared-id");
    }
    const differentPolicy = await checkRateLimit("otp_send_ip", "shared-id");
    expect(differentPolicy.ok).toBe(true);
  });

  it("enforceRateLimits returns 429 with Retry-After when any policy is exhausted", async () => {
    const { enforceRateLimits, POLICIES } = await import(
      "@/lib/security/rate-limit"
    );
    const limit = POLICIES.stripe_checkout_user.limit;
    for (let i = 0; i < limit; i += 1) {
      await enforceRateLimits([
        { name: "stripe_checkout_user", identifier: "user-1" },
      ]);
    }
    const response = await enforceRateLimits([
      { name: "stripe_checkout_user", identifier: "user-1" },
    ]);
    expect(response).not.toBeNull();
    if (!response) return;
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toMatch(/^\d+$/);
    const body = await response.json();
    expect(body).toMatchObject({
      error: expect.stringMatching(/too many requests/i),
      code: "rate_limited",
    });
    expect(body.retryAfter).toBeGreaterThanOrEqual(1);
  });

  it("enforceRateLimits returns null when all policies pass", async () => {
    const { enforceRateLimits } = await import("@/lib/security/rate-limit");
    const response = await enforceRateLimits([
      { name: "oauth_callback", identifier: "1.2.3.4" },
      { name: "otp_send_ip", identifier: "1.2.3.4" },
    ]);
    expect(response).toBeNull();
  });

  it("rejects empty identifier rather than silently grouping callers", async () => {
    const { checkRateLimit } = await import("@/lib/security/rate-limit");
    await expect(checkRateLimit("otp_send_ip", "")).rejects.toThrow(
      /empty identifier/,
    );
  });

  it("getClientIp prefers x-forwarded-for, falls back to x-real-ip, then unknown", async () => {
    const { getClientIp } = await import("@/lib/security/rate-limit");

    const xff = new Request("http://example.com", {
      headers: { "x-forwarded-for": "203.0.113.5, 70.41.3.18" },
    });
    expect(getClientIp(xff)).toBe("203.0.113.5");

    const realIp = new Request("http://example.com", {
      headers: { "x-real-ip": "198.51.100.7" },
    });
    expect(getClientIp(realIp)).toBe("198.51.100.7");

    const none = new Request("http://example.com");
    expect(getClientIp(none)).toBe("unknown");
  });
});
